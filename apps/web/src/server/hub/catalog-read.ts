import type { HubFinding, HubVerdict } from "./analysis.ts";

type Sql = import("postgres").Sql;

/**
 * Read model for the public skill catalog. Everything here is safe to show
 * anonymously: upstream metadata and Savant's own analysis. Nothing is
 * tenant-specific.
 */

export type CatalogSafety = {
  status: string;
  riskScore: number | null;
  severity: string | null;
  recommendation: string | null;
  issues: Array<{ id: string; category: string; severity: string; title: string; file: string | null; line: number | null; explanation?: string | null; remediation?: string | null }>;
  llmUsed?: boolean;
  scannerVersion?: string | null;
  error?: string | null;
  scannedAt?: string;
};

export type CatalogEvaluation = {
  scorecard?: { overallScore?: number; qualityScore?: number; complianceScore?: number; groundingScore?: number; actionabilityScore?: number; efficiencyScore?: number; passCount?: number; investigateCount?: number; failCount?: number; sampleCount?: number };
  metrics?: { drafted?: number; accepted?: number; rejected?: number; needsReview?: number; rounds?: number; durationMs?: number };
  models?: { generator?: string; executor?: string; judge?: string };
  cases?: Array<{ caseId: string; kind: string; prompt: string; decision: string; verdict: string | null }>;
};

export type CatalogSkillSummary = {
  id: string;
  sourceId: string;
  sourceName: string;
  trust: "official" | "verified" | "community";
  slug: string;
  name: string;
  description: string | null;
  publisher: string | null;
  sourceUrl: string | null;
  license: string | null;
  version: string | null;
  popularity: Record<string, number>;
  tags: string[];
  fileCount: number;
  verdict: HubVerdict;
  safetyRecommendation: string | null;
  riskScore: number | null;
  evalStatus: string;
  evalScore: number | null;
  alsoOn: string[];
  updatedAt: string;
};

export type CatalogSkillDetail = CatalogSkillSummary & {
  repository: string | null;
  path: string | null;
  skillMd: string;
  files: Array<{ path: string; size: number }>;
  findings: HubFinding[];
  safety: CatalogSafety | null;
  evaluation: CatalogEvaluation | null;
  evalError: string | null;
  evaluatedAt: string | null;
  upstreamSecurity: unknown;
  contentHash: string | null;
};

