import { parse as parseYaml } from "yaml";

import { AiServiceError, createJevClient, createNimChatClient, readAiServiceConfig } from "../ai/clients.ts";
import { logGitEvent } from "../git/redaction.ts";
import { CASE_KINDS, EvalGenerationError, generateEvaluationSet, type CaseKind, type DraftCase } from "../evaluation/eval-generation.ts";
import { persistGeneratedEvaluation } from "../evaluation/import-results.ts";
import { evaluateSkillPackage } from "../evaluation/scorecard.ts";
import { packageFingerprint, runSkillSpectorScans, SafetyScanUnavailableError, SCAN_RESULT_VERSION, SCANNABLE_FILE, type ScanPackage } from "../safety/skillspector.ts";
import { runHubEval, runHubSafety, runHubSync } from "../hub/jobs.ts";
import { createJobQueue, type BackgroundJob, type JobQueue } from "./queue.ts";
import { internalWorkerToken, selfBaseUrl } from "./worker-auth.ts";
import { openRepositoryFiles } from "./repository-files.ts";
import { createEvalGenerationStore, createSafetyScanStore } from "./stores.ts";

/**
 * Background work after a sync: SkillSpector safety scans and LLM↔Jev
 * evaluation generation. Runs inside `after()` with a time budget; work that
 * doesn't fit is released back to the queue and continues on the next trigger
 * (the next sync, a status poll, or the worker endpoint).
 */

type Sql = import("postgres").Sql;

type Context = {
  sql: Sql;
  queue: JobQueue;
  deadline: number;
  runtime: Awaited<ReturnType<typeof import("../git/runtime.ts")["getGitRuntime"]>>;
};

const env = process.env;
const timeLeft = (ctx: Context) => ctx.deadline - Date.now();

// ── Safety scans ────────────────────────────────────────────────────────

const MAX_PACKAGE_FILES = 150;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_PACKAGE_BYTES = 3 * 1024 * 1024;
const SCAN_CHUNK = Number(env.SKILLSPECTOR_CHUNK_SIZE) || 40;

async function runSafetyScan(ctx: Context, job: BackgroundJob): Promise<"done" | "released"> {
  const organizationId = job.organizationId as string;
  const repositoryId = job.repositoryId as string;
  const store = createSafetyScanStore(ctx.sql);
  const done = new Set(Array.isArray(job.progress.done) ? job.progress.done as string[] : []);
  const repo = await openRepositoryFiles(ctx.runtime, organizationId, repositoryId);
  const skills = await ctx.sql<{ skill_id: string; source_path: string; tier: string }[]>`
    select skill_id, source_path, tier from indexed_skills where organization_id = ${organizationId} and repository_id = ${repositoryId}
    order by tier asc, source_path asc
  `;
  const latest = new Map((await store.latestForRepository(organizationId, repositoryId)).map((scan) => [scan.sourcePath, scan]));
  const tree = await repo.listFiles();
  const pending = skills.filter((skill) => !done.has(skill.source_path)
    && !(latest.get(skill.source_path)?.commitSha === repo.commitSha && latest.get(skill.source_path)?.status === "complete"
      && latest.get(skill.source_path)?.fingerprint.startsWith(`${SCAN_RESULT_VERSION}:`)));

  const llmMode = (env.SKILLSPECTOR_LLM ?? "flagged").toLowerCase();
  const llmLimit = Number(env.SKILLSPECTOR_LLM_LIMIT) || 5;
  const nimKey = readAiServiceConfig().nim?.apiKey ?? null;
  const flagged: ScanPackage[] = [];

  for (let start = 0; start < pending.length; start += SCAN_CHUNK) {
    if (timeLeft(ctx) < 150_000) {
      await ctx.queue.release(job.id, { done: [...done], total: skills.length });
      return "released";
    }
    const chunk = pending.slice(start, start + SCAN_CHUNK);
    const packages: ScanPackage[] = [];
    for (const skill of chunk) {
      const prefix = `${skill.source_path}/`;
      const paths = [...tree.entries()]
        .filter(([path, size]) => path.startsWith(prefix) && SCANNABLE_FILE.test(path) && (size ?? 0) <= MAX_FILE_BYTES)
        .map(([path]) => path)
        .slice(0, MAX_PACKAGE_FILES);
      const contents = await repo.readMany(paths, 8, MAX_FILE_BYTES);
      const files: Record<string, string> = {};
      let bytes = 0;
      for (const [path, content] of Object.entries(contents)) {
        bytes += content.length;
        if (bytes > MAX_PACKAGE_BYTES) break;
        files[path.slice(prefix.length)] = content;
      }
      const previous = latest.get(skill.source_path);
      if (previous?.status === "complete" && previous.fingerprint === packageFingerprint(files)) {
        done.add(skill.source_path); // Unchanged package: the previous result still stands.
        continue;
      }
      packages.push({ root: skill.source_path, skillId: skill.skill_id, tier: skill.tier, files });
    }

    let results;
    try {
      results = await runSkillSpectorScans(packages, { llmRoots: llmMode === "all" ? new Set(packages.map((item) => item.root)) : new Set(), nimApiKey: nimKey });
    } catch (error) {
      if (error instanceof SafetyScanUnavailableError) {
        await store.recordUnavailable(organizationId, repositoryId, repo.commitSha, error.message);
        logGitEvent("warn", "safety_scan_unavailable", { repository_id: repositoryId, error });
        return "done";
      }
      throw error;
    }
    await store.clearUnavailable(organizationId, repositoryId);
    for (const result of results) {
      await store.record(organizationId, repositoryId, repo.commitSha, result);
      done.add(result.root);
      if (llmMode === "flagged" && result.status === "complete" && result.recommendation !== "SAFE" && flagged.length < llmLimit) {
        const pkg = packages.find((item) => item.root === result.root);
        if (pkg) flagged.push(pkg);
      }
    }
    await ctx.queue.saveProgress(job.id, { done: [...done], total: skills.length });
  }

  // Semantic (LLM) pass on packages the static analysis flagged, via NVIDIA NIM.
  if (flagged.length > 0 && nimKey && timeLeft(ctx) > 150_000) {
    const results = await runSkillSpectorScans(flagged, { llmRoots: new Set(flagged.map((item) => item.root)), nimApiKey: nimKey, llmModel: env.SKILLSPECTOR_MODEL ?? null })
      .catch((error: unknown) => {
        logGitEvent("warn", "safety_scan_llm_failed", { repository_id: repositoryId, error });
        return [];
      });
    for (const result of results) {
      if (result.status === "complete") await store.record(organizationId, repositoryId, repo.commitSha, result);
    }
  }
  return "done";
}

