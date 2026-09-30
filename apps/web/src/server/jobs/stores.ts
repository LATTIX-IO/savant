import type { StoredSafetyScan } from "../safety/findings.ts";
import type { SafetyScanResult } from "../safety/skillspector.ts";

type Sql = import("postgres").Sql;

const iso = (value: Date | string | null): string | null => (value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString());

// ── Safety scans ────────────────────────────────────────────────────────

type ScanRow = {
  skill_id: string;
  source_path: string;
  commit_sha: string;
  package_fingerprint: string;
  status: StoredSafetyScan["status"];
  risk_score: number | null;
  severity: string | null;
  recommendation: string | null;
  issues: StoredSafetyScan["issues"];
  llm_used: boolean;
  scanner_version: string | null;
  error: string | null;
  scanned_at: Date | string;
};

const toScan = (row: ScanRow): StoredSafetyScan & { fingerprint: string } => ({
  skillId: row.skill_id,
  sourcePath: row.source_path,
  commitSha: row.commit_sha,
  fingerprint: row.package_fingerprint,
  status: row.status,
  riskScore: row.risk_score,
  severity: row.severity,
  recommendation: row.recommendation,
  issues: row.issues ?? [],
  llmUsed: row.llm_used,
  scannerVersion: row.scanner_version,
  error: row.error,
  scannedAt: iso(row.scanned_at) as string,
});

export function createSafetyScanStore(sql: Sql) {
  return {
    /** Latest scan per package in the repository. */
    async latestForRepository(organizationId: string, repositoryId: string) {
      const rows = await sql<ScanRow[]>`
        select distinct on (source_path) skill_id, source_path, commit_sha, package_fingerprint, status, risk_score, severity,
          recommendation, issues, llm_used, scanner_version, error, scanned_at
        from skill_safety_scans
        where organization_id = ${organizationId} and repository_id = ${repositoryId}
        order by source_path, scanned_at desc
      `;
      return rows.map(toScan);
    },

    async latestForSkill(organizationId: string, skillId: string) {
      const [row] = await sql<ScanRow[]>`
        select skill_id, source_path, commit_sha, package_fingerprint, status, risk_score, severity,
          recommendation, issues, llm_used, scanner_version, error, scanned_at
        from skill_safety_scans
        where organization_id = ${organizationId} and skill_id = ${skillId}
        order by scanned_at desc
        limit 1
      `;
      return row ? toScan(row) : null;
    },

    async record(organizationId: string, repositoryId: string, commitSha: string, result: SafetyScanResult): Promise<void> {
      await sql`
        insert into skill_safety_scans (organization_id, repository_id, skill_id, source_path, commit_sha, package_fingerprint, status,
          risk_score, severity, recommendation, issues, llm_used, scanner_version, error)
        values (${organizationId}, ${repositoryId}, ${result.skillId}, ${result.root}, ${commitSha}, ${result.fingerprint}, ${result.status},
          ${result.riskScore === null ? null : Math.round(result.riskScore)}, ${result.severity}, ${result.recommendation},
          ${sql.json(result.issues as never)}, ${result.llmUsed}, ${result.scannerVersion}, ${result.error})
      `;
    },

    async recordUnavailable(organizationId: string, repositoryId: string, commitSha: string, error: string): Promise<void> {
      await sql`
        insert into skill_safety_scans (organization_id, repository_id, skill_id, source_path, commit_sha, package_fingerprint, status, error)
        values (${organizationId}, ${repositoryId}, '*', '*', ${commitSha}, '*', 'unavailable', ${error.slice(0, 1000)})
      `;
    },

    async clearUnavailable(organizationId: string, repositoryId: string): Promise<void> {
      await sql`delete from skill_safety_scans where organization_id = ${organizationId} and repository_id = ${repositoryId} and status = 'unavailable'`;
    },
  };
}

// ── Evaluation generation runs ──────────────────────────────────────────

