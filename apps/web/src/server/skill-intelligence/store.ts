// Persistence port for Skill Intelligence plus an in-memory implementation used
// by tests and by local development when no DATABASE_URL is configured.
// The Postgres implementation lives in postgres-store.ts.

import { randomUUID } from "node:crypto";

import type {
  CandidateValidation,
  ChangeBudget,
  CohortScore,
  ImprovementTrigger,
  OptimizationDatasetSummary,
  OptimizationJobStatus,
  OptimizationObjective,
  OptimizerProvenance,
  OptimizerProviderId,
  RecommendationEdit,
  RecommendationReview,
  RecommendationStatus,
  RejectionReason,
  SkillFeedbackRecord,
  SkillHealthSnapshot,
  SkillImprovementRecommendation,
  SkillIntelligenceSettings,
  SkillOutcomeRecord,
  SkillRuntime,
  TelemetryLevel,
} from "@savant/types";

import { aggregateWeakLabel, scoreRunFeedbackSummary } from "../../lib/skill-intelligence/feedback-signals.ts";
import type { AnalyzedRun } from "../../lib/skill-intelligence/health.ts";
import { DEFAULT_SKILL_INTELLIGENCE_SETTINGS } from "../../lib/skill-intelligence/policy.ts";
import type { PreparedRun } from "../../lib/skill-intelligence/run-ingest.ts";

export type RunArtifacts = { input: string | null; output: string | null };

export type JobRecord = {
  jobId: string;
  organizationId: string;
  skillId: string;
  baseVersion: string;
  trigger: ImprovementTrigger;
  status: OptimizationJobStatus;
  objective: OptimizationObjective;
  changeBudget: ChangeBudget;
  optimizerProvider: OptimizerProviderId;
  parentRecommendationId: string | null;
  requestedBy: string | null;
  attempt: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  recommendationId: string | null;
};

export type NewJob = Pick<
  JobRecord,
  | "organizationId"
  | "skillId"
  | "baseVersion"
  | "trigger"
  | "objective"
  | "changeBudget"
  | "optimizerProvider"
  | "parentRecommendationId"
  | "requestedBy"
>;

export type CandidateInsert = {
  jobId: string;
  organizationId: string;
  skillId: string;
  baseContentHash: string;
  candidateContent: string;
  candidateContentHash: string;
  edits: RecommendationEdit[];
  provenance: OptimizerProvenance;
  origin: "optimizer" | "human-modified";
};

export type CoverageRow = { skillId: string; runtime: SkillRuntime; telemetryLevel: TelemetryLevel };

export class ActiveJobConflictError extends Error {
  readonly code = "optimization_job_active";
  readonly status = 409;

  constructor(skillId: string) {
    super(`An optimization job is already queued or running for '${skillId}'.`);
    this.name = "ActiveJobConflictError";
  }
}

export interface SkillIntelligenceStore {
  readonly kind: "postgres" | "memory";

  getSettings(organizationId: string): Promise<SkillIntelligenceSettings>;
  saveSettings(organizationId: string, settings: SkillIntelligenceSettings, actorUserId: string | null): Promise<void>;

  insertRun(organizationId: string, prepared: PreparedRun): Promise<"inserted" | "duplicate">;
  findRunSkill(organizationId: string, runId: string): Promise<string | null>;
  insertFeedback(organizationId: string, record: SkillFeedbackRecord): Promise<boolean>;
  insertOutcome(organizationId: string, record: SkillOutcomeRecord): Promise<boolean>;
  listAnalyzedRuns(organizationId: string, skillId: string, sinceIso: string): Promise<AnalyzedRun[]>;
  listRunArtifacts(organizationId: string, runIds: readonly string[]): Promise<Map<string, RunArtifacts>>;
  listOrgRunCoverage(organizationId: string, sinceIso: string): Promise<CoverageRow[]>;

  saveHealthSnapshot(organizationId: string, snapshot: SkillHealthSnapshot, cohorts: CohortScore[]): Promise<void>;
  listHealthSnapshots(organizationId: string, sinceIso: string): Promise<Array<{ skillId: string; composite: number | null; computedAt: string }>>;

