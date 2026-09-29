// Skill Intelligence service: USE → OBSERVE → MEASURE → LEARN → PROPOSE →
// VALIDATE → HUMAN APPROVAL → RELEASE.
//
// SkillOpt (via the Python worker) may analyze, reflect, suggest, and run
// evaluations. It may not approve, publish, change permissions, modify
// production, or distribute skills. Every one of those actions lives here,
// behind human review, and ends at the existing release rail.

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  ImprovementQueueItem,
  ImprovementTrigger,
  LearningHistoryPoint,
  OptimizationBundleRun,
  OptimizationJobBundle,
  OptimizationJobResult,
  OptimizationJobSummary,
  OptimizationObjective,
  OptimizationTriggerRequest,
  OrganizationIntelligencePayload,
  RecommendationReviewRequest,
  RecommendationStatus,
  SkillFeedbackRecord,
  SkillImprovementRecommendation,
  SkillIntelligencePayload,
  SkillIntelligenceSettings,
  SkillOutcomeRecord,
  SkillRunIngestResult,
  SkillRunListItem,
} from "@savant/types";

import { clusterFailures } from "../../lib/skill-intelligence/failure-clusters.ts";
import { scoreFeedbackEvent } from "../../lib/skill-intelligence/feedback-signals.ts";
import {
  computeCohorts,
  computeSkillHealth,
  computeTelemetryCoverage,
  isFailureRun,
  medianEditRatio,
  type AnalyzedRun,
} from "../../lib/skill-intelligence/health.ts";
import {
  isOptimizationTelemetryDisabled,
  normalizeSkillIntelligenceSettings,
  resolveChangeBudget,
  resolveTierThresholds,
  selectOptimizerProvider,
  TIER_OPTIMIZATION_POLICIES,
} from "../../lib/skill-intelligence/policy.ts";
import {
  applyReviewDecision,
  computePriorityScore,
  hashSkillContent,
  nextCandidateVersion,
  priorityBand,
  RecommendationWorkflowError,
  type ReviewActor,
} from "../../lib/skill-intelligence/recommendation-workflow.ts";
import { parseLockedRegions } from "../../lib/skill-intelligence/locked-sections.ts";
import { redactText } from "../../lib/skill-intelligence/redaction.ts";
import { evaluateCandidate, type CaseResult } from "../../lib/skill-intelligence/regression-gate.ts";
import {
  parseSkillFeedbackRequest,
  parseSkillOutcomeRequest,
  parseSkillRunIngestRequest,
  prepareRunForStorage,
} from "../../lib/skill-intelligence/run-ingest.ts";
import { deriveEdits, measureEdits, renderUnifiedDiff } from "../../lib/skill-intelligence/skill-diff.ts";
import { evaluateOptimizationEligibility, primaryTrigger, shouldAutoEnqueue } from "../../lib/skill-intelligence/triggers.ts";
import { median, round } from "../../lib/skill-intelligence/statistics.ts";

import type { CatalogSkill, SkillIntelligenceDeps } from "./ports.ts";
import { ActiveJobConflictError, type JobRecord } from "./store.ts";

export class SkillIntelligenceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "SkillIntelligenceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const ANALYSIS_WINDOW_DAYS = 90;
export const JOB_LEASE_SECONDS = 30 * 60;
const OPEN_STATUSES: RecommendationStatus[] = ["generated", "evaluating", "ready-for-review"];
const SYSTEM_ACTOR = "savant:skill-intelligence";

function nowOf(deps: SkillIntelligenceDeps): Date {
  return deps.now?.() ?? new Date();
}

function sinceIso(deps: SkillIntelligenceDeps, days = ANALYSIS_WINDOW_DAYS): string {
  return new Date(nowOf(deps).getTime() - days * DAY_MS).toISOString();
}

export function hashLeaseToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function formatRelative(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function requireSkill(deps: SkillIntelligenceDeps, organizationId: string, identifier: string): Promise<CatalogSkill> {
  const skill = await deps.catalog.getSkill(organizationId, identifier);
  if (!skill) {
    throw new SkillIntelligenceError("skill_not_found", `Skill '${identifier}' was not found.`, 404);
  }
  return skill;
}

// ---------------------------------------------------------------------------
// OBSERVE — telemetry ingestion
// ---------------------------------------------------------------------------

export async function ingestSkillRun(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; body: unknown; tokenConnectorId?: string | null },
): Promise<SkillRunIngestResult> {
  const parsed = parseSkillRunIngestRequest(input.body);
  if (!parsed.ok) {
    throw new SkillIntelligenceError("invalid_skill_run", parsed.error, 400);
  }

  const request = parsed.value;
  if (input.tokenConnectorId && input.tokenConnectorId !== request.connectorId) {
    throw new SkillIntelligenceError(
      "connector_mismatch",
      "This ingest token is scoped to a different connector.",
      403,
    );
  }

  const skill = await deps.catalog.getSkill(input.organizationId, request.skillId);
  if (!skill) {
    return {
      runId: request.runId,
      accepted: false,
      storedTelemetryLevel: null,
      redactionApplied: false,
      redactionCounts: {},
      droppedFields: [],
      reason: `Skill '${request.skillId}' is not governed in this workspace.`,
    };
  }
  request.skillId = skill.skillId;

  let settings = await deps.store.getSettings(input.organizationId);
  const disabled = isOptimizationTelemetryDisabled(settings, skill.skillId);
  if (disabled || !deps.artifactsEnabled) {
    // Sensitive skills and key-less deployments keep outcome metrics only.
    settings = { ...settings, telemetryMode: "metrics-only" };
  }

  const prepared = prepareRunForStorage({
    organizationId: input.organizationId,
    request,
    settings,
    now: nowOf(deps),
  });

  const outcome = await deps.store.insertRun(input.organizationId, prepared);

  return {
    runId: request.runId,
    accepted: outcome === "inserted",
    storedTelemetryLevel: prepared.storedLevel,
    redactionApplied: prepared.policy.redactionApplied,
    redactionCounts: prepared.redactionCounts,
    droppedFields: prepared.droppedFields,
    ...(outcome === "duplicate" ? { reason: "Run was already ingested; ignored as a duplicate." } : {}),
    ...(disabled ? { reason: "Optimization telemetry is disabled for this skill; only outcome metrics were stored." } : {}),
  };
}