// ── Evaluation generation ───────────────────────────────────────────────

function seedCasesFrom(dataset: unknown): DraftCase[] {
  const cases = (dataset as { cases?: unknown })?.cases;
  if (!Array.isArray(cases)) return [];
  return cases.flatMap((raw, index): DraftCase[] => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const input = (item.input ?? {}) as Record<string, unknown>;
    const prompt = typeof input.task === "string" ? input.task : typeof item.prompt === "string" ? item.prompt : "";
    if (!prompt.trim()) return [];
    const id = typeof item.case_id === "string" ? item.case_id : `seed-${index + 1}`;
    const kind = (CASE_KINDS.find((candidate) => id.toLowerCase().startsWith(candidate)) ?? "positive") as CaseKind;
    const expected = Array.isArray(item.expected_outcomes) ? item.expected_outcomes.join("; ") : typeof item.expected_behavior === "string" ? item.expected_behavior : "";
    return [{ caseId: id, kind, prompt, context: typeof input.context === "string" ? input.context : null, expectedBehavior: expected || "Follows the skill's instructions for this request." }];
  });
}

async function runEvalGeneration(ctx: Context, job: BackgroundJob): Promise<"done" | "released"> {
  const organizationId = job.organizationId as string;
  const store = createEvalGenerationStore(ctx.sql);
  const run = await store.get(organizationId, String(job.payload.runId));
  if (!run || run.status === "complete" || run.status === "needs_review") {
    return "done";
  }
  if (timeLeft(ctx) < 200_000) {
    await ctx.queue.release(job.id, job.progress);
    return "released";
  }

  const config = readAiServiceConfig();
  if (!config.nim || !config.jev) {
    await store.update(organizationId, run.id, {
      status: "failed", completed: true,
      error: `Evaluation generation needs ${[!config.nim && "NVIDIA_NIM_API_KEY", !config.jev && "JEV_API_KEY"].filter(Boolean).join(" and ")} to be configured.`,
    });
    return "done";
  }

  const root = run.sourcePath;
  const repo = await openRepositoryFiles(ctx.runtime, organizationId, run.repositoryId);
  const files = await repo.readMany([`${root}/SKILL.md`, `${root}/metadata.yaml`, `${root}/eval/dataset.yaml`, `${root}/eval/rubric.yaml`, `${root}/eval/baseline.json`]);
  const instructions = files[`${root}/SKILL.md`];
  if (!instructions) {
    await store.update(organizationId, run.id, { status: "failed", completed: true, commitSha: repo.commitSha, error: `${root}/SKILL.md was not found at ${repo.commitSha.slice(0, 7)}.` });
    return "done";
  }
  const parse = (text: string | undefined) => {
    try { return text === undefined ? undefined : parseYaml(text) as unknown; } catch { return undefined; }
  };
  const metadata = (parse(files[`${root}/metadata.yaml`]) ?? {}) as Record<string, unknown>;
  const rubric = parse(files[`${root}/eval/rubric.yaml`]);
  const existing = evaluateSkillPackage(root, files);
  const answerKey = existing.status === "scored"
    ? { scorecard: existing.scorecard, samples: existing.samples.map((sample) => ({ caseId: sample.caseId, prompt: sample.prompt, verdict: sample.verdict })) }
    : null;
  // With an answer key the loop is an alignment check; it never overwrites a committed dataset.
  const mode = answerKey ? "alignment" : "generate";

  await store.update(organizationId, run.id, { status: "running", commitSha: repo.commitSha, jobId: job.id, error: null });
  const displayName = typeof metadata.display_name === "string" ? metadata.display_name : run.skillId;
  let lastSave = 0;

  try {
    const result = await generateEvaluationSet({
      generator: createNimChatClient(config.nim, config.nim.generationModel),
      executor: createNimChatClient(config.nim, config.nim.executionModel),
      judge: createJevClient(config.jev),
    }, {
      skill: { skillId: run.skillId, displayName, root, instructions, version: typeof metadata.version === "string" ? metadata.version : null },
      rubric: rubric ?? undefined,
      seedCases: existing.status === "requires_execution" ? seedCasesFrom(parse(files[`${root}/eval/dataset.yaml`])) : [],
      answerKey,
      costPerMillionTokens: Number(env.NIM_USD_PER_MTOK) || 0.5,
      onProgress: async (progress) => {
        if (Date.now() - lastSave < 3000) return;
        lastSave = Date.now();
        await store.update(organizationId, run.id, { rounds: progress.round, cases: progress.cases, samples: progress.samples.map(({ output, ...rest }) => ({ ...rest, output: output.slice(0, 2000) })), metrics: { stage: progress.stage } });
        await ctx.queue.saveProgress(job.id, { stage: progress.stage, round: progress.round });
      },
    });

    let proposalId: string | null = null;
    if (mode === "generate") {
      await persistGeneratedEvaluation(ctx.sql, { repositoryId: run.repositoryId, root, commitSha: repo.commitSha, scorecard: result.scorecard, samples: result.samples, now: new Date() });
      try {
        const proposal = await ctx.runtime.assessments.proposeFileEdits(
          { organizationId, subject: run.requestedBy, role: "admin" },
          run.repositoryId,
          {
            title: `Add generated evaluations for ${displayName}`,
            body: [
              `Savant generated an evaluation set for \`${run.skillId}\`, which had no scored evaluation dataset.`,
              "",
              `- Drafted by \`${result.models.generator}\`, validated and scored by \`${result.models.judge}\` (${result.rounds} round${result.rounds === 1 ? "" : "s"}).`,
              `- ${result.metrics.accepted} of ${result.metrics.drafted} drafted cases passed validation; ${result.metrics.needsReview} held for review.`,
              `- Provisional baseline: **${result.scorecard.overallScore}/100** (${result.scorecard.passCount} pass · ${result.scorecard.investigateCount} investigate · ${result.scorecard.failCount} fail).`,
              "",
              "Review the cases and expected behaviours before merging; once merged this becomes the skill's answer key for SkillOpt.",
            ].join("\n"),
            files: result.files,
          },
        );
        proposalId = proposal.id;
      } catch (error) {
        logGitEvent("warn", "eval_generation_proposal_failed", { repository_id: run.repositoryId, error });
      }
    }

    await store.update(organizationId, run.id, {
      status: result.status,
      completed: true,
      rounds: result.rounds,
      cases: result.cases,
      samples: result.samples.map(({ output, ...rest }) => ({ ...rest, output: output.slice(0, 4000) })),
      scorecard: result.scorecard as unknown as Record<string, unknown>,
      ...(result.alignment ? { alignment: result.alignment as unknown as Record<string, unknown> } : {}),
      files: mode === "generate" ? result.files : [],
      models: result.models,
      metrics: { ...result.metrics, mode },
      ...(proposalId ? { proposalId } : {}),
      error: null,
    });
    return "done";
  } catch (error) {
    const message = error instanceof EvalGenerationError || error instanceof AiServiceError ? error.message : `Evaluation generation failed: ${error instanceof Error ? error.message : String(error)}`;
    const retryable = error instanceof AiServiceError && (error.status === null || error.status === 429 || error.status >= 500) && job.attempts < 3;
    if (retryable) {
      await store.update(organizationId, run.id, { status: "queued", error: `${message} Retrying.` });
      await ctx.queue.release(job.id, job.progress);
      return "released";
    }
    await store.update(organizationId, run.id, { status: "failed", completed: true, error: message.slice(0, 1500) });
    return "done";
  }
}