export type CatalogSource = {
  id: string;
  name: string;
  publisher: string;
  trust: "official" | "verified" | "community";
  homepage: string | null;
  description: string | null;
  skillCount: number;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

export type CatalogQuery = { q?: string | null; source?: string | null; verdict?: string | null; limit?: number; offset?: number };

type SummaryRow = {
  id: string; source_id: string; source_name: string; trust: CatalogSkillSummary["trust"]; slug: string; name: string; description: string | null;
  publisher: string | null; source_url: string | null; license: string | null; version: string | null; popularity: Record<string, number>; tags: string[];
  file_count: number; verdict: HubVerdict | null; safety: CatalogSafety | null; eval_status: string | null; eval: CatalogEvaluation | null;
  also_on: string[] | null; updated_at: Date | string; canonical_key: string | null;
};

const VERDICTS = new Set(["validated", "analyzed", "caution", "unsafe", "unverified"]);

function toSummary(row: SummaryRow): CatalogSkillSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    trust: row.trust,
    slug: row.slug,
    name: row.name,
    description: row.description,
    publisher: row.publisher,
    sourceUrl: row.source_url,
    license: row.license,
    version: row.version,
    popularity: row.popularity ?? {},
    tags: row.tags ?? [],
    fileCount: row.file_count,
    verdict: row.verdict ?? "unverified",
    safetyRecommendation: row.safety?.recommendation ?? null,
    riskScore: row.safety?.riskScore ?? null,
    evalStatus: row.eval_status ?? "none",
    evalScore: row.eval?.scorecard?.overallScore ?? null,
    alsoOn: (row.also_on ?? []).filter((name) => name !== row.source_name),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listCatalog(sql: Sql, query: CatalogQuery = {}): Promise<{ items: CatalogSkillSummary[]; total: number }> {
  const limit = Math.min(Math.max(query.limit ?? 48, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const q = query.q?.trim().slice(0, 100) || null;
  const pattern = q ? `%${q.replace(/[%_\\]/g, (char) => `\\${char}`)}%` : null;
  const source = query.source?.trim() || null;
  const verdict = query.verdict && VERDICTS.has(query.verdict) ? query.verdict : null;

  // One row per upstream skill (canonical key): prefer the most trusted, best-ranked listing.
  const rows = await sql<Array<SummaryRow & { total: number }>>`
    with ranked as (
      select hub_skills.*, skill_hub_sources.name as source_name, skill_hub_sources.trust,
        hub_skill_analyses.verdict, hub_skill_analyses.safety, hub_skill_analyses.eval_status, hub_skill_analyses.eval,
        row_number() over (
          partition by coalesce(hub_skills.canonical_key, hub_skills.id::text)
          order by case skill_hub_sources.trust when 'official' then 0 when 'verified' then 1 else 2 end, skill_hub_sources.sort_order, hub_skills.rank
        ) as listing_rank,
        array_agg(skill_hub_sources.name) over (partition by coalesce(hub_skills.canonical_key, hub_skills.id::text)) as also_on
      from hub_skills
      join skill_hub_sources on skill_hub_sources.id = hub_skills.source_id and skill_hub_sources.enabled
      left join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
      where hub_skills.status = 'active'
        and (${source}::text is null or hub_skills.source_id = ${source})
        and (${pattern}::text is null or hub_skills.name ilike ${pattern} or hub_skills.description ilike ${pattern} or hub_skills.publisher ilike ${pattern} or hub_skills.slug ilike ${pattern})
    )
    select *, count(*) over ()::int as total from ranked
    where listing_rank = 1 and (${verdict}::text is null or coalesce(verdict, 'unverified') = ${verdict})
    order by case trust when 'official' then 0 when 'verified' then 1 else 2 end,
      case coalesce(verdict, 'unverified') when 'validated' then 0 when 'analyzed' then 1 when 'unverified' then 2 when 'caution' then 3 else 4 end,
      coalesce((popularity->>'installs')::numeric, (popularity->>'downloads')::numeric, (popularity->>'stars')::numeric, 0) desc,
      rank asc
    limit ${limit} offset ${offset}
  `;
  return { items: rows.map(toSummary), total: rows[0]?.total ?? 0 };
}

export async function getCatalogSkill(sql: Sql, id: string): Promise<CatalogSkillDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<Array<SummaryRow & {
    repository: string | null; path: string | null; skill_md: string | null; files: Array<{ path: string; size: number }>;
    findings: HubFinding[] | null; eval_error: string | null; evaluated_at: Date | null; upstream_security: unknown; content_hash: string | null;
  }>>`
    select hub_skills.*, skill_hub_sources.name as source_name, skill_hub_sources.trust,
      hub_skill_analyses.verdict, hub_skill_analyses.safety, hub_skill_analyses.eval_status, hub_skill_analyses.eval,
      hub_skill_analyses.findings, hub_skill_analyses.eval_error, hub_skill_analyses.evaluated_at,
      (select array_agg(other_source.name) from hub_skills other join skill_hub_sources other_source on other_source.id = other.source_id
        where other.canonical_key = hub_skills.canonical_key and other.status = 'active') as also_on
    from hub_skills
    join skill_hub_sources on skill_hub_sources.id = hub_skills.source_id
    left join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
    where hub_skills.id = ${id}
  `;
  if (!row) return null;
  return {
    ...toSummary(row),
    repository: row.repository,
    path: row.path,
    skillMd: row.skill_md ?? "",
    files: row.files ?? [],
    findings: row.findings ?? [],
    safety: row.safety,
    evaluation: row.eval,
    evalError: row.eval_error,
    evaluatedAt: row.evaluated_at ? new Date(row.evaluated_at).toISOString() : null,
    upstreamSecurity: row.upstream_security,
    contentHash: row.content_hash,
  };
}

export async function listCatalogSources(sql: Sql): Promise<CatalogSource[]> {
  const rows = await sql<Array<{ id: string; name: string; publisher: string; trust: CatalogSource["trust"]; homepage: string | null; description: string | null; skill_count: number; last_synced_at: Date | null; last_status: string | null; last_error: string | null }>>`
    select id, name, publisher, trust, homepage, description,
      (select count(*)::int from hub_skills where hub_skills.source_id = skill_hub_sources.id and hub_skills.status = 'active') as skill_count,
      last_synced_at, last_status, last_error
    from skill_hub_sources where enabled order by sort_order, id
  `;
  return rows.map((row) => ({
    id: row.id, name: row.name, publisher: row.publisher, trust: row.trust, homepage: row.homepage, description: row.description,
    skillCount: row.skill_count, lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    lastStatus: row.last_status, lastError: row.last_error,
  }));
}

export async function catalogStats(sql: Sql): Promise<{ skills: number; validated: number; evaluated: number; scanned: number; flagged: number }> {
  const [row] = await sql<Array<{ skills: number; validated: number; evaluated: number; scanned: number; flagged: number }>>`
    select count(*)::int as skills,
      count(*) filter (where hub_skill_analyses.verdict = 'validated')::int as validated,
      count(*) filter (where hub_skill_analyses.eval_status in ('complete', 'needs_review'))::int as evaluated,
      count(*) filter (where hub_skill_analyses.safety_hash is not null)::int as scanned,
      count(*) filter (where hub_skill_analyses.verdict in ('caution', 'unsafe'))::int as flagged
    from hub_skills left join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
    where hub_skills.status = 'active'
  `;
  return row ?? { skills: 0, validated: 0, evaluated: 0, scanned: 0, flagged: 0 };
}