export async function recordSkillFeedback(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; runId: string; body: unknown; reporterRole?: "user" | "sme" | "system" },
): Promise<SkillFeedbackRecord> {
  const parsed = parseSkillFeedbackRequest(input.body);
  if (!parsed.ok) {
    throw new SkillIntelligenceError("invalid_feedback", parsed.error, 400);
  }

  const settings = await deps.store.getSettings(input.organizationId);
  const request = parsed.value;
  if (request.comment) {
    request.comment = redactText(request.comment, { piiClasses: settings.redactPiiClasses }).text;
  }
  if (input.reporterRole) {
    request.reporterRole = input.reporterRole;
  }

  const record: SkillFeedbackRecord = {
    ...request,
    feedbackId: randomUUID(),
    runId: input.runId,
    recordedAt: nowOf(deps).toISOString(),
    derivedScore: scoreFeedbackEvent(request),
  };

  if (!await deps.store.insertFeedback(input.organizationId, record)) {
    throw new SkillIntelligenceError("run_not_found", `Run '${input.runId}' was not found.`, 404);
  }

  return record;
}

export async function recordSkillOutcome(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; runId: string; body: unknown },
): Promise<SkillOutcomeRecord> {
  const parsed = parseSkillOutcomeRequest(input.body);
  if (!parsed.ok) {
    throw new SkillIntelligenceError("invalid_outcome", parsed.error, 400);
  }
  const record: SkillOutcomeRecord = { ...parsed.value, runId: input.runId, recordedAt: nowOf(deps).toISOString() };
  if (!await deps.store.insertOutcome(input.organizationId, record)) {
    throw new SkillIntelligenceError("run_not_found", `Run '${input.runId}' was not found.`, 404);
  }
  return record;
}

// ---------------------------------------------------------------------------
// MEASURE / LEARN — skill intelligence read model
// ---------------------------------------------------------------------------

type SkillAnalysis = {
  skill: CatalogSkill;
  settings: SkillIntelligenceSettings;
  runs: AnalyzedRun[];
  health: SkillIntelligencePayload["health"];
  clusters: SkillIntelligencePayload["clusters"];
  eligibility: SkillIntelligencePayload["eligibility"];
  jobs: JobRecord[];
  providerBlocker: string | null;
};

async function analyzeSkill(deps: SkillIntelligenceDeps, organizationId: string, skill: CatalogSkill): Promise<SkillAnalysis> {
  const now = nowOf(deps);
  const [settings, runs, jobs] = await Promise.all([
    deps.store.getSettings(organizationId),
    deps.store.listAnalyzedRuns(organizationId, skill.skillId, sinceIso(deps)),
    deps.store.listJobs(organizationId, skill.skillId, 10),
  ]);

  const provider = selectOptimizerProvider(settings, skill.classification);
  const providerBlocker = provider.allowed ? null : provider.reason;
  const clusters = clusterFailures(runs);
  const lastOptimizationAt = jobs.find((job) => job.status === "completed")?.completedAt ?? null;

  return {
    skill,
    settings,
    runs,
    health: computeSkillHealth(skill.skillId, runs, {
      evalBenchmark: skill.evalBenchmark,
      regressionStability: skill.regressionStability,
      now,
    }),
    clusters,
    eligibility: evaluateOptimizationEligibility({
      runs,
      clusters,
      tier: skill.tier,
      thresholds: settings.thresholds,
      authoredEvalCases: skill.authoredEvalCases,
      telemetryDisabled: isOptimizationTelemetryDisabled(settings, skill.skillId),
      providerBlocker,
      lastOptimizationAt,
      now,
    }),
    jobs,
    providerBlocker,
  };
}

function toJobSummary(job: JobRecord): OptimizationJobSummary {
  return {
    jobId: job.jobId,
    skillId: job.skillId,
    trigger: job.trigger,
    status: job.status,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    recommendationId: job.recommendationId,
  };
}

function toRunListItem(run: AnalyzedRun, now: Date): SkillRunListItem {
  return {
    runId: run.runId,
    runtime: run.runtime,
    model: run.model,
    skillVersionId: run.skillVersionId,
    telemetryLevel: run.telemetryLevel,
    success: run.taskOutcome === "succeeded" ? true : run.taskOutcome === "failed" ? false : run.success,
    startedAt: run.startedAt,
    started: formatRelative(run.startedAt, now),
    latencyMs: run.latencyMs,
    estimatedCost: run.estimatedCost,
    weakLabel: run.weakLabel,
    feedbackCategories: run.feedbackCategories,
    taskArchetype: run.taskArchetype,
    redactionApplied: false,
  };
}

async function buildLearningHistory(
  deps: SkillIntelligenceDeps,
  organizationId: string,
  skill: CatalogSkill,
): Promise<LearningHistoryPoint[]> {
  const approved = await deps.store.listRecommendations(organizationId, { skillId: skill.skillId, statuses: ["approved"] });
  const byVersion = new Map(approved.map((recommendation) => [recommendation.candidateVersion, recommendation]));

  return [...skill.versionHistory].reverse().map((version) => {
    const recommendation = byVersion.get(version.ref);
    return {
      version: version.ref,
      releasedAt: version.releasedAt ?? "",
      runsUsed: recommendation ? recommendation.evidence.runCount : null,
      score: version.score,
      delta: version.delta,
      optimizerGenerated: Boolean(recommendation),
      regressions: recommendation ? recommendation.validation.regressions : 0,
    };
  });
}

