import { readAiServiceConfig } from "../ai/clients.ts";
import { createJobQueue } from "./queue.ts";
import { createEvalGenerationStore, type EvalGenerationRun } from "./stores.ts";

type Sql = import("postgres").Sql;

export async function queueSafetyScan(sql: Sql, input: { organizationId: string; repositoryId: string; commitSha: string }) {
  if (process.env.SKILLSPECTOR_ENABLED === "0") {
    return null;
  }
  return createJobQueue(sql).enqueue({
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    kind: "safety_scan",
    dedupeKey: `${input.repositoryId}:${input.commitSha}`,
    payload: { commitSha: input.commitSha },
  });
}

export async function queueEvalGeneration(sql: Sql, input: {
  organizationId: string;
  repositoryId: string;
  skillId: string;
  sourcePath: string;
  mode: EvalGenerationRun["mode"];
  trigger: string;
  requestedBy: string;
}): Promise<EvalGenerationRun> {
  const runs = createEvalGenerationStore(sql);
  const active = await runs.active(input.organizationId, input.skillId);
  if (active) {
    return active;
  }
  const run = await runs.create(input.organizationId, input);
  const job = await createJobQueue(sql).enqueue({
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    kind: "eval_generation",
    dedupeKey: `skill:${input.skillId}`,
    payload: { runId: run.id },
  });
  await runs.update(input.organizationId, run.id, { jobId: job.id });
  return { ...run, jobId: job.id };
}

/**
 * After a sync, queues generation for skills that have no scored evaluation
 * set — bounded per sync, and not repeated for a skill that was generated
 * recently (or is waiting on review of a generated set).
 */
export async function queueAutoEvalGeneration(sql: Sql, input: {
  organizationId: string;
  repositoryId: string;
  requestedBy: string;
  candidates: ReadonlyArray<{ skillId: string; sourcePath: string }>;
}): Promise<number> {
  const config = readAiServiceConfig();
  const limit = Number(process.env.EVAL_GENERATION_AUTO_LIMIT ?? 3);
  if (!config.nim || !config.jev || limit <= 0 || input.candidates.length === 0) {
    return 0;
  }
  const recent = await sql<{ skill_id: string }[]>`
    select distinct skill_id from eval_generation_runs
    where organization_id = ${input.organizationId}
      and skill_id = any(${input.candidates.map((item) => item.skillId)}::text[])
      and (status in ('queued', 'running', 'complete', 'needs_review') and created_at > now() - interval '14 days'
        or status = 'failed' and created_at > now() - interval '1 day')
  `;
  const skip = new Set(recent.map((row) => row.skill_id));
  let queued = 0;
  for (const candidate of input.candidates) {
    if (queued >= limit) break;
    if (skip.has(candidate.skillId)) continue;
    await queueEvalGeneration(sql, { ...input, ...candidate, mode: "generate", trigger: "sync" });
    queued += 1;
  }
  return queued;
}