  enqueueJob(job: NewJob): Promise<JobRecord>;
  listJobs(organizationId: string, skillId: string, limit: number): Promise<JobRecord[]>;
  claimNextJob(leaseTokenHash: string, leaseSeconds: number, now: Date): Promise<JobRecord | null>;
  getLeasedJob(jobId: string, leaseTokenHash: string, now: Date): Promise<JobRecord | null>;
  finishJob(jobId: string, status: "completed" | "failed" | "canceled", error: string | null, recommendationId: string | null): Promise<void>;
  saveDatasets(jobId: string, datasets: readonly OptimizationDatasetSummary[]): Promise<void>;
  saveCandidate(candidate: CandidateInsert): Promise<string>;
  saveCandidateEvaluation(candidateId: string, validation: CandidateValidation): Promise<void>;

  insertRecommendation(recommendation: SkillImprovementRecommendation, links: { jobId: string | null; candidateId: string | null }): Promise<void>;
  updateRecommendation(recommendation: SkillImprovementRecommendation): Promise<void>;
  getRecommendation(organizationId: string, recommendationId: string): Promise<SkillImprovementRecommendation | null>;
  listRecommendations(organizationId: string, filter: { skillId?: string; statuses?: readonly RecommendationStatus[] }): Promise<SkillImprovementRecommendation[]>;
  insertReview(organizationId: string, recommendationId: string, review: RecommendationReview, reviewerUserId: string | null): Promise<void>;
  listRejectionSignals(organizationId: string, skillId: string): Promise<Array<{ reason: RejectionReason; count: number }>>;

  createIngestToken(input: { organizationId: string; label: string; tokenHash: string; connectorId: string | null; userId: string | null }): Promise<{ tokenId: string; createdAt: string }>;
  resolveIngestToken(tokenHash: string): Promise<{ organizationId: string; tokenId: string; connectorId: string | null } | null>;