export async function getSkillIntelligence(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; skillIdentifier: string },
): Promise<SkillIntelligencePayload> {
  const skill = await requireSkill(deps, input.organizationId, input.skillIdentifier);
  const analysis = await analyzeSkill(deps, input.organizationId, skill);
  const now = nowOf(deps);

  return {
    skillId: skill.skillId,
    skillName: skill.name,
    skillTier: skill.tier,
    telemetryEnabled: !isOptimizationTelemetryDisabled(analysis.settings, skill.skillId),
    health: analysis.health,
    cohorts: computeCohorts(analysis.runs),
    coverage: computeTelemetryCoverage(analysis.runs),
    clusters: analysis.clusters,
    eligibility: analysis.eligibility,
    runs: analysis.runs.slice(0, 50).map((run) => toRunListItem(run, now)),
    learningHistory: await buildLearningHistory(deps, input.organizationId, skill),
    jobs: analysis.jobs.map(toJobSummary),
    autoOptimizationMode: analysis.settings.autoOptimizationMode,
  };
}

// ---------------------------------------------------------------------------
// PROPOSE — optimization jobs
// ---------------------------------------------------------------------------

export function buildOptimizationObjective(
  clusters: SkillIntelligencePayload["clusters"],
  override?: string,
): OptimizationObjective {
  const focus = clusters.find((cluster) => cluster.clusterId !== "uncategorized");
  const guardrails: OptimizationObjective["guardrails"] = [
    { dimension: "security-compliance", constraint: "non-decreasing" },
    { dimension: "format-compliance", constraint: "non-decreasing" },
    { dimension: "runtime-portability", constraint: "non-decreasing" },
  ];

  return {
    statement: override?.trim()
      || (focus
        ? `Reduce "${focus.label}" failures (${focus.runCount} runs) without decreasing security compliance, output-format compliance, or runtime portability.`
        : "Increase task success without decreasing security compliance, output-format compliance, or runtime portability."),
    primary: [{ dimension: "overall", direction: "increase" }],
    guardrails,
  };
}

export async function requestOptimization(
  deps: SkillIntelligenceDeps,
  input: {
    organizationId: string;
    skillIdentifier: string;
    request: OptimizationTriggerRequest;
    actor: { subject: string; userId: string | null };
    parentRecommendationId?: string | null;
    bypassEvidenceGate?: boolean;
  },
): Promise<OptimizationJobSummary> {
  const skill = await requireSkill(deps, input.organizationId, input.skillIdentifier);
  const analysis = await analyzeSkill(deps, input.organizationId, skill);
  const trigger: ImprovementTrigger = input.request.trigger ?? "manual";

  if (isOptimizationTelemetryDisabled(analysis.settings, skill.skillId)) {
    throw new SkillIntelligenceError("optimization_disabled", "Optimization telemetry is disabled for this skill.", 409);
  }
  if (analysis.providerBlocker) {
    throw new SkillIntelligenceError("optimizer_provider_not_permitted", analysis.providerBlocker, 409);
  }
  if (!TIER_OPTIMIZATION_POLICIES[skill.tier].recommendationGeneration) {
    throw new SkillIntelligenceError("tier_optimization_disabled", `Tier ${skill.tier} skills do not generate recommendations.`, 409);
  }
  if (!input.bypassEvidenceGate && !analysis.eligibility.eligible) {
    throw new SkillIntelligenceError(
      "insufficient_evidence",
      "Not enough evidence to optimize this skill without overfitting to noise.",
      409,
      analysis.eligibility.blockers.join(" "),
    );
  }

  const provider = selectOptimizerProvider(analysis.settings, skill.classification);
  if (!provider.allowed) {
    throw new SkillIntelligenceError("optimizer_provider_not_permitted", provider.reason, 409);
  }

  const job = await deps.store.enqueueJob({
    organizationId: input.organizationId,
    skillId: skill.skillId,
    baseVersion: skill.baseVersion,
    trigger,
    objective: buildOptimizationObjective(analysis.clusters, input.request.objective),
    changeBudget: resolveChangeBudget(input.request.aggressiveness ?? analysis.settings.aggressiveness, skill.tier),
    optimizerProvider: provider.provider,
    parentRecommendationId: input.parentRecommendationId ?? null,
    requestedBy: input.actor.userId,
  });

  await deps.events.emit({
    organizationId: input.organizationId,
    actorRef: input.actor.subject,
    category: "evaluation",
    action: "optimization.triggered",
    targetType: "skill",
    targetRef: skill.skillId,
    payload: {
      jobId: job.jobId,
      trigger,
      mode: input.parentRecommendationId ? "evaluate-only" : "optimize",
      aggressiveness: job.changeBudget.aggressiveness,
      optimizerProvider: job.optimizerProvider,
      evidence: analysis.eligibility.observed,
    },
  });

  return toJobSummary(job);
}

function toBundleRun(run: AnalyzedRun, artifacts: { input: string | null; output: string | null } | undefined, piiClasses: SkillIntelligenceSettings["redactPiiClasses"]): OptimizationBundleRun {
  // Second redaction pass: payloads were redacted at ingest, but rules may have
  // tightened since. The worker runs a third, independent pass.
  const clean = (value: string | null | undefined) => (value ? redactText(value, { piiClasses }).text : null);
  return {
    runId: run.runId,
    runtime: run.runtime,
    model: run.model,
    skillVersionId: run.skillVersionId,
    telemetryLevel: run.telemetryLevel,
    success: run.taskOutcome === "succeeded" ? true : run.taskOutcome === "failed" ? false : run.success,
    weakLabel: run.weakLabel,
    feedbackCategories: run.feedbackCategories,
    rubricFailures: run.rubricFailures,
    taskArchetype: run.taskArchetype,
    inputFingerprint: run.inputFingerprint,
    input: clean(artifacts?.input),
    output: clean(artifacts?.output),
    startedAt: run.startedAt,
  };
}