export type EvalGenerationRun = {
  id: string;
  repositoryId: string;
  jobId: string | null;
  skillId: string;
  sourcePath: string;
  commitSha: string | null;
  mode: "generate" | "alignment";
  status: "queued" | "running" | "complete" | "needs_review" | "failed";
  trigger: string;
  requestedBy: string;
  rounds: number;
  cases: unknown[];
  samples: unknown[];
  scorecard: Record<string, unknown> | null;
  alignment: Record<string, unknown> | null;
  files: Array<{ path: string; content: string }>;
  proposalId: string | null;
  models: Record<string, unknown>;
  metrics: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type RunRow = {
  id: string; repository_id: string; job_id: string | null; skill_id: string; source_path: string; commit_sha: string | null;
  mode: EvalGenerationRun["mode"]; status: EvalGenerationRun["status"]; trigger: string; requested_by: string; rounds: number;
  cases: unknown[]; samples: unknown[]; scorecard: Record<string, unknown> | null; alignment: Record<string, unknown> | null;
  files: EvalGenerationRun["files"]; proposal_id: string | null; models: Record<string, unknown>; metrics: Record<string, unknown>;
  error: string | null; created_at: Date | string; updated_at: Date | string; completed_at: Date | string | null;
};

const toRun = (row: RunRow): EvalGenerationRun => ({
  id: row.id, repositoryId: row.repository_id, jobId: row.job_id, skillId: row.skill_id, sourcePath: row.source_path, commitSha: row.commit_sha,
  mode: row.mode, status: row.status, trigger: row.trigger, requestedBy: row.requested_by, rounds: row.rounds,
  cases: row.cases ?? [], samples: row.samples ?? [], scorecard: row.scorecard, alignment: row.alignment, files: row.files ?? [],
  proposalId: row.proposal_id, models: row.models ?? {}, metrics: row.metrics ?? {}, error: row.error,
  createdAt: iso(row.created_at) as string, updatedAt: iso(row.updated_at) as string, completedAt: iso(row.completed_at),
});

export function createEvalGenerationStore(sql: Sql) {
  return {
    async create(organizationId: string, input: { repositoryId: string; skillId: string; sourcePath: string; mode: EvalGenerationRun["mode"]; trigger: string; requestedBy: string }): Promise<EvalGenerationRun> {
      const [row] = await sql<RunRow[]>`
        insert into eval_generation_runs (organization_id, repository_id, skill_id, source_path, mode, trigger, requested_by)
        values (${organizationId}, ${input.repositoryId}, ${input.skillId}, ${input.sourcePath}, ${input.mode}, ${input.trigger}, ${input.requestedBy})
        returning *
      `;
      return toRun(row as RunRow);
    },

    async get(organizationId: string, id: string): Promise<EvalGenerationRun | null> {
      const [row] = await sql<RunRow[]>`select * from eval_generation_runs where organization_id = ${organizationId} and id = ${id}`;
      return row ? toRun(row) : null;
    },

    async listForSkill(organizationId: string, skillId: string, limit = 5): Promise<EvalGenerationRun[]> {
      const rows = await sql<RunRow[]>`
        select * from eval_generation_runs where organization_id = ${organizationId} and skill_id = ${skillId}
        order by created_at desc limit ${limit}
      `;
      return rows.map(toRun);
    },

    async active(organizationId: string, skillId: string): Promise<EvalGenerationRun | null> {
      const [row] = await sql<RunRow[]>`
        select * from eval_generation_runs where organization_id = ${organizationId} and skill_id = ${skillId} and status in ('queued', 'running')
        order by created_at desc limit 1
      `;
      return row ? toRun(row) : null;
    },

    async update(organizationId: string, id: string, patch: Partial<Pick<EvalGenerationRun, "jobId" | "commitSha" | "status" | "rounds" | "cases" | "samples" | "scorecard" | "alignment" | "files" | "proposalId" | "models" | "metrics" | "error">> & { completed?: boolean }): Promise<void> {
      const json = (value: unknown) => (value === undefined ? null : sql.json(value as never));
      await sql`
        update eval_generation_runs set
          job_id = coalesce(${patch.jobId ?? null}, job_id),
          commit_sha = coalesce(${patch.commitSha ?? null}, commit_sha),
          status = coalesce(${patch.status ?? null}, status),
          rounds = coalesce(${patch.rounds ?? null}, rounds),
          cases = coalesce(${json(patch.cases)}::jsonb, cases),
          samples = coalesce(${json(patch.samples)}::jsonb, samples),
          scorecard = coalesce(${json(patch.scorecard)}::jsonb, scorecard),
          alignment = coalesce(${json(patch.alignment)}::jsonb, alignment),
          files = coalesce(${json(patch.files)}::jsonb, files),
          proposal_id = coalesce(${patch.proposalId ?? null}, proposal_id),
          models = coalesce(${json(patch.models)}::jsonb, models),
          metrics = coalesce(${json(patch.metrics)}::jsonb, metrics),
          error = ${patch.error === undefined ? sql`error` : patch.error},
          completed_at = ${patch.completed ? sql`now()` : sql`completed_at`},
          updated_at = now()
        where organization_id = ${organizationId} and id = ${id}
      `;
    },
  };
}
