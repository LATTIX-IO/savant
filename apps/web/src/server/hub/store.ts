import type { SafetyScanResult } from "../safety/skillspector.ts";
import { assessHubSkill, computeVerdict, type HubFinding } from "./analysis.ts";
import { contentHash, type FetchedHubSkill, type HubFile, type HubSourceConfig } from "./fetchers.ts";

type Sql = import("postgres").Sql;

export type HubSourceRow = HubSourceConfig & {
  name: string;
  trust: "official" | "verified" | "community";
  homepage: string | null;
  description: string | null;
  enabled: boolean;
  skillCount: number;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

export function createHubStore(sql: Sql) {
  async function refreshVerdict(hubSkillId: string): Promise<void> {
    const [row] = await sql<{ findings: HubFinding[]; safety: { recommendation?: string | null; riskScore?: number | null } | null; eval_status: string; eval: { scorecard?: { overallScore?: number } } | null }[]>`
      select findings, safety, eval_status, eval from hub_skill_analyses where hub_skill_id = ${hubSkillId}
    `;
    if (!row) return;
    const verdict = computeVerdict({
      findings: row.findings ?? [],
      safetyRecommendation: row.safety?.recommendation ?? null,
      safetyRiskScore: row.safety?.riskScore ?? null,
      evalStatus: row.eval_status,
      evalScore: row.eval?.scorecard?.overallScore ?? null,
    });
    await sql`update hub_skill_analyses set verdict = ${verdict}, updated_at = now() where hub_skill_id = ${hubSkillId}`;
  }

  return {
    refreshVerdict,

    async listSources(): Promise<HubSourceRow[]> {
      const rows = await sql<Array<{
        id: string; name: string; kind: HubSourceConfig["kind"]; publisher: string; trust: HubSourceRow["trust"]; homepage: string | null; description: string | null;
        config: Record<string, unknown>; enabled: boolean; max_skills: number; skill_count: number; last_synced_at: Date | null; last_status: string | null; last_error: string | null;
      }>>`select * from skill_hub_sources order by sort_order asc, id asc`;
      return rows.map((row) => ({
        id: row.id, name: row.name, kind: row.kind, publisher: row.publisher, trust: row.trust, homepage: row.homepage, description: row.description,
        config: row.config ?? {}, enabled: row.enabled, maxSkills: row.max_skills, skillCount: row.skill_count,
        lastSyncedAt: iso(row.last_synced_at), lastStatus: row.last_status, lastError: row.last_error,
      }));
    },

    async recordSourceSync(sourceId: string, result: { status: "ok" | "error"; error?: string | null; count?: number }): Promise<void> {
      await sql`
        update skill_hub_sources set last_synced_at = now(), last_status = ${result.status}, last_error = ${result.error?.slice(0, 1000) ?? null},
          skill_count = coalesce(${result.count ?? null}, skill_count)
        where id = ${sourceId}
      `;
    },

    /**
     * Upserts a source's fetched skills. Unchanged content keeps its analysis;
     * changed content replaces the files and resets analysis. Skills that
     * disappeared upstream are marked removed (kept for provenance).
     */
    async upsertFetched(sourceId: string, skills: readonly FetchedHubSkill[]): Promise<{ changed: string[]; total: number }> {
      const changed: string[] = [];
      await sql.begin(async (tx) => {
        const existing = new Map((await tx<{ id: string; external_id: string; content_hash: string | null }[]>`
          select id, external_id, content_hash from hub_skills where source_id = ${sourceId}
        `).map((row) => [row.external_id, row]));

        for (const skill of skills) {
          const hash = contentHash(skill.files);
          const previous = existing.get(skill.externalId);
          const fileIndex = skill.files.map((file) => ({ path: file.path, size: file.content.length }));
          const skillMd = skill.files.find((file) => file.path === "SKILL.md")?.content ?? "";
          const [row] = await tx<{ id: string }[]>`
            insert into hub_skills (source_id, external_id, canonical_key, slug, name, description, publisher, source_url, repository, path, version, license,
              popularity, rank, tags, upstream_security, content_hash, skill_md, files, file_count, status, fetch_error, fetched_at, updated_at)
            values (${sourceId}, ${skill.externalId}, ${skill.canonicalKey}, ${skill.slug}, ${skill.name.slice(0, 200)}, ${skill.description?.slice(0, 2000) ?? null},
              ${skill.publisher}, ${skill.sourceUrl}, ${skill.repository}, ${skill.path}, ${skill.version}, ${skill.license?.slice(0, 200) ?? null},
              ${tx.json(skill.popularity as never)}, ${skill.rank}, ${skill.tags.slice(0, 12)}, ${skill.upstreamSecurity === null ? null : tx.json(skill.upstreamSecurity as never)},
              ${hash}, ${skillMd}, ${tx.json(fileIndex as never)}, ${fileIndex.length}, 'active', null, now(), now())
            on conflict (source_id, external_id) do update set
              canonical_key = excluded.canonical_key, slug = excluded.slug, name = excluded.name, description = excluded.description,
              publisher = excluded.publisher, source_url = excluded.source_url, repository = excluded.repository, path = excluded.path,
              version = excluded.version, license = excluded.license, popularity = excluded.popularity, rank = excluded.rank, tags = excluded.tags,
              upstream_security = excluded.upstream_security, content_hash = excluded.content_hash, skill_md = excluded.skill_md,
              files = excluded.files, file_count = excluded.file_count, status = 'active', fetch_error = null, fetched_at = now(), updated_at = now()
            returning id
          `;
          const id = (row as { id: string }).id;
          const findings = assessHubSkill({ files: skill.files, license: skill.license, upstreamSecurity: skill.upstreamSecurity });
          if (!previous || previous.content_hash !== hash) {
            changed.push(id);
            await tx`delete from hub_skill_files where hub_skill_id = ${id}`;
            for (const file of skill.files) {
              await tx`insert into hub_skill_files (hub_skill_id, path, content) values (${id}, ${file.path}, ${file.content})`;
            }
          }
          await tx`
            insert into hub_skill_analyses (hub_skill_id, content_hash, findings)
            values (${id}, ${hash}, ${tx.json(findings as never)})
            on conflict (hub_skill_id) do update set content_hash = excluded.content_hash, findings = excluded.findings, updated_at = now()
          `;
        }

        const seen = skills.map((skill) => skill.externalId);
        await tx`
          update hub_skills set status = 'removed', updated_at = now()
          where source_id = ${sourceId} and status = 'active' and not (external_id = any(${seen}::text[]))
        `;
      });
      const ids = await sql<{ id: string }[]>`select id from hub_skills where source_id = ${sourceId} and status = 'active'`;
      for (const { id } of ids) await refreshVerdict(id);
      return { changed, total: skills.length };
    },

    async filesFor(hubSkillId: string): Promise<HubFile[]> {
      return sql<HubFile[]>`select path, content from hub_skill_files where hub_skill_id = ${hubSkillId} order by path`;
    },

    /** Active skills whose current content hasn't been safety-scanned. */
    async needingSafety(limit: number): Promise<Array<{ id: string; slug: string; contentHash: string }>> {
      const rows = await sql<{ id: string; slug: string; content_hash: string }[]>`
        select hub_skills.id, hub_skills.slug, hub_skills.content_hash
        from hub_skills
        join skill_hub_sources on skill_hub_sources.id = hub_skills.source_id
        left join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
        where hub_skills.status = 'active' and hub_skills.content_hash is not null
          and hub_skill_analyses.safety_hash is distinct from hub_skills.content_hash
        order by case skill_hub_sources.trust when 'official' then 0 when 'verified' then 1 else 2 end, hub_skills.rank asc nulls last
        limit ${limit}
      `;
      return rows.map((row) => ({ id: row.id, slug: row.slug, contentHash: row.content_hash }));
    },

    async recordSafety(hubSkillId: string, hash: string, result: SafetyScanResult): Promise<void> {
      const safety = {
        status: result.status,
        riskScore: result.riskScore,
        severity: result.severity,
        recommendation: result.recommendation,
        issues: result.issues,
        llmUsed: result.llmUsed,
        scannerVersion: result.scannerVersion,
        error: result.error,
        scannedAt: new Date().toISOString(),
      };
      await sql`
        update hub_skill_analyses set safety = ${sql.json(safety as never)}, safety_hash = ${hash}, safety_scanned_at = now(), updated_at = now()
        where hub_skill_id = ${hubSkillId}
      `;
      await refreshVerdict(hubSkillId);
    },

    async recordSafetyUnavailable(ids: readonly string[], error: string): Promise<void> {
      await sql`
        update hub_skill_analyses set safety = ${sql.json({ status: "unavailable", error: error.slice(0, 500) } as never)}, updated_at = now()
        where hub_skill_id = any(${[...ids]}::uuid[])
      `;
    },

    /** Top skills (official first, then by rank) with no live evaluation of their current content. */
    async candidatesForEval(limit: number): Promise<string[]> {
      const rows = await sql<{ id: string }[]>`
        select hub_skills.id
        from hub_skills
        join skill_hub_sources on skill_hub_sources.id = hub_skills.source_id
        join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
        where hub_skills.status = 'active'
          and hub_skill_analyses.eval_hash is distinct from hub_skills.content_hash
          and hub_skill_analyses.eval_status not in ('queued', 'running')
          and (hub_skill_analyses.eval_status <> 'failed' or hub_skill_analyses.evaluated_at < now() - interval '1 day' or hub_skill_analyses.evaluated_at is null)
        order by case skill_hub_sources.trust when 'official' then 0 when 'verified' then 1 else 2 end, hub_skills.rank asc nulls last
        limit ${limit}
      `;
      return rows.map((row) => row.id);
    },

    async skillForEval(hubSkillId: string) {
      const [row] = await sql<{ id: string; slug: string; name: string; skill_md: string | null; content_hash: string | null; eval_status: string; eval_hash: string | null }[]>`
        select hub_skills.id, hub_skills.slug, hub_skills.name, hub_skills.skill_md, hub_skills.content_hash, hub_skill_analyses.eval_status, hub_skill_analyses.eval_hash
        from hub_skills join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
        where hub_skills.id = ${hubSkillId}
      `;
      return row ?? null;
    },

    async setEvalStatus(hubSkillId: string, status: "queued" | "running" | "failed", error: string | null = null): Promise<void> {
      await sql`
        update hub_skill_analyses set eval_status = ${status}, eval_error = ${error},
          evaluated_at = case when ${status} = 'failed' then now() else evaluated_at end, updated_at = now()
        where hub_skill_id = ${hubSkillId}
      `;
      if (status === "failed") await refreshVerdict(hubSkillId);
    },

    async recordEval(hubSkillId: string, input: { hash: string; status: "complete" | "needs_review"; evaluation: Record<string, unknown>; files: Array<{ path: string; content: string }> }): Promise<void> {
      await sql`
        update hub_skill_analyses set eval_status = ${input.status}, eval_hash = ${input.hash}, eval = ${sql.json(input.evaluation as never)},
          eval_files = ${sql.json(input.files as never)}, eval_error = null, evaluated_at = now(), updated_at = now()
        where hub_skill_id = ${hubSkillId}
      `;
      await refreshVerdict(hubSkillId);
    },
  };
}

export type HubStore = ReturnType<typeof createHubStore>;