/** Worker claims the next job and receives a sanitized, tenant-scoped bundle. */
export async function claimOptimizationJob(deps: SkillIntelligenceDeps): Promise<OptimizationJobBundle | null> {
  const now = nowOf(deps);
  const leaseToken = randomBytes(24).toString("base64url");
  const job = await deps.store.claimNextJob(hashLeaseToken(leaseToken), JOB_LEASE_SECONDS, now);
  if (!job) {
    return null;
  }

  const fail = async (message: string) => {
    await deps.store.finishJob(job.jobId, "failed", message, null);
    await deps.events.emit({
      organizationId: job.organizationId,
      actorRef: SYSTEM_ACTOR,
      category: "evaluation",
      action: "optimization.failed",
      targetType: "optimization_job",
      targetRef: job.jobId,
      payload: { skillId: job.skillId, error: message },
    });
    return null;
  };

  const skill = await deps.catalog.getSkill(job.organizationId, job.skillId);
  if (!skill) {
    return fail("Skill is no longer governed in this workspace.");
  }
  const settings = await deps.store.getSettings(job.organizationId);
  if (isOptimizationTelemetryDisabled(settings, skill.skillId)) {
    return fail("Optimization telemetry was disabled for this skill after the job was queued.");
  }
  const provider = selectOptimizerProvider(settings, skill.classification, job.optimizerProvider);
  if (!provider.allowed) {
    return fail(provider.reason);
  }
  const source = await deps.catalog.getSkillContent(job.organizationId, skill.skillId);
  if (!source) {
    return fail("Production SKILL.md could not be loaded.");
  }

  let candidateOverride: string | null = null;
  if (job.parentRecommendationId) {
    const parent = await deps.store.getRecommendation(job.organizationId, job.parentRecommendationId);
    if (!parent || parent.status !== "evaluating") {
      return fail("The recommendation being re-evaluated is no longer awaiting evaluation.");
    }
    candidateOverride = parent.candidateContent;
  }

  const runs = await deps.store.listAnalyzedRuns(job.organizationId, skill.skillId, sinceIso(deps));
  const artifacts = await deps.store.listRunArtifacts(job.organizationId, runs.map((run) => run.runId));
  const [rejectionSignals, dependents] = await Promise.all([
    deps.store.listRejectionSignals(job.organizationId, skill.skillId),
    deps.catalog.getDependents(job.organizationId, skill.skillId),
  ]);

  await deps.events.emit({
    organizationId: job.organizationId,
    actorRef: SYSTEM_ACTOR,
    category: "evaluation",
    action: "optimization.started",
    targetType: "optimization_job",
    targetRef: job.jobId,
    payload: { skillId: skill.skillId, attempt: job.attempt, runs: runs.length, optimizerProvider: provider.provider },
  });

  return {
    schemaVersion: 1,
    jobId: job.jobId,
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_SECONDS * 1000).toISOString(),
    tenantId: job.organizationId,
    mode: candidateOverride ? "evaluate-only" : "optimize",
    skill: {
      skillId: skill.skillId,
      name: skill.name,
      tier: skill.tier,
      classification: skill.classification,
      baseVersion: job.baseVersion,
      skillMd: source.content,
    },
    candidateOverride,
    trigger: job.trigger,
    objective: job.objective,
    changeBudget: job.changeBudget,
    optimizer: { provider: provider.provider, model: null },
    thresholds: resolveTierThresholds(settings.thresholds, skill.tier),
    clusters: clusterFailures(runs),
    rejectionSignals,
    dependents,
    runs: runs.map((run) => toBundleRun(run, artifacts.get(run.runId), settings.redactPiiClasses)),
    piiClasses: settings.redactPiiClasses,
  };
}

function buildExplanation(input: {
  runs: readonly AnalyzedRun[];
  clusters: SkillIntelligencePayload["clusters"];
  inferredPattern: string | undefined;
  edits: SkillImprovementRecommendation["edits"];
  validation: SkillImprovementRecommendation["validation"];
}): SkillImprovementRecommendation["explanation"] {
  const failures = input.runs.filter(isFailureRun).length;
  const focus = input.clusters.find((cluster) => cluster.clusterId !== "uncategorized");
  const editRatio = medianEditRatio(input.runs);
  const usage = measureEdits(input.edits);
  const ops = [...new Set(input.edits.map((edit) => edit.op))].join(", ");
  const sections = usage.sections.slice(0, 4).join(", ");
  const interval = input.validation.interval;

  return {
    observed: focus
      ? `${focus.runCount} of ${input.runs.length} recent runs showed "${focus.label}" across ${focus.runtimes.length} runtime(s); ${failures} failure examples in total${editRatio != null ? `, median human edit ${(editRatio * 100).toFixed(0)}%` : ""}.`
      : `${failures} of ${input.runs.length} recent runs were failures or required correction.`,
    inferredPattern: input.inferredPattern?.trim()
      || (focus
        ? `Current instructions do not adequately cover "${focus.label}".`
        : "The optimizer did not report a specific pattern; review the diff directly."),
    change: `${input.edits.length} bounded edit(s) (${ops || "none"}) in ${sections || "the preamble"}; ${usage.changedLines} lines changed; locked regions untouched.`,
    evidence: `Validation ${input.validation.baselineScore} → ${input.validation.candidateScore} (${input.validation.delta >= 0 ? "+" : ""}${input.validation.delta}) over ${input.validation.sampleCount} paired cases${interval ? `; ${Math.round(interval.confidence * 100)}% bootstrap interval ${interval.low} to ${interval.high}` : ""}; regression suite ${input.validation.regressionSuite.passed}/${input.validation.regressionSuite.total}; evidence ${input.validation.evidenceStrength}.`,
  };
}

