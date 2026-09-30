import { readAiServiceConfig, createJevClient, createNimChatClient, AiServiceError } from "../ai/clients.ts";
import { EvalGenerationError, generateEvaluationSet } from "../evaluation/eval-generation.ts";
import { logGitEvent } from "../git/redaction.ts";
import type { BackgroundJob, JobQueue } from "../jobs/queue.ts";
import { runSkillSpectorScans, SafetyScanUnavailableError, type ScanPackage } from "../safety/skillspector.ts";
import { fetchClawHubSource, fetchGithubSource, fetchSkillsMpSource, fetchSkillsShSource, HubFetchError, type FetchedHubSkill } from "./fetchers.ts";
import { createHubStore } from "./store.ts";

type Sql = import("postgres").Sql;

export type HubJobContext = { sql: Sql; queue: JobQueue; deadline: number };

/** Root placeholder in stored generated eval files; replaced with the import target on import. */
export const EVAL_ROOT_PLACEHOLDER = "__SKILL_ROOT__";

const timeLeft = (ctx: HubJobContext) => ctx.deadline - Date.now();

async function skillsShToken(): Promise<string> {
  const fromEnv = process.env.VERCEL_OIDC_TOKEN?.trim();
  try {
    const { getVercelOidcToken } = await import("@vercel/oidc");
    return await getVercelOidcToken();
  } catch (error) {
    if (fromEnv) return fromEnv;
    throw new HubFetchError(`skills.sh needs a Vercel OIDC token (${error instanceof Error ? error.message : String(error)}).`);
  }
}

export async function enqueueHubSync(queue: JobQueue, sourceIds: readonly string[]) {
  for (const sourceId of sourceIds) {
    await queue.enqueue({ organizationId: null, repositoryId: null, kind: "hub_sync", dedupeKey: `source:${sourceId}`, payload: { sourceId } });
  }
}

export async function enqueueHubEval(sql: Sql, queue: JobQueue, hubSkillId: string, trigger: string) {
  const store = createHubStore(sql);
  await store.setEvalStatus(hubSkillId, "queued");
  return queue.enqueue({ organizationId: null, repositoryId: null, kind: "hub_eval", dedupeKey: `skill:${hubSkillId}`, payload: { hubSkillId, trigger } });
}