// ── Runner ──────────────────────────────────────────────────────────────

export async function runBackgroundJobs(options: { budgetMs?: number; workers?: number } = {}): Promise<{ processed: number; released: number; failed: number }> {
  const budget = options.budgetMs ?? (Number(env.BACKGROUND_JOBS_BUDGET_MS) || 230_000);
  const { getControlPlaneDatabase } = await import("../control-plane/database.ts");
  const { getGitRuntime } = await import("../git/runtime.ts");
  const sql = getControlPlaneDatabase();
  const ctx: Context = { sql, queue: createJobQueue(sql), deadline: Date.now() + budget, runtime: await getGitRuntime() };
  const stats = { processed: 0, released: 0, failed: 0 };

  const worker = async () => {
    while (timeLeft(ctx) > 60_000) {
      const job = await ctx.queue.claim();
      if (!job) return;
      try {
        const outcome = job.kind === "safety_scan" ? await runSafetyScan(ctx, job)
          : job.kind === "eval_generation" ? await runEvalGeneration(ctx, job)
          : job.kind === "hub_sync" ? await runHubSync(ctx, job)
          : job.kind === "hub_safety" ? await runHubSafety(ctx, job)
          : await runHubEval(ctx, job);
        if (outcome === "done") {
          await ctx.queue.complete(job.id);
          stats.processed += 1;
        } else {
          stats.released += 1;
          return; // Out of budget: leave the rest for the next trigger.
        }
      } catch (error) {
        stats.failed += 1;
        logGitEvent("warn", "background_job_failed", { error });
        await ctx.queue.fail(job.id, error instanceof Error ? error.message : String(error)).catch(() => undefined);
      }
    }
  };

  await Promise.all(Array.from({ length: options.workers ?? 2 }, () => worker()));
  return stats;
}