  purgeExpiredTelemetry(now: Date): Promise<number>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

type MemoryRun = {
  organizationId: string;
  prepared: PreparedRun;
  feedback: SkillFeedbackRecord[];
  outcome: SkillOutcomeRecord | null;
};

type MemoryState = {
  settings: Map<string, SkillIntelligenceSettings>;
  runs: Map<string, MemoryRun>;
  snapshots: Array<{ organizationId: string; snapshot: SkillHealthSnapshot }>;
  jobs: Map<string, JobRecord & { leaseTokenHash: string | null; leaseExpiresAt: number | null }>;
  datasets: Map<string, OptimizationDatasetSummary[]>;
  candidates: Map<string, CandidateInsert & { validation: CandidateValidation | null }>;
  recommendations: Map<string, SkillImprovementRecommendation>;
  reviews: Array<{ organizationId: string; recommendationId: string; review: RecommendationReview }>;
  tokens: Map<string, { organizationId: string; tokenId: string; connectorId: string | null }>;
};

function runKey(organizationId: string, runId: string): string {
  return `${organizationId}::${runId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function toAnalyzedRun(run: MemoryRun): AnalyzedRun {
  const { request, storedLevel, inputFingerprint } = run.prepared;
  const summary = request.feedback;
  const summaryScore = scoreRunFeedbackSummary(summary);
  const editRatios = run.feedback.map((entry) => entry.editRatio).filter((value): value is number => value != null);

  return {
    runId: request.runId,
    runtime: request.runtime,
    model: request.model ?? null,
    skillVersionId: request.skillVersionId,
    connectorId: request.connectorId,
    telemetryLevel: storedLevel,
    success: request.success ?? null,
    startedAt: request.startedAt,
    latencyMs: request.latencyMs ?? null,
    estimatedCost: request.estimatedCost ?? null,
    weakLabel: aggregateWeakLabel(run.feedback, summaryScore),
    taskArchetype: request.taskArchetype ?? null,
    businessUnit: request.businessUnit ?? null,
    inputStructure: request.inputStructure ?? null,
    inputFingerprint,
    feedbackCategories: [...new Set(run.feedback.flatMap((entry) => entry.categories ?? []))],
    passiveSignals: run.feedback.flatMap((entry) => (entry.signal ? [entry.signal] : [])),
    rubricFailures: [...new Set(run.feedback.flatMap((entry) =>
      entry.rubricDimension && entry.derivedScore < 0 ? [entry.rubricDimension] : [],
    ))],
    editRatio: editRatios.length > 0 ? Math.max(...editRatios) : summary?.editDistance ?? null,
    humanAccepted: run.outcome?.humanAccepted ?? summary?.accepted ?? null,
    taskOutcome: run.outcome?.taskOutcome ?? null,
    outputScore: run.outcome?.outputScore ?? null,
  };
}

export function createMemorySkillIntelligenceStore(): SkillIntelligenceStore {
  const state: MemoryState = {
    settings: new Map(),
    runs: new Map(),
    snapshots: [],
    jobs: new Map(),
    datasets: new Map(),
    candidates: new Map(),
    recommendations: new Map(),
    reviews: [],
    tokens: new Map(),
  };

  return {
    kind: "memory",

    async getSettings(organizationId) {
      return clone(state.settings.get(organizationId) ?? DEFAULT_SKILL_INTELLIGENCE_SETTINGS);
    },

    async saveSettings(organizationId, settings) {
      state.settings.set(organizationId, clone(settings));
    },

    async insertRun(organizationId, prepared) {
      const key = runKey(organizationId, prepared.request.runId);
      if (state.runs.has(key)) {
        return "duplicate";
      }
      state.runs.set(key, { organizationId, prepared: clone(prepared), feedback: [], outcome: null });
      return "inserted";
    },

    async findRunSkill(organizationId, runId) {
      return state.runs.get(runKey(organizationId, runId))?.prepared.request.skillId ?? null;
    },

    async insertFeedback(organizationId, record) {
      const run = state.runs.get(runKey(organizationId, record.runId));
      if (!run) {
        return false;
      }
      run.feedback.push(clone(record));
      return true;
    },

    async insertOutcome(organizationId, record) {
      const run = state.runs.get(runKey(organizationId, record.runId));
      if (!run) {
        return false;
      }
      run.outcome = clone(record);
      return true;
    },

    async listAnalyzedRuns(organizationId, skillId, sinceIso) {
      const since = Date.parse(sinceIso);
      return [...state.runs.values()]
        .filter((run) =>
          run.organizationId === organizationId
          && run.prepared.request.skillId === skillId
          && Date.parse(run.prepared.request.startedAt) >= since,
        )
        .map(toAnalyzedRun)
        .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
    },

    async listRunArtifacts(organizationId, runIds) {
      const result = new Map<string, RunArtifacts>();
      for (const runId of runIds) {
        const run = state.runs.get(runKey(organizationId, runId));
        if (!run) {
          continue;
        }
        result.set(runId, {
          input: run.prepared.artifacts.find((artifact) => artifact.kind === "input")?.text ?? null,
          output: run.prepared.artifacts.find((artifact) => artifact.kind === "output")?.text ?? null,
        });
      }
      return result;
    },

    async listOrgRunCoverage(organizationId, sinceIso) {
      const since = Date.parse(sinceIso);
      return [...state.runs.values()]
        .filter((run) => run.organizationId === organizationId && Date.parse(run.prepared.request.startedAt) >= since)
        .map((run) => ({
          skillId: run.prepared.request.skillId,
          runtime: run.prepared.request.runtime,
          telemetryLevel: run.prepared.storedLevel,
        }));
    },

    async saveHealthSnapshot(organizationId, snapshot) {
      state.snapshots.push({ organizationId, snapshot: clone(snapshot) });
    },

    async listHealthSnapshots(organizationId, sinceIso) {
      const since = Date.parse(sinceIso);
      return state.snapshots
        .filter((entry) => entry.organizationId === organizationId && Date.parse(entry.snapshot.computedAt) >= since)
        .map((entry) => ({
          skillId: entry.snapshot.skillId,
          composite: entry.snapshot.composite,
          computedAt: entry.snapshot.computedAt,
        }));
    },

    async enqueueJob(job) {
      const active = [...state.jobs.values()].some((existing) =>
        existing.organizationId === job.organizationId
        && existing.skillId === job.skillId
        && (existing.status === "queued" || existing.status === "running"),
      );
      if (active) {
        throw new ActiveJobConflictError(job.skillId);
      }
      const record: JobRecord & { leaseTokenHash: string | null; leaseExpiresAt: number | null } = {
        ...clone(job),
        jobId: randomUUID(),
        status: "queued",
        attempt: 0,
        queuedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null,
        recommendationId: null,
        leaseTokenHash: null,
        leaseExpiresAt: null,
      };
      state.jobs.set(record.jobId, record);
      return clone(record);
    },

    async listJobs(organizationId, skillId, limit) {
      return [...state.jobs.values()]
        .filter((job) => job.organizationId === organizationId && job.skillId === skillId)
        .sort((left, right) => Date.parse(right.queuedAt) - Date.parse(left.queuedAt))
        .slice(0, limit)
        .map(clone);
    },

    async claimNextJob(leaseTokenHash, leaseSeconds, now) {
      const nowMs = now.getTime();
      const candidate = [...state.jobs.values()]
        .filter((job) =>
          job.status === "queued"
          || (job.status === "running" && job.leaseExpiresAt != null && job.leaseExpiresAt < nowMs),
        )
        .sort((left, right) => Date.parse(left.queuedAt) - Date.parse(right.queuedAt))[0];
      if (!candidate) {
        return null;
      }
      candidate.status = "running";
      candidate.startedAt = now.toISOString();
      candidate.attempt += 1;
      candidate.leaseTokenHash = leaseTokenHash;
      candidate.leaseExpiresAt = nowMs + leaseSeconds * 1000;
      return clone(candidate);
    },

    async getLeasedJob(jobId, leaseTokenHash, now) {
      const job = state.jobs.get(jobId);
      if (!job || job.status !== "running" || job.leaseTokenHash !== leaseTokenHash) {
        return null;
      }
      if (job.leaseExpiresAt != null && job.leaseExpiresAt < now.getTime()) {
        return null;
      }
      return clone(job);
    },

    async finishJob(jobId, status, error, recommendationId) {
      const job = state.jobs.get(jobId);
      if (!job) {
        return;
      }
      job.status = status;
      job.error = error;
      job.recommendationId = recommendationId;
      job.completedAt = new Date().toISOString();
      job.leaseTokenHash = null;
    },

    async saveDatasets(jobId, datasets) {
      state.datasets.set(jobId, clone([...datasets]));
    },

    async saveCandidate(candidate) {
      const candidateId = randomUUID();
      state.candidates.set(candidateId, { ...clone(candidate), validation: null });
      return candidateId;
    },

    async saveCandidateEvaluation(candidateId, validation) {
      const candidate = state.candidates.get(candidateId);
      if (candidate) {
        candidate.validation = clone(validation);
      }
    },

    async insertRecommendation(recommendation) {
      state.recommendations.set(recommendation.recommendationId, clone(recommendation));
    },

    async updateRecommendation(recommendation) {
      state.recommendations.set(recommendation.recommendationId, clone(recommendation));
    },

    async getRecommendation(organizationId, recommendationId) {
      const recommendation = state.recommendations.get(recommendationId);
      return recommendation && recommendation.tenantId === organizationId ? clone(recommendation) : null;
    },

    async listRecommendations(organizationId, filter) {
      return [...state.recommendations.values()]
        .filter((recommendation) =>
          recommendation.tenantId === organizationId
          && (!filter.skillId || recommendation.skillId === filter.skillId)
          && (!filter.statuses || filter.statuses.includes(recommendation.status)),
        )
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map(clone);
    },

    async insertReview(organizationId, recommendationId, review) {
      state.reviews.push({ organizationId, recommendationId, review: clone(review) });
    },

    async listRejectionSignals(organizationId, skillId) {
      const counts = new Map<RejectionReason, number>();
      for (const entry of state.reviews) {
        const recommendation = state.recommendations.get(entry.recommendationId);
        if (entry.organizationId !== organizationId || recommendation?.skillId !== skillId || entry.review.decision !== "reject") {
          continue;
        }
        for (const reason of entry.review.reasons) {
          counts.set(reason, (counts.get(reason) ?? 0) + 1);
        }
      }
      return [...counts.entries()].map(([reason, count]) => ({ reason, count }));
    },

    async createIngestToken(input) {
      const tokenId = randomUUID();
      state.tokens.set(input.tokenHash, { organizationId: input.organizationId, tokenId, connectorId: input.connectorId });
      return { tokenId, createdAt: new Date().toISOString() };
    },

    async resolveIngestToken(tokenHash) {
      return clone(state.tokens.get(tokenHash) ?? null);
    },

    async purgeExpiredTelemetry(now) {
      let purged = 0;
      for (const [key, run] of state.runs) {
        if (Date.parse(run.prepared.expiresAt) < now.getTime()) {
          state.runs.delete(key);
          purged += 1;
        }
      }
      return purged;
    },
  };
}