/** Worker submits results. The control plane re-derives edits and re-runs the gate itself. */
export async function submitOptimizationResult(
  deps: SkillIntelligenceDeps,
  input: { jobId: string; result: OptimizationJobResult },
): Promise<{ recommendationId: string | null; status: "completed" | "failed" }> {
  const { result } = input;
  const now = nowOf(deps);
  const job = await deps.store.getLeasedJob(input.jobId, hashLeaseToken(result.leaseToken ?? ""), now);
  if (!job) {
    throw new SkillIntelligenceError("job_lease_invalid", "The job lease is invalid or has expired.", 409);
  }

  const failJob = async (message: string) => {
    await deps.store.finishJob(job.jobId, "failed", message, null);
    if (job.parentRecommendationId) {
      const parent = await deps.store.getRecommendation(job.organizationId, job.parentRecommendationId);
      if (parent && parent.status === "evaluating") {
        await deps.store.updateRecommendation({ ...parent, status: "ready-for-review", updatedAt: now.toISOString() });
      }
    }
    await deps.events.emit({
      organizationId: job.organizationId,
      actorRef: SYSTEM_ACTOR,
      category: "evaluation",
      action: "optimization.failed",
      targetType: "optimization_job",
      targetRef: job.jobId,
      payload: { skillId: job.skillId, error: message },
    });
    return { recommendationId: null, status: "failed" as const };
  };

  if (result.status === "failed") {
    return failJob(result.error?.slice(0, 1000) || "Worker reported failure without detail.");
  }

  const skill = await deps.catalog.getSkill(job.organizationId, job.skillId);
  const source = skill ? await deps.catalog.getSkillContent(job.organizationId, job.skillId) : null;
  if (!skill || !source) {
    return failJob("Skill or production SKILL.md is no longer available.");
  }

  const parent = job.parentRecommendationId
    ? await deps.store.getRecommendation(job.organizationId, job.parentRecommendationId)
    : null;
  const baseContent = parent?.baseContent ?? source.content;
  const candidateContent = (parent ? parent.candidateContent : result.candidateContent ?? "").replace(/\r\n/g, "\n");

  if (!parent && result.candidateContent && hashSkillContent(result.candidateContent) === hashSkillContent(baseContent)) {
    await deps.store.finishJob(job.jobId, "completed", "No candidate improved on the baseline.", null);
    await deps.events.emit({
      organizationId: job.organizationId,
      actorRef: SYSTEM_ACTOR,
      category: "evaluation",
      action: "optimization.completed",
      targetType: "optimization_job",
      targetRef: job.jobId,
      payload: { skillId: job.skillId, recommendation: null, reason: "no-improvement" },
    });
    return { recommendationId: null, status: "completed" };
  }

  if (!candidateContent.trim()) {
    return failJob("Worker returned an empty candidate.");
  }

  if (!Array.isArray(result.cases) || result.cases.length === 0) {
    return failJob("Worker returned no evaluation cases; a candidate cannot be surfaced without evidence.");
  }

  const cases: CaseResult[] = result.cases
    .filter((entry) =>
      typeof entry.caseId === "string"
      && (entry.partition === "validation" || entry.partition === "regression" || entry.partition === "holdout")
      && Number.isFinite(entry.baseline)
      && Number.isFinite(entry.candidate),
    )
    .map((entry) => ({ ...entry }));

  const candidateContentHash = hashSkillContent(candidateContent);
  const edits = parent
    ? parent.edits
    : deriveEdits(baseContent, candidateContent, result.editRationales ?? []);
  const runs = await deps.store.listAnalyzedRuns(job.organizationId, skill.skillId, sinceIso(deps));
  const settings = await deps.store.getSettings(job.organizationId);
  const thresholds = resolveTierThresholds(settings.thresholds, skill.tier);
  const dependents = await deps.catalog.getDependents(job.organizationId, skill.skillId);
  const validation = evaluateCandidate({
    baseContent,
    candidateContent,
    candidateContentHash,
    edits,
    budget: job.changeBudget,
    objective: job.objective,
    cases,
    tier: skill.tier,
    dependents: {
      direct: dependents.direct,
      transitive: dependents.transitive,
      suites: result.dependentSuites ?? [],
    },
    minimumSamples: thresholds.minHeldOutCases,
    now,
  });

  if (result.datasets) {
    await deps.store.saveDatasets(job.jobId, result.datasets);
  }

  const candidateId = await deps.store.saveCandidate({
    jobId: job.jobId,
    organizationId: job.organizationId,
    skillId: skill.skillId,
    baseContentHash: hashSkillContent(baseContent),
    candidateContent,
    candidateContentHash,
    edits,
    provenance: result.provenance ?? parent?.provenance ?? {
      engine: "skillopt",
      engineDisplayName: "Microsoft SkillOpt",
      version: "unknown",
      sourceCommit: null,
      optimizerModel: "unknown",
      optimizerBackend: job.optimizerProvider,
      configHash: "unknown",
    },
    origin: parent ? "human-modified" : "optimizer",
  });
  await deps.store.saveCandidateEvaluation(candidateId, validation);

  const clusters = clusterFailures(runs);
  const failureRuns = runs.filter(isFailureRun);
  const recommendationId = parent?.recommendationId ?? randomUUID();
  const provenance = result.provenance ?? parent?.provenance;
  if (!provenance) {
    return failJob("Worker did not report optimizer provenance.");
  }

  let recommendation: SkillImprovementRecommendation;
  if (parent) {
    if (parent.status !== "evaluating" || hashSkillContent(parent.candidateContent) !== candidateContentHash) {
      return failJob("The candidate changed while it was being evaluated; a newer evaluation is required.");
    }
    recommendation = {
      ...parent,
      validation,
      requiresReevaluation: false,
      status: "ready-for-review",
      predictedImpact: validation.dimensions.map((dimension) => ({ dimension: dimension.dimension, delta: dimension.delta })),
      explanation: { ...parent.explanation, evidence: buildExplanation({ runs, clusters, inferredPattern: undefined, edits, validation }).evidence },
      priorityScore: computePriorityScore({ delta: validation.delta, evidenceStrength: validation.evidenceStrength, runCount: runs.length }),
      updatedAt: now.toISOString(),
    };
    await deps.store.updateRecommendation(recommendation);
  } else {
    recommendation = {
      recommendationId,
      tenantId: job.organizationId,
      skillId: skill.skillId,
      skillName: skill.name,
      skillTier: skill.tier,
      baseVersion: job.baseVersion,
      candidateVersion: nextCandidateVersion(job.baseVersion),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      trigger: job.trigger,
      evidence: {
        runCount: runs.length,
        failureCount: failureRuns.length,
        clusters: clusters.map((cluster) => cluster.label),
        runtimes: [...new Set(runs.map((run) => run.runtime))].sort(),
        medianEditRatio: medianEditRatio(runs),
        exampleRunIds: clusters[0]?.exampleRunIds ?? failureRuns.slice(0, 8).map((run) => run.runId),
      },
      objective: job.objective,
      explanation: buildExplanation({ runs, clusters, inferredPattern: result.inferredPattern, edits, validation }),
      proposedPatch: renderUnifiedDiff(baseContent, candidateContent, {
        fromLabel: `a/SKILL.md (${job.baseVersion})`,
        toLabel: `b/SKILL.md (${nextCandidateVersion(job.baseVersion)})`,
      }),
      baseContent,
      candidateContent,
      edits,
      lockedRegions: [],
      predictedImpact: validation.dimensions.map((dimension) => ({ dimension: dimension.dimension, delta: dimension.delta })),
      validation,
      dependencyImpact: {
        directDependents: dependents.direct,
        transitiveDependents: dependents.transitive,
        suites: dependents.suiteSkillIds.map((skillId) => ({
          skillId,
          passed: result.dependentSuites?.find((suite) => suite.skillId === skillId)?.passed ?? null,
        })),
      },
      provenance,
      status: "ready-for-review",
      requiresReevaluation: false,
      requiredApprovals: TIER_OPTIMIZATION_POLICIES[skill.tier].requiredApprovals,
      approvals: [],
      reviews: [],
      releaseRequestId: null,
      priorityScore: computePriorityScore({ delta: validation.delta, evidenceStrength: validation.evidenceStrength, runCount: runs.length }),
    };

    recommendation.lockedRegions = parseLockedRegions(baseContent).regions.map((region) => region.id);

    // A newer candidate supersedes older open recommendations for the same skill.
    const open = await deps.store.listRecommendations(job.organizationId, { skillId: skill.skillId, statuses: OPEN_STATUSES });
    for (const previous of open) {
      await deps.store.updateRecommendation({ ...previous, status: "superseded", updatedAt: now.toISOString() });
    }
    await deps.store.insertRecommendation(recommendation, { jobId: job.jobId, candidateId });
  }

  await deps.store.finishJob(job.jobId, "completed", null, recommendation.recommendationId);

  await deps.events.emit({
    organizationId: job.organizationId,
    actorRef: SYSTEM_ACTOR,
    category: "evaluation",
    action: "optimization.completed",
    targetType: "optimization_job",
    targetRef: job.jobId,
    payload: {
      skillId: skill.skillId,
      recommendationId: recommendation.recommendationId,
      gatePassed: validation.passed,
      delta: validation.delta,
      provenance,
    },
  });
  await deps.events.emit({
    organizationId: job.organizationId,
    actorRef: SYSTEM_ACTOR,
    category: "review",
    action: parent ? "recommendation.reevaluated" : "recommendation.created",
    targetType: "recommendation",
    targetRef: recommendation.recommendationId,
    payload: {
      skillId: skill.skillId,
      baseVersion: recommendation.baseVersion,
      candidateVersion: recommendation.candidateVersion ?? null,
      candidateContentHash,
      gate: validation.gate.map((entry) => ({ key: entry.key, passed: entry.passed })),
    },
  });

  return { recommendationId: recommendation.recommendationId, status: "completed" };
}