export async function runHubSync(ctx: HubJobContext, job: BackgroundJob): Promise<"done" | "released"> {
  const store = createHubStore(ctx.sql);
  const sourceId = String(job.payload.sourceId);
  const source = (await store.listSources()).find((candidate) => candidate.id === sourceId);
  if (!source || !source.enabled) return "done";

  let skills: FetchedHubSkill[];
  try {
    skills = source.kind === "github" ? await fetchGithubSource(source)
      : source.kind === "skills_sh" ? await fetchSkillsShSource(source, await skillsShToken())
      : source.kind === "clawhub" ? await fetchClawHubSource(source)
      : await fetchSkillsMpSource(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.recordSourceSync(sourceId, { status: "error", error: message });
    logGitEvent("warn", "hub_source_sync_failed", { error: message });
    return "done";
  }

  const result = await store.upsertFetched(sourceId, skills);
  await store.recordSourceSync(sourceId, { status: "ok", count: result.total });

  // Follow-ups: safety scan anything new or changed; live-evaluate the top of the source.
  await ctx.queue.enqueue({ organizationId: null, repositoryId: null, kind: "hub_safety", dedupeKey: "pending", payload: {} });
  const autoLimit = Number(process.env.HUB_AUTO_EVAL_LIMIT ?? 3);
  const config = readAiServiceConfig();
  if (autoLimit > 0 && config.nim && config.jev) {
    const [top] = await Promise.all([ctx.sql<{ id: string }[]>`
      select hub_skills.id from hub_skills
      join hub_skill_analyses on hub_skill_analyses.hub_skill_id = hub_skills.id
      where hub_skills.source_id = ${sourceId} and hub_skills.status = 'active'
        and hub_skill_analyses.eval_hash is distinct from hub_skills.content_hash
        and hub_skill_analyses.eval_status not in ('queued', 'running')
      order by hub_skills.rank asc limit ${autoLimit}
    `]);
    for (const row of top ?? []) {
      await enqueueHubEval(ctx.sql, ctx.queue, row.id, "sync");
    }
  }
  return "done";
}

export async function runHubSafety(ctx: HubJobContext, job: BackgroundJob): Promise<"done" | "released"> {
  const store = createHubStore(ctx.sql);
  const chunkSize = Number(process.env.HUB_SAFETY_CHUNK ?? 12);
  const nimKey = readAiServiceConfig().nim?.apiKey ?? null;
  const llmAll = (process.env.SKILLSPECTOR_LLM ?? "flagged").toLowerCase() === "all";

  for (;;) {
    if (timeLeft(ctx) < 150_000) {
      await ctx.queue.release(job.id, job.progress);
      return "released";
    }
    const batch = await store.needingSafety(chunkSize);
    if (batch.length === 0) return "done";
    const packages: ScanPackage[] = [];
    for (const item of batch) {
      const files = await store.filesFor(item.id);
      packages.push({ root: item.id, skillId: item.slug, tier: "hub", files: Object.fromEntries(files.map((file) => [file.path, file.content])) });
    }
    let results;
    try {
      results = await runSkillSpectorScans(packages, { llmRoots: llmAll ? new Set(packages.map((item) => item.root)) : new Set(), nimApiKey: nimKey, deadlineSec: Math.floor((timeLeft(ctx) - 60_000) / 1000) });
    } catch (error) {
      if (error instanceof SafetyScanUnavailableError) {
        await store.recordSafetyUnavailable(batch.map((item) => item.id), error.message);
        return "done";
      }
      throw error;
    }
    const hashById = new Map(batch.map((item) => [item.id, item.contentHash]));
    for (const result of results) {
      // Packages the sandbox had no time for come back "skipped" and stay pending.
      if (result.error === "skipped") continue;
      await store.recordSafety(result.root, hashById.get(result.root) as string, result);
    }
    if (results.every((result) => result.error === "skipped")) {
      await ctx.queue.release(job.id, job.progress);
      return "released";
    }
    await ctx.queue.saveProgress(job.id, { scanned: ((job.progress.scanned as number) ?? 0) + results.length });
  }
}

export async function runHubEval(ctx: HubJobContext, job: BackgroundJob): Promise<"done" | "released"> {
  const store = createHubStore(ctx.sql);
  const hubSkillId = String(job.payload.hubSkillId);
  const skill = await store.skillForEval(hubSkillId);
  if (!skill || !skill.skill_md) return "done";
  if (skill.eval_hash === skill.content_hash && (skill.eval_status === "complete" || skill.eval_status === "needs_review")) return "done";
  if (timeLeft(ctx) < 200_000) {
    await ctx.queue.release(job.id, job.progress);
    return "released";
  }
  const config = readAiServiceConfig();
  if (!config.nim || !config.jev) {
    await store.setEvalStatus(hubSkillId, "failed", "Live evaluation needs NVIDIA_NIM_API_KEY and JEV_API_KEY.");
    return "done";
  }

  await store.setEvalStatus(hubSkillId, "running");
  try {
    const result = await generateEvaluationSet({
      generator: createNimChatClient(config.nim, config.nim.generationModel),
      executor: createNimChatClient(config.nim, config.nim.executionModel),
      judge: createJevClient(config.jev),
    }, {
      skill: { skillId: skill.slug, displayName: skill.name, root: EVAL_ROOT_PLACEHOLDER, instructions: skill.skill_md, version: null },
      costPerMillionTokens: Number(process.env.NIM_USD_PER_MTOK) || 0.5,
    });
    const verdictByCase = new Map(result.samples.map((sample) => [sample.caseId, sample.verdict]));
    await store.recordEval(hubSkillId, {
      hash: skill.content_hash ?? "",
      status: result.status,
      evaluation: {
        scorecard: result.scorecard,
        metrics: { ...result.metrics, rounds: result.rounds },
        models: result.models,
        cases: result.cases.map((item) => ({ caseId: item.caseId, kind: item.kind, prompt: item.prompt.slice(0, 600), decision: item.validation.decision, reasons: item.validation.reasons, verdict: verdictByCase.get(item.caseId) ?? null })),
        samples: result.samples.map(({ output, ...rest }) => ({ ...rest, output: output.slice(0, 1500) })),
      },
      files: result.files,
    });
    return "done";
  } catch (error) {
    const message = error instanceof EvalGenerationError || error instanceof AiServiceError ? error.message : `Live evaluation failed: ${error instanceof Error ? error.message : String(error)}`;
    if (error instanceof AiServiceError && (error.status === null || error.status === 429 || error.status >= 500) && job.attempts < 3) {
      await store.setEvalStatus(hubSkillId, "queued", `${message} Retrying.`);
      await ctx.queue.release(job.id, job.progress);
      return "released";
    }
    await store.setEvalStatus(hubSkillId, "failed", message.slice(0, 1500));
    return "done";
  }
}
