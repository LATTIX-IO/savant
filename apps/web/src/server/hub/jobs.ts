import { readAiServiceConfig, createJevClient, createNimChatClient, AiServiceError } from "../ai/clients.ts";
import { EvalGenerationError, generateEvaluationSet } from "../evaluation/eval-generation.ts";
import { executionLimitations, liveRunInstructions } from "../evaluation/limitations.ts";
import { logGitEvent } from "../git/redaction.ts";
import type { BackgroundJob, JobQueue } from "../jobs/queue.ts";
import { runSkillSpectorScans, SafetyScanUnavailableError, type ScanPackage } from "../safety/skillspector.ts";
import { createBacklogStore } from "./backlog-store.ts";
import { HubFetchError } from "./fetchers.ts";
import { hydrateListing, listSourcePage } from "./listing.ts";
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

/**
 * Enumerates a source completely, page by page. The cursor is saved after
 * every page, so a run that runs out of time resumes where it stopped; when
 * the last page is in, listings not seen in this run are marked removed.
 */
export async function runHubSync(ctx: HubJobContext, job: BackgroundJob): Promise<"done" | "released"> {
  const store = createHubStore(ctx.sql);
  const backlog = createBacklogStore(ctx.sql);
  const sourceId = String(job.payload.sourceId);
  const source = (await store.listSources()).find((candidate) => candidate.id === sourceId);
  if (!source || !source.enabled) return "done";

  const saved = (source as unknown as { enumeration?: Record<string, unknown> }).enumeration ?? {};
  const resume = typeof saved.runId === "string" && !saved.completedAt;
  const state = {
    runId: resume ? String(saved.runId) : `run-${Date.now().toString(36)}`,
    cursor: resume ? (saved.cursor as string | null) ?? null : null,
    pages: resume ? Number(saved.pages) || 0 : 0,
    seen: resume ? Number(saved.seen) || 0 : 0,
    total: (saved.total as number | null | undefined) ?? null,
    startedAt: resume ? String(saved.startedAt) : new Date().toISOString(),
    completedAt: null as string | null,
    quotaExhaustedAt: null as string | null,
  };

  try {
    for (;;) {
      if (timeLeft(ctx) < 45_000) {
        await backlog.saveEnumeration(sourceId, state);
        await ctx.queue.release(job.id, { pages: state.pages, seen: state.seen });
        return "released";
      }
      const page = await listSourcePage(source, state.cursor, { skillsShToken });
      await backlog.upsertListings(sourceId, state.runId, page.listings);
      state.pages += 1;
      state.seen += page.listings.length;
      if (page.total !== undefined && page.total !== null) state.total = page.total;
      if (page.quotaExhausted) {
        // Keep the cursor; the next sync continues from here once the quota resets.
        state.quotaExhaustedAt = new Date().toISOString();
        await backlog.saveEnumeration(sourceId, state);
        await store.recordSourceSync(sourceId, { status: "ok", error: `Paused: ${source.name} API quota reached after ${state.seen} listings; resumes on the next sync.` });
        break;
      }
      state.cursor = page.nextCursor;
      if (page.nextCursor === null) {
        state.completedAt = new Date().toISOString();
        await backlog.saveEnumeration(sourceId, state);
        const count = await backlog.finishEnumeration(sourceId, state.runId);
        await store.recordSourceSync(sourceId, { status: "ok", count });
        break;
      }
      await backlog.saveEnumeration(sourceId, state);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await backlog.saveEnumeration(sourceId, state);
    await store.recordSourceSync(sourceId, { status: "error", error: `${message} (after ${state.seen} listings)` });
    logGitEvent("warn", "hub_source_sync_failed", { error: message });
  }

  await ctx.queue.enqueue({ organizationId: null, repositoryId: null, kind: "hub_hydrate", dedupeKey: "pending", payload: {} });
  return "done";
}

/** Fetches listed packages, most popular first, within the daily hydrate budget. */
export async function runHubHydrate(ctx: HubJobContext, job: BackgroundJob): Promise<"done" | "released"> {
  const backlog = createBacklogStore(ctx.sql);
  let hydrated = 0;
  for (;;) {
    if (timeLeft(ctx) < 60_000) {
      await ctx.queue.release(job.id, job.progress);
      await planHubWork(ctx, hydrated);
      return "released";
    }
    const allowance = Math.min(12, await backlog.remaining("hydrate"));
    if (allowance === 0) break;
    const batch = await backlog.nextToHydrate(allowance);
    if (batch.length === 0) break;
    await Promise.all(batch.map(async (listing) => {
      try {
        const skill = await hydrateListing(listing, { skillsShToken });
        if (skill) {
          await backlog.storeHydrated(listing.id, skill);
          hydrated += 1;
        } else {
          await backlog.markFetchFailed(listing.id, "No SKILL.md found at the source.");
        }
      } catch (error) {
        await backlog.markFetchFailed(listing.id, error instanceof Error ? error.message : String(error));
      }
    }));
    await backlog.consume("hydrate", batch.length);
  }
  await backlog.pruneIfNeeded().catch(() => 0);
  await planHubWork(ctx, hydrated);
  return "done";
}

/** Queues the next scans and live evaluations the day's budgets allow. */
export async function planHubWork(ctx: HubJobContext, recentlyHydrated = 0): Promise<void> {
  const backlog = createBacklogStore(ctx.sql);
  const store = createHubStore(ctx.sql);
  // Only queue work the day's budget can pay for; otherwise the hand-off would spin on no-op jobs.
  if ((await backlog.remaining("scan")) > 0 && (recentlyHydrated > 0 || (await store.needingSafety(1)).length > 0)) {
    await ctx.queue.enqueue({ organizationId: null, repositoryId: null, kind: "hub_safety", dedupeKey: "pending", payload: {} });
  }
  const config = readAiServiceConfig();
  if (!config.nim || !config.jev) return;
  const [queued] = await ctx.sql<{ count: number }[]>`select count(*)::int as count from background_jobs where kind = 'hub_eval' and status in ('queued', 'running')`;
  // Keep a modest number queued; the rest waits for budget and popularity order.
  const room = Math.min(await backlog.remaining("eval"), 12 - (queued?.count ?? 0));
  if (room <= 0) return;
  const candidates = await backlog.evalCandidates(room);
  for (const id of candidates) {
    await enqueueHubEval(ctx.sql, ctx.queue, id, "auto");
  }
  await backlog.consume("eval", candidates.length);
}

export async function runHubSafety(ctx: HubJobContext, job: BackgroundJob): Promise<"done" | "released"> {
  const store = createHubStore(ctx.sql);
  const chunkSize = Number(process.env.HUB_SAFETY_CHUNK ?? 12);
  const nimKey = readAiServiceConfig().nim?.apiKey ?? null;
  const llmAll = (process.env.SKILLSPECTOR_LLM ?? "flagged").toLowerCase() === "all";

  const backlog = createBacklogStore(ctx.sql);
  for (;;) {
    if (timeLeft(ctx) < 150_000) {
      await ctx.queue.release(job.id, job.progress);
      await planHubWork(ctx);
      return "released";
    }
    const allowance = Math.min(chunkSize, await backlog.remaining("scan"));
    if (allowance === 0) {
      await planHubWork(ctx);
      return "done";
    }
    const batch = await store.needingSafety(allowance);
    if (batch.length === 0) {
      await planHubWork(ctx);
      return "done";
    }
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
    await backlog.consume("scan", results.filter((result) => result.error !== "skipped").length);
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
  const files = await store.filesFor(hubSkillId);
  const context = liveRunInstructions(skill.skill_md, files);
  const limitations = executionLimitations({ skillMd: skill.skill_md, files: files.map((file) => ({ path: file.path })), referencesIncluded: context.included, referencesOmitted: context.omitted });
  try {
    const result = await generateEvaluationSet({
      generator: createNimChatClient(config.nim, config.nim.generationModel),
      executor: createNimChatClient(config.nim, config.nim.executionModel),
      judge: createJevClient(config.jev),
    }, {
      skill: { skillId: skill.slug, displayName: skill.name, root: EVAL_ROOT_PLACEHOLDER, instructions: context.instructions, version: null },
      costPerMillionTokens: Number(process.env.NIM_USD_PER_MTOK) || 0.5,
    });
    const verdictByCase = new Map(result.samples.map((sample) => [sample.caseId, sample.verdict]));
    await store.recordEval(hubSkillId, {
      hash: skill.content_hash ?? "",
      status: result.status,
      evaluation: {
        scorecard: result.scorecard,
        metrics: { ...result.metrics, rounds: result.rounds },
        limitations,
        referencesIncluded: context.included,
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