// ---------------------------------------------------------------------------
// HUMAN APPROVAL → RELEASE
// ---------------------------------------------------------------------------

export async function listSkillRecommendations(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; skillIdentifier: string },
): Promise<SkillImprovementRecommendation[]> {
  const skill = await requireSkill(deps, input.organizationId, input.skillIdentifier);
  return deps.store.listRecommendations(input.organizationId, { skillId: skill.skillId });
}

export async function getRecommendation(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; recommendationId: string },
): Promise<SkillImprovementRecommendation> {
  const recommendation = await deps.store.getRecommendation(input.organizationId, input.recommendationId);
  if (!recommendation) {
    throw new SkillIntelligenceError("recommendation_not_found", "Recommendation was not found.", 404);
  }
  return recommendation;
}

export async function reviewRecommendation(
  deps: SkillIntelligenceDeps,
  input: {
    organizationId: string;
    recommendationId: string;
    request: RecommendationReviewRequest;
    actor: ReviewActor & { subject: string; userId: string | null };
  },
): Promise<SkillImprovementRecommendation> {
  const current = await getRecommendation(deps, input);

  let outcome;
  try {
    outcome = applyReviewDecision({
      recommendation: current,
      request: input.request,
      actor: input.actor,
      reviewId: randomUUID(),
      now: nowOf(deps),
    });
  } catch (error) {
    if (error instanceof RecommendationWorkflowError) {
      throw new SkillIntelligenceError(error.code, error.message, error.status);
    }
    throw error;
  }

  let recommendation = outcome.recommendation;
  await deps.store.insertReview(input.organizationId, recommendation.recommendationId, outcome.review, input.actor.userId);
  await deps.store.updateRecommendation(recommendation);

  await deps.events.emit({
    organizationId: input.organizationId,
    actorRef: input.actor.subject,
    category: outcome.auditAction === "recommendation.reviewed" ? "review" : "approval",
    action: outcome.auditAction,
    targetType: "recommendation",
    targetRef: recommendation.recommendationId,
    payload: {
      skillId: recommendation.skillId,
      decision: input.request.decision,
      reasons: outcome.review.reasons,
      reviewerRole: input.actor.role,
      approvals: recommendation.approvals.length,
      requiredApprovals: recommendation.requiredApprovals,
      candidateContentHash: hashSkillContent(recommendation.candidateContent),
    },
  });

  for (const effect of outcome.effects) {
    if (effect.type === "reevaluate") {
      try {
        await requestOptimization(deps, {
          organizationId: input.organizationId,
          skillIdentifier: recommendation.skillId,
          request: { trigger: "manual" },
          actor: { subject: input.actor.subject, userId: input.actor.userId },
          parentRecommendationId: recommendation.recommendationId,
          bypassEvidenceGate: true,
        });
      } catch (error) {
        if (!(error instanceof SkillIntelligenceError) && !(error instanceof ActiveJobConflictError)) {
          throw error;
        }
        // Leave the recommendation in "evaluating"; the reviewer can retry via
        // requestReevaluation once the active job slot frees up.
      }
    }

    if (effect.type === "release-to-staging") {
      recommendation = await stageApprovedRecommendation(deps, {
        organizationId: input.organizationId,
        recommendation,
        actor: { subject: input.actor.subject, userId: input.actor.userId },
      });
    }
  }

  return recommendation;
}