/**
 * Starts the runner after the current response (nested `after()` is
 * supported). No-op outside a request scope.
 */
export async function kickBackgroundJobs(): Promise<void> {
  // Claims are atomic, so an extra runner never double-processes; it only picks up work others haven't.
  try {
    const { after } = await import("next/server");
    after(async () => {
      await runAndContinue(0);
    });
  } catch {
    // Not in a request scope (e.g. tests); jobs wait for the next trigger.
  }
}

const MAX_CHAIN = Number(env.BACKGROUND_JOBS_MAX_CHAIN) || 60;

/**
 * Runs jobs within this invocation's budget, then — if work remains and this
 * run made progress — hands the queue to a fresh invocation of the worker
 * endpoint, so long backlogs drain without a frequent cron.
 */
export async function runAndContinue(depth: number): Promise<void> {
  const stats = await runBackgroundJobs().catch((error: unknown) => {
    logGitEvent("warn", "background_jobs_failed", { error });
    return { processed: 0, released: 0, failed: 0 };
  });
  if (depth >= MAX_CHAIN || stats.processed + stats.released === 0) return;
  if (!(await hasPendingJobs().catch(() => false))) return;
  const base = selfBaseUrl();
  const token = internalWorkerToken();
  if (!base || !token) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    await fetch(`${base}/api/internal/jobs/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-savant-chain": String(depth + 1) },
      signal: controller.signal,
    });
  } catch (error) {
    logGitEvent("warn", "background_jobs_chain_failed", { error });
  } finally {
    clearTimeout(timer);
  }
}

export async function enqueueJob(input: Parameters<JobQueue["enqueue"]>[0]) {
  const { getControlPlaneDatabase } = await import("../control-plane/database.ts");
  return createJobQueue(getControlPlaneDatabase()).enqueue(input);
}

export async function hasPendingJobs(): Promise<boolean> {
  const { getControlPlaneDatabase } = await import("../control-plane/database.ts");
  return createJobQueue(getControlPlaneDatabase()).hasPending();
}
