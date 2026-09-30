import { assessHubSkill } from "./analysis.ts";
import { contentHash, type FetchedHubSkill } from "./fetchers.ts";
import type { HubListing } from "./listing.ts";
import { createHubStore } from "./store.ts";

type Sql = import("postgres").Sql;

/**
 * Enumeration, hydration backlog and daily budgets for the catalog.
 *
 * Budgets keep the platform inside its hosting limits: listing is cheap and
 * unbounded, while fetching packages, sandbox scans and live evaluations are
 * capped per UTC day (HUB_DAILY_*_CAP) and processed most-popular first.
 */

export type BudgetKind = "hydrate" | "scan" | "eval";

const DEFAULT_CAPS: Record<BudgetKind, number> = { hydrate: 1500, scan: 100, eval: 40 };

export function dailyCap(kind: BudgetKind, env: Record<string, string | undefined> = process.env): number {
  const value = Number(env[`HUB_DAILY_${kind.toUpperCase()}_CAP`]);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CAPS[kind];
}

export function createBacklogStore(sql: Sql) {
  const hub = createHubStore(sql);

  return {
    async remaining(kind: BudgetKind): Promise<number> {
      const [row] = await sql<{ used: number }[]>`select used from hub_budget_usage where day = (now() at time zone 'utc')::date and kind = ${kind}`;
      return Math.max(0, dailyCap(kind) - (row?.used ?? 0));
    },

    async consume(kind: BudgetKind, amount: number): Promise<void> {
      if (amount <= 0) return;
      await sql`
        insert into hub_budget_usage (day, kind, used) values ((now() at time zone 'utc')::date, ${kind}, ${amount})
        on conflict (day, kind) do update set used = hub_budget_usage.used + excluded.used
      `;
    },

    async usageToday(): Promise<Record<BudgetKind, { used: number; cap: number }>> {
      const rows = await sql<{ kind: BudgetKind; used: number }[]>`select kind, used from hub_budget_usage where day = (now() at time zone 'utc')::date`;
      const used = new Map(rows.map((row) => [row.kind, row.used]));
      return Object.fromEntries((["hydrate", "scan", "eval"] as const).map((kind) => [kind, { used: used.get(kind) ?? 0, cap: dailyCap(kind) }])) as Record<BudgetKind, { used: number; cap: number }>;
    },

    /**
     * Records one page of listings. New listings arrive as `listed`; known
     * ones get fresh metadata, and a changed upstream version sends an
     * already-analysed skill back to the backlog for re-hydration.
     */
    async upsertListings(sourceId: string, runId: string, listings: readonly HubListing[]): Promise<void> {
      if (listings.length === 0) return;
      const unique = [...new Map(listings.map((listing) => [listing.externalId, listing])).values()];
      const rows = unique.map((listing) => ({
        source_id: sourceId,
        external_id: listing.externalId,
        canonical_key: listing.canonicalKey,
        slug: listing.slug.slice(0, 200),
        name: listing.name.slice(0, 200),
        description: listing.description?.slice(0, 2000) ?? null,
        publisher: listing.publisher,
        source_url: listing.sourceUrl,
        repository: listing.repository,
        path: listing.path,
        version: listing.version,
        license: listing.license?.slice(0, 200) ?? null,
        popularity: sql.json(listing.popularity as never),
        popularity_score: listing.popularityScore,
        tags: listing.tags.slice(0, 12),
        locator: sql.json(listing.locator as never),
        listed_run: runId,
        status: "listed",
      }));
      // postgres.js multi-row insert helper (typed loosely: rows carry JSON parameters).
      const bulk = sql as unknown as (rows: unknown[], ...columns: string[]) => never;
      await sql`
        insert into hub_skills ${bulk(rows, "source_id", "external_id", "canonical_key", "slug", "name", "description", "publisher", "source_url", "repository", "path", "version", "license", "popularity", "popularity_score", "tags", "locator", "listed_run", "status")}
        on conflict (source_id, external_id) do update set
          canonical_key = excluded.canonical_key,
          description = coalesce(excluded.description, hub_skills.description),
          publisher = excluded.publisher,
          source_url = excluded.source_url,
          popularity = excluded.popularity,
          popularity_score = excluded.popularity_score,
          tags = case when array_length(excluded.tags, 1) > 0 then excluded.tags else hub_skills.tags end,
          locator = excluded.locator,
          listed_run = excluded.listed_run,
          status = case
            when hub_skills.status = 'removed' then 'listed'
            when hub_skills.status = 'active' and excluded.version is not null and hub_skills.locator->>'version' is distinct from excluded.locator->>'version' and excluded.locator ? 'version' then 'listed'
            else hub_skills.status end,
          updated_at = now()
      `;
    },

    async saveEnumeration(sourceId: string, state: Record<string, unknown>): Promise<void> {
      await sql`update skill_hub_sources set enumeration = ${sql.json(state as never)} where id = ${sourceId}`;
    },

    /** Marks listings not seen in a completed enumeration run as removed upstream. */
    async finishEnumeration(sourceId: string, runId: string): Promise<number> {
      await sql`
        update hub_skills set status = 'removed', updated_at = now()
        where source_id = ${sourceId} and status in ('listed', 'active', 'fetch_failed') and listed_run is distinct from ${runId}
      `;
      const [row] = await sql<{ count: number }[]>`select count(*)::int as count from hub_skills where source_id = ${sourceId} and status <> 'removed'`;
      await sql`update skill_hub_sources set total_listed = ${row?.count ?? 0} where id = ${sourceId}`;
      return row?.count ?? 0;
    },

    /**
     * Next listings to fetch: most trusted source first, then most popular.
     * A listing whose upstream skill is already fetched via another source
     * (same canonical key) is skipped — the catalog shows that copy.
     */
    async nextToHydrate(limit: number): Promise<Array<HubListing & { id: string; sourceId: string }>> {
      const rows = await sql<Array<{ id: string; source_id: string; external_id: string; canonical_key: string | null; slug: string; name: string; description: string | null; publisher: string | null; source_url: string | null; repository: string | null; path: string | null; version: string | null; license: string | null; popularity: Record<string, number>; popularity_score: string; tags: string[]; locator: Record<string, unknown> }>>`
        select hub_skills.* from hub_skills
        join skill_hub_sources on skill_hub_sources.id = hub_skills.source_id and skill_hub_sources.enabled
        where (hub_skills.status = 'listed' or (hub_skills.status = 'fetch_failed' and hub_skills.updated_at < now() - interval '7 days'))
          and hub_skills.locator is not null
          and not exists (
            select 1 from hub_skills other
            where other.canonical_key = hub_skills.canonical_key and other.id <> hub_skills.id and other.status = 'active'
          )
        order by case skill_hub_sources.trust when 'official' then 0 when 'verified' then 1 else 2 end, hub_skills.popularity_score desc, hub_skills.id
        limit ${limit}
      `;
      return rows.map((row) => ({
        id: row.id, sourceId: row.source_id, externalId: row.external_id, canonicalKey: row.canonical_key, slug: row.slug, name: row.name,
        description: row.description, publisher: row.publisher, sourceUrl: row.source_url, repository: row.repository, path: row.path,
        version: row.version, license: row.license, popularity: row.popularity ?? {}, popularityScore: Number(row.popularity_score) || 0,
        tags: row.tags ?? [], locator: row.locator,
      }));
    },

    async storeHydrated(hubSkillId: string, skill: FetchedHubSkill): Promise<boolean> {
      const hash = contentHash(skill.files);
      const skillMd = skill.files.find((file) => file.path === "SKILL.md")?.content ?? "";
      const fileIndex = skill.files.map((file) => ({ path: file.path, size: file.content.length }));
      const findings = assessHubSkill({ files: skill.files, license: skill.license, upstreamSecurity: skill.upstreamSecurity });
      let changed = false;
      await sql.begin(async (tx) => {
        const [previous] = await tx<{ content_hash: string | null }[]>`select content_hash from hub_skills where id = ${hubSkillId}`;
        changed = previous?.content_hash !== hash;
        await tx`
          update hub_skills set name = ${skill.name.slice(0, 200)}, description = ${skill.description?.slice(0, 2000) ?? null}, version = ${skill.version},
            license = ${skill.license?.slice(0, 200) ?? null}, upstream_security = ${skill.upstreamSecurity === null ? null : tx.json(skill.upstreamSecurity as never)},
            content_hash = ${hash}, skill_md = ${skillMd}, files = ${tx.json(fileIndex as never)}, file_count = ${fileIndex.length},
            status = 'active', fetch_error = null, fetched_at = now(), hydrated_at = now(), updated_at = now()
          where id = ${hubSkillId}
        `;
        if (changed) {
          await tx`delete from hub_skill_files where hub_skill_id = ${hubSkillId}`;
          for (const file of skill.files) {
            await tx`insert into hub_skill_files (hub_skill_id, path, content) values (${hubSkillId}, ${file.path}, ${file.content})`;
          }
        }
        await tx`
          insert into hub_skill_analyses (hub_skill_id, content_hash, findings) values (${hubSkillId}, ${hash}, ${tx.json(findings as never)})
          on conflict (hub_skill_id) do update set content_hash = excluded.content_hash, findings = excluded.findings, updated_at = now()
        `;
      });
      await hub.refreshVerdict(hubSkillId);
      return changed;
    },

    async markFetchFailed(hubSkillId: string, error: string): Promise<void> {
      await sql`update hub_skills set status = 'fetch_failed', fetch_error = ${error.slice(0, 500)}, updated_at = now() where id = ${hubSkillId}`;
    },

    /** Most popular fetched, scanned (not blocked) skills with no live evaluation of their current content. */
    async evalCandidates(limit: number): Promise<string[]> {
      const rows = await sql<{ id: string }[]>`
        select hub_skills.id from hub_skills
        join skill_hub_sources on skill_hub_sources.id = hub_skills.source_id and skill_hub_sources.enabled
        join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
        where hub_skills.status = 'active'
          and hub_skill_analyses.safety_hash = hub_skills.content_hash
          and coalesce(hub_skill_analyses.safety->>'recommendation', '') <> 'DO_NOT_INSTALL'
          and hub_skill_analyses.eval_hash is distinct from hub_skills.content_hash
          and hub_skill_analyses.eval_status not in ('queued', 'running')
          and (hub_skill_analyses.eval_status <> 'failed' or hub_skill_analyses.evaluated_at < now() - interval '3 days')
        order by case skill_hub_sources.trust when 'official' then 0 when 'verified' then 1 else 2 end, hub_skills.popularity_score desc
        limit ${limit}
      `;
      return rows.map((row) => row.id);
    },

    /**
     * Keeps the database under HUB_DB_SOFT_LIMIT_MB by dropping stored package
     * files of fully analysed skills (SKILL.md stays on the skill row; import
     * re-fetches the package from its source when needed).
     */
    async pruneIfNeeded(): Promise<number> {
      const limitMb = Number(process.env.HUB_DB_SOFT_LIMIT_MB) || 380;
      const [size] = await sql<{ mb: number }[]>`select (pg_database_size(current_database()) / 1048576)::int as mb`;
      if (!size || size.mb < limitMb) return 0;
      const result = await sql`
        delete from hub_skill_files where hub_skill_id in (
          select hub_skill_analyses.hub_skill_id from hub_skill_analyses
          where hub_skill_analyses.safety_hash is not null
            and (hub_skill_analyses.eval_status in ('complete', 'needs_review', 'failed') or hub_skill_analyses.eval_status = 'none')
          order by hub_skill_analyses.updated_at asc
          limit 500
        )
      `;
      return result.count;
    },

    async backlogCounts(): Promise<{ listed: number; active: number; failed: number; scanned: number; evaluated: number }> {
      const [row] = await sql<Array<{ listed: number; active: number; failed: number; scanned: number; evaluated: number }>>`
        select
          count(*) filter (where hub_skills.status = 'listed')::int as listed,
          count(*) filter (where hub_skills.status = 'active')::int as active,
          count(*) filter (where hub_skills.status = 'fetch_failed')::int as failed,
          count(*) filter (where hub_skill_analyses.safety_hash is not null)::int as scanned,
          count(*) filter (where hub_skill_analyses.eval_status in ('complete', 'needs_review'))::int as evaluated
        from hub_skills left join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
        where hub_skills.status <> 'removed'
      `;
      return row ?? { listed: 0, active: 0, failed: 0, scanned: 0, evaluated: 0 };
    },
  };
}