export async function stageApprovedRecommendation(
  deps: SkillIntelligenceDeps,
  input: {
    organizationId: string;
    recommendation: SkillImprovementRecommendation;
    actor: { subject: string; userId: string | null };
  },
): Promise<SkillImprovementRecommendation> {
  if (input.recommendation.status !== "approved") {
    throw new SkillIntelligenceError("recommendation_not_approved", "Only approved recommendations can be staged.", 409);
  }
  if (input.recommendation.releaseRequestId) {
    return input.recommendation;
  }

  const staged = await deps.releases.stageCandidate(input);
  if (!staged.staged) {
    await deps.events.emit({
      organizationId: input.organizationId,
      actorRef: input.actor.subject,
      category: "release",
      action: "candidate.release_pending",
      targetType: "recommendation",
      targetRef: input.recommendation.recommendationId,
      payload: { reason: staged.reason },
    });
    return input.recommendation;
  }

  const updated: SkillImprovementRecommendation = {
    ...input.recommendation,
    releaseRequestId: staged.releaseRequestId,
    updatedAt: nowOf(deps).toISOString(),
  };
  await deps.store.updateRecommendation(updated);
  await deps.events.emit({
    organizationId: input.organizationId,
    actorRef: input.actor.subject,
    category: "release",
    action: "skill.version.released",
    targetType: "skill",
    targetRef: updated.skillId,
    payload: {
      recommendationId: updated.recommendationId,
      releaseRequestId: staged.releaseRequestId,
      commitSha: staged.commitSha,
      fromVersion: updated.baseVersion,
      toVersion: updated.candidateVersion ?? null,
      toEnvironment: "staging",
    },
  });
  return updated;
}

/** Retry enqueueing the evaluation for a recommendation stuck in "evaluating". */
export async function requestReevaluation(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; recommendationId: string; actor: { subject: string; userId: string | null } },
): Promise<OptimizationJobSummary> {
  const recommendation = await getRecommendation(deps, input);
  if (recommendation.status !== "evaluating") {
    throw new SkillIntelligenceError("recommendation_not_evaluating", "Only recommendations awaiting evaluation can be re-queued.", 409);
  }
  try {
    return await requestOptimization(deps, {
      organizationId: input.organizationId,
      skillIdentifier: recommendation.skillId,
      request: { trigger: "manual" },
      actor: input.actor,
      parentRecommendationId: recommendation.recommendationId,
      bypassEvidenceGate: true,
    });
  } catch (error) {
    if (error instanceof ActiveJobConflictError) {
      throw new SkillIntelligenceError(error.code, error.message, error.status);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Organization view, sweep, settings
// ---------------------------------------------------------------------------

export async function getOrganizationIntelligence(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string },
): Promise<OrganizationIntelligencePayload> {
  const now = nowOf(deps);
  const [skills, settings, coverageRows, recommendations, snapshots] = await Promise.all([
    deps.catalog.listSkills(input.organizationId),
    deps.store.getSettings(input.organizationId),
    deps.store.listOrgRunCoverage(input.organizationId, sinceIso(deps, 30)),
    deps.store.listRecommendations(input.organizationId, {}),
    deps.store.listHealthSnapshots(input.organizationId, sinceIso(deps, 90)),
  ]);

  const skillById = new Map(skills.map((skill) => [skill.skillId, skill]));
  const runsBySkill = new Map<string, number>();
  for (const row of coverageRows) {
    runsBySkill.set(row.skillId, (runsBySkill.get(row.skillId) ?? 0) + 1);
  }

  const trends = new Map<string, { first: number; last: number }>();
  for (const snapshot of snapshots) {
    if (snapshot.composite == null) continue;
    const entry = trends.get(snapshot.skillId);
    if (!entry) trends.set(snapshot.skillId, { first: snapshot.composite, last: snapshot.composite });
    else entry.last = snapshot.composite;
  }
  const trendDeltas = [...trends.values()].map((entry) => entry.last - entry.first);

  const open = recommendations.filter((recommendation) => OPEN_STATUSES.includes(recommendation.status));
  const queue: ImprovementQueueItem[] = open
    .map((recommendation) => ({
      recommendationId: recommendation.recommendationId,
      skillId: recommendation.skillId,
      skillName: recommendation.skillName,
      skillTier: recommendation.skillTier,
      status: recommendation.status,
      delta: recommendation.validation.delta,
      evidenceStrength: recommendation.validation.evidenceStrength,
      validated: recommendation.validation.passed && !recommendation.requiresReevaluation,
      runCount: recommendation.evidence.runCount,
      priorityScore: recommendation.priorityScore,
      band: priorityBand(recommendation.priorityScore),
    }))
    .sort((left, right) => right.priorityScore - left.priorityScore);

  const approvedDeltas = recommendations
    .filter((recommendation) => recommendation.status === "approved" && Date.parse(recommendation.updatedAt) >= now.getTime() - 90 * DAY_MS)
    .map((recommendation) => recommendation.validation.delta);

  const thresholdMinRuns = settings.thresholds.minRuns;
  const skillsWithRuns = [...runsBySkill.keys()].filter((skillId) => skillById.has(skillId));
  const sufficient = skillsWithRuns.filter((skillId) => {
    const skill = skillById.get(skillId);
    return skill ? (runsBySkill.get(skillId) ?? 0) >= resolveTierThresholds(settings.thresholds, skill.tier).minRuns : false;
  });
  const openSkillIds = new Set(open.map((recommendation) => recommendation.skillId));
  const top = queue[0];

  return {
    activeSkills: skills.length,
    runsThisMonth: coverageRows.length,
    evalCoveredSkillsPct: skills.length > 0
      ? round((skills.filter((skill) => skill.evalBenchmark != null).length / skills.length) * 100, 0)
      : null,
    skillsImproving: trendDeltas.filter((delta) => delta >= 1).length,
    skillsDegrading: trendDeltas.filter((delta) => delta <= -1).length,
    recommendationsAwaitingReview: open.filter((recommendation) => recommendation.status === "ready-for-review").length,
    medianQualityImprovement90d: approvedDeltas.length > 0 ? round(median(approvedDeltas) ?? 0, 1) : null,
    telemetrySufficientPct: skills.length > 0 ? round((sufficient.length / skills.length) * 100, 0) : null,
    highestOpportunity: top ? { skillId: top.skillId, skillName: top.skillName, delta: top.delta } : null,
    coverage: computeTelemetryCoverage(coverageRows),
    queue,
    needsData: skills
      .filter((skill) => !openSkillIds.has(skill.skillId) && (runsBySkill.get(skill.skillId) ?? 0) > 0)
      .map((skill) => ({
        skillId: skill.skillId,
        skillName: skill.name,
        runCount: runsBySkill.get(skill.skillId) ?? 0,
        minRuns: resolveTierThresholds(settings.thresholds, skill.tier).minRuns || thresholdMinRuns,
      }))
      .filter((entry) => entry.runCount < entry.minRuns)
      .sort((left, right) => right.runCount - left.runCount)
      .slice(0, 10),
    settings,
  };
}

/**
 * Periodic sweep (cron / worker): snapshot health for every skill with runs,
 * auto-enqueue jobs where the tenant's auto-optimization mode allows it, and
 * purge telemetry past its retention window.
 */
export async function runIntelligenceSweep(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string },
): Promise<{ snapshots: number; enqueued: string[]; purged: number }> {
  const settings = await deps.store.getSettings(input.organizationId);
  const skills = await deps.catalog.listSkills(input.organizationId);
  const enqueued: string[] = [];
  let snapshots = 0;

  if (settings.autoOptimizationMode !== "off") {
    for (const skill of skills) {
      const analysis = await analyzeSkill(deps, input.organizationId, skill);
      if (analysis.runs.length === 0) {
        continue;
      }
      await deps.store.saveHealthSnapshot(input.organizationId, analysis.health, computeCohorts(analysis.runs));
      snapshots += 1;

      const open = await deps.store.listRecommendations(input.organizationId, { skillId: skill.skillId, statuses: OPEN_STATUSES });
      const trigger = primaryTrigger(analysis.eligibility.triggers);
      if (trigger && shouldAutoEnqueue({
        mode: settings.autoOptimizationMode,
        eligibility: analysis.eligibility,
        hasActiveJob: analysis.jobs.some((job) => job.status === "queued" || job.status === "running"),
        hasOpenRecommendation: open.length > 0,
      })) {
        try {
          await requestOptimization(deps, {
            organizationId: input.organizationId,
            skillIdentifier: skill.skillId,
            request: { trigger },
            actor: { subject: SYSTEM_ACTOR, userId: null },
          });
          enqueued.push(skill.skillId);
        } catch (error) {
          if (!(error instanceof SkillIntelligenceError) && !(error instanceof ActiveJobConflictError)) {
            throw error;
          }
        }
      }
    }
  }

  return { snapshots, enqueued, purged: await deps.store.purgeExpiredTelemetry(nowOf(deps)) };
}

export async function updateIntelligenceSettings(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; body: unknown; actor: { subject: string; userId: string | null } },
): Promise<SkillIntelligenceSettings> {
  const current = await deps.store.getSettings(input.organizationId);
  const next = normalizeSkillIntelligenceSettings(input.body, current);
  await deps.store.saveSettings(input.organizationId, next, input.actor.userId);
  await deps.events.emit({
    organizationId: input.organizationId,
    actorRef: input.actor.subject,
    category: "policy",
    action: "skill_intelligence.settings_updated",
    targetType: "workspace",
    targetRef: input.organizationId,
    payload: { before: current, after: next },
  });
  return next;
}

export async function createIngestToken(
  deps: SkillIntelligenceDeps,
  input: { organizationId: string; label: string; connectorId: string | null; actor: { subject: string; userId: string | null } },
) {
  const token = `svt_${randomBytes(32).toString("base64url")}`;
  const created = await deps.store.createIngestToken({
    organizationId: input.organizationId,
    label: input.label,
    tokenHash: hashLeaseToken(token),
    connectorId: input.connectorId,
    userId: input.actor.userId,
  });
  await deps.events.emit({
    organizationId: input.organizationId,
    actorRef: input.actor.subject,
    category: "policy",
    action: "skill_intelligence.ingest_token_created",
    targetType: "workspace",
    targetRef: created.tokenId,
    payload: { label: input.label, connectorId: input.connectorId },
  });
  return { tokenId: created.tokenId, token, label: input.label, createdAt: created.createdAt };
}
