// Skill Intelligence domain types: run telemetry, health, failure clusters,
// optimization jobs, and human-governed improvement recommendations.
//
// SkillOpt is an optimization engine behind an adapter boundary. Nothing in
// these types grants the optimizer authority to approve, publish, or modify a
// production skill; only the recommendation review workflow can move a
// candidate forward, and only into the existing release rail.

import type { CollectionResponse, ResourceResponse, SkillTier } from "./control-plane.ts";

// ---------------------------------------------------------------------------
// Run telemetry
// ---------------------------------------------------------------------------

export type SkillRuntime =
  | "openai"
  | "chatgpt"
  | "claude"
  | "codex"
  | "copilot"
  | "vscode"
  | "cursor"
  | "gemini"
  | "api"
  | "other";

export const SKILL_RUNTIMES: readonly SkillRuntime[] = [
  "openai",
  "chatgpt",
  "claude",
  "codex",
  "copilot",
  "vscode",
  "cursor",
  "gemini",
  "api",
  "other",
];

/**
 * full    — input, output, trajectory, feedback, outcome
 * io      — input/output + timing + feedback, no internal trajectory
 * outcome — success/failure + disposition only
 */
export type TelemetryLevel = "full" | "io" | "outcome";

export type TelemetryCaptureMode = "metrics-only" | "inputs-outputs" | "full-trajectories";

export type RetentionClass = "30d" | "90d" | "1y" | "custom";

export interface SkillRunFeedbackSummary {
  accepted?: boolean;
  rating?: number;
  revisionRequired?: boolean;
  editDistance?: number;
}

export interface SkillRunPolicy {
  captureMode: TelemetryCaptureMode;
  retentionClass: RetentionClass;
  redactionApplied: boolean;
}

export interface SkillRun {
  runId: string;
  tenantId: string;

  skillId: string;
  skillVersionId: string;

  userId?: string;
  groupIds?: string[];

  connectorId: string;
  runtime: SkillRuntime;

  model?: string;

  startedAt: string;
  completedAt?: string;

  telemetryLevel: TelemetryLevel;

  inputRef?: string;
  outputRef?: string;
  trajectoryRef?: string;

  success?: boolean;

  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;

  /** Technical cohort hints. Never demographic or sensitive-person attributes. */
  taskArchetype?: string;
  inputStructure?: "structured" | "unstructured";
  businessUnit?: string;

  feedback?: SkillRunFeedbackSummary;

  policy: SkillRunPolicy;
}

export interface SkillRunTrajectoryStep {
  kind: "message" | "tool-call" | "tool-result" | "reasoning-summary" | "event";
  name?: string;
  content: string;
  at?: string;
}

/** Wire format posted by Savant adapters, SDKs, and sync agents. */
export interface SkillRunIngestRequest {
  runId: string;
  skillId: string;
  skillVersionId: string;
  connectorId: string;
  runtime: SkillRuntime;
  model?: string;
  startedAt: string;
  completedAt?: string;
  telemetryLevel: TelemetryLevel;
  success?: boolean;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  taskArchetype?: string;
  inputStructure?: "structured" | "unstructured";
  businessUnit?: string;
  userRef?: string;
  groupIds?: string[];
  input?: string;
  output?: string;
  trajectory?: SkillRunTrajectoryStep[];
  feedback?: SkillRunFeedbackSummary;
}

export interface SkillRunIngestResult {
  runId: string;
  accepted: boolean;
  /** Level actually persisted after tenant/skill capture policy was applied. */
  storedTelemetryLevel: TelemetryLevel | null;
  redactionApplied: boolean;
  redactionCounts: Record<string, number>;
  droppedFields: string[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// Feedback & outcomes
// ---------------------------------------------------------------------------

export type PassiveSignalType =
  | "accepted-untouched"
  | "accepted-after-edit"
  | "discarded"
  | "regenerated"
  | "retried"
  | "alternate-skill-selected"
  | "human-override"
  | "copied"
  | "exported"
  | "downstream-completed"
  | "downstream-failed";

export const PASSIVE_SIGNAL_TYPES: readonly PassiveSignalType[] = [
  "accepted-untouched",
  "accepted-after-edit",
  "discarded",
  "regenerated",
  "retried",
  "alternate-skill-selected",
  "human-override",
  "copied",
  "exported",
  "downstream-completed",
  "downstream-failed",
];

export type ExplicitFeedbackCategory =
  | "good-result"
  | "bad-result"
  | "missing-knowledge"
  | "incorrect-procedure"
  | "too-verbose"
  | "insufficient-detail"
  | "obsolete-information"
  | "format-failure"
  | "tool-use-failure"
  | "unsafe-recommendation"
  | "should-have-done";

export const EXPLICIT_FEEDBACK_CATEGORIES: readonly ExplicitFeedbackCategory[] = [
  "good-result",
  "bad-result",
  "missing-knowledge",
  "incorrect-procedure",
  "too-verbose",
  "insufficient-detail",
  "obsolete-information",
  "format-failure",
  "tool-use-failure",
  "unsafe-recommendation",
  "should-have-done",
];

export type FeedbackReporterRole = "user" | "sme" | "system";

export interface SkillFeedbackRequest {
  kind: "passive" | "explicit";
  signal?: PassiveSignalType;
  categories?: ExplicitFeedbackCategory[];
  rating?: number;
  /** 0..1 fraction of the output changed before use. */
  editRatio?: number;
  comment?: string;
  reporterRole?: FeedbackReporterRole;
  /** Optional rubric dimension an SME scored against. */
  rubricDimension?: string;
}

export interface SkillFeedbackRecord extends SkillFeedbackRequest {
  feedbackId: string;
  runId: string;
  recordedAt: string;
  /** Derived weak-label score in [-1, 1]; recomputed if weighting changes. */
  derivedScore: number;
}

export type TaskOutcome = "succeeded" | "failed" | "unknown";

export interface SkillOutcomeRequest {
  outputScore?: number;
  humanAccepted?: boolean;
  taskOutcome: TaskOutcome;
  outcomeLabel?: string;
}

export interface SkillOutcomeRecord extends SkillOutcomeRequest {
  runId: string;
  recordedAt: string;
}

// ---------------------------------------------------------------------------
// Health, cohorts, coverage
// ---------------------------------------------------------------------------

export type HealthDimensionKey =
  | "task-success"
  | "human-acceptance"
  | "eval-benchmark"
  | "policy-compliance"
  | "consistency"
  | "efficiency"
  | "regression-stability";

export interface HealthDimension {
  key: HealthDimensionKey;
  label: string;
  score: number | null;
  sampleCount: number;
}

export interface SkillHealthSnapshot {
  skillId: string;
  /** Navigation aid only. Promotion decisions must inspect `dimensions`. */
  composite: number | null;
  dimensions: HealthDimension[];
  trend7d: number | null;
  trend30d: number | null;
  runCount: number;
  fullTrajectoryCoverage: number;
  computedAt: string;
}

export type CohortType =
  | "runtime"
  | "model"
  | "skill-version"
  | "task-archetype"
  | "connector"
  | "business-unit"
  | "input-structure";

export interface CohortScore {
  cohortType: CohortType;
  cohortKey: string;
  score: number | null;
  runCount: number;
  /** True when meaningfully below the skill-wide score with enough runs. */
  flagged: boolean;
}

export interface TelemetryCoverageRow {
  runtime: SkillRuntime;
  runCount: number;
  dominantLevel: TelemetryLevel;
  /** Share of runs at the dominant level, 0..100. */
  coveragePct: number;
  levelCounts: Record<TelemetryLevel, number>;
}

export type FailureClusterBasis =
  | "feedback-category"
  | "rubric-dimension"
  | "metadata"
  | "text-similarity";

export interface FailureCluster {
  clusterId: string;
  label: string;
  basis: FailureClusterBasis;
  runCount: number;
  distinctTasks: number;
  runtimes: SkillRuntime[];
  exampleRunIds: string[];
  /** Share of all failures in the analysis window, 0..100. */
  share: number;
}

// ---------------------------------------------------------------------------
// Triggers & eligibility
// ---------------------------------------------------------------------------

export type ImprovementTrigger =
  | "performance-degradation"
  | "failure-cluster"
  | "high-edit-rate"
  | "new-environment"
  | "scheduled"
  | "manual";

export interface EvidenceThresholds {
  minRuns: number;
  minDistinctTasks: number;
  minFailureExamples: number;
  minHeldOutCases: number;
}

export interface TriggerFinding {
  trigger: ImprovementTrigger;
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface OptimizationEligibility {
  eligible: boolean;
  blockers: string[];
  thresholds: EvidenceThresholds;
  observed: {
    runs: number;
    distinctTasks: number;
    failureExamples: number;
    heldOutCandidates: number;
  };
  triggers: TriggerFinding[];
}

// ---------------------------------------------------------------------------
// Optimization configuration & provenance
// ---------------------------------------------------------------------------

export type OptimizationAggressiveness = "conservative" | "balanced" | "exploratory";

export type EditOperation = "add" | "delete" | "replace";

export interface ChangeBudget {
  aggressiveness: OptimizationAggressiveness;
  maxChangedLines: number;
  maxChangedTokens: number;
  allowedOperations: EditOperation[];
  maxIterations: number;
  /** SkillOpt textual learning-rate: max edits applied per optimizer step. */
  learningRate: number;
  /** Heading names the optimizer may touch, or "all" (locked regions always excluded). */
  permittedSections: string[] | "all";
}

export type AutoOptimizationMode = "off" | "observe" | "recommend" | "continuous-evaluation";

export type OptimizerProviderId =
  | "azure-openai"
  | "openai-enterprise"
  | "openai-public"
  | "anthropic-enterprise"
  | "anthropic-public"
  | "local-approved"
  | "local-unknown";

export type SkillClassification = "public" | "internal" | "confidential" | "restricted";

export interface OptimizerProvenance {
  engine: "skillopt";
  engineDisplayName: string;
  version: string;
  sourceCommit: string | null;
  optimizerModel: string;
  optimizerBackend: string;
  configHash: string;
}

export interface OptimizationObjective {
  statement: string;
  primary: Array<{ dimension: string; direction: "increase" | "decrease" }>;
  guardrails: Array<{ dimension: string; constraint: "non-decreasing" | "non-increasing" }>;
}

export type OptimizationJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface OptimizationJobSummary {
  jobId: string;
  skillId: string;
  trigger: ImprovementTrigger;
  status: OptimizationJobStatus;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  recommendationId: string | null;
}

export interface SkillIntelligenceSettings {
  telemetryMode: TelemetryCaptureMode;
  retention: RetentionClass;
  retentionCustomDays: number | null;
  autoOptimizationMode: AutoOptimizationMode;
  aggressiveness: OptimizationAggressiveness;
  thresholds: EvidenceThresholds;
  allowedOptimizerProviders: OptimizerProviderId[];
  /** Skills whose optimization telemetry is disabled entirely. */
  optimizationDisabledSkills: string[];
  /** Configured PII classes to redact before persistence. */
  redactPiiClasses: Array<"email" | "phone" | "ssn" | "credit-card" | "ip-address">;
  /** Whether raw user identity is retained (permission-controlled) or pseudonymized. */
  retainUserIdentity: boolean;
}

// ---------------------------------------------------------------------------
// Recommendations & review
// ---------------------------------------------------------------------------

export type RecommendationStatus =
  | "generated"
  | "evaluating"
  | "ready-for-review"
  | "approved"
  | "rejected"
  | "superseded";

export type RecommendationEditStatus = "proposed" | "accepted" | "rejected";

export interface RecommendationEdit {
  editId: string;
  op: EditOperation;
  /** Heading the edit falls under, when known. */
  section: string | null;
  /** 0-based line index in the base SKILL.md where the hunk starts. */
  baseStart: number;
  /** Number of base lines the hunk removes (0 for a pure addition). */
  baseLength: number;
  /** Removed text (empty for an addition). */
  before: string;
  /** Inserted text (empty for a deletion). */
  after: string;
  /** Line the change follows, shown for context on additions. */
  anchor: string;
  rationale: string;
  status: RecommendationEditStatus;
}

export type GateCheckKey =
  | "primary-objective"
  | "critical-safety"
  | "regression-tests"
  | "locked-rules"
  | "change-budget"
  | "statistical-confidence"
  | "shadow-holdout"
  | "downstream-dependents"
  | "runtime-portability"
  | "human-approval";

export interface GateCheck {
  key: GateCheckKey;
  label: string;
  passed: boolean;
  /** Advisory checks inform reviewers but do not block by themselves. */
  blocking: boolean;
  detail: string;
}

export type EvidenceStrength = "high" | "medium" | "low" | "insufficient";

export interface DimensionDelta {
  dimension: string;
  baseline: number;
  candidate: number;
  delta: number;
  /** When true, a lower value is better (latency, cost, edit rate). */
  lowerIsBetter: boolean;
  critical: boolean;
}

export interface RuntimeMatrixRow {
  runtime: SkillRuntime;
  baseline: number;
  candidate: number;
  delta: number;
  sampleCount: number;
}

export interface CandidateValidation {
  baselineScore: number;
  candidateScore: number;
  delta: number;
  regressions: number;
  passed: boolean;
  sampleCount: number;
  interval: { low: number; high: number; confidence: number } | null;
  evidenceStrength: EvidenceStrength;
  dimensions: DimensionDelta[];
  regressionSuite: { total: number; passed: number };
  holdout: { total: number; baseline: number; candidate: number } | null;
  runtimeMatrix: RuntimeMatrixRow[];
  latencyDeltaPct: number | null;
  costDeltaPct: number | null;
  gate: GateCheck[];
  evaluatedAt: string;
  /** Hash of the exact candidate content these results were produced for. */
  candidateContentHash: string;
}

export interface RecommendationExplanation {
  observed: string;
  inferredPattern: string;
  change: string;
  evidence: string;
}

export interface DependencyImpact {
  directDependents: number;
  transitiveDependents: number;
  suites: Array<{ skillId: string; passed: boolean | null }>;
}

export type RejectionReason =
  | "recommendation-incorrect"
  | "insufficient-evidence"
  | "style-regression"
  | "security-concern"
  | "overfit"
  | "duplicate-instruction"
  | "violates-organizational-method"
  | "good-idea-wrong-wording"
  | "unnecessary-complexity";

export const REJECTION_REASONS: readonly RejectionReason[] = [
  "recommendation-incorrect",
  "insufficient-evidence",
  "style-regression",
  "security-concern",
  "overfit",
  "duplicate-instruction",
  "violates-organizational-method",
  "good-idea-wrong-wording",
  "unnecessary-complexity",
];

export type ReviewDecision = "approve" | "reject" | "modify" | "request-more-testing";

export interface RecommendationReview {
  reviewId: string;
  reviewer: string;
  reviewerRole: string;
  decision: ReviewDecision;
  reasons: RejectionReason[];
  comment: string | null;
  editDecisions: Record<string, RecommendationEditStatus>;
  createdAt: string;
}

export interface SkillImprovementRecommendation {
  recommendationId: string;

  tenantId: string;
  skillId: string;
  skillName: string;
  skillTier: SkillTier;

  baseVersion: string;
  candidateVersion?: string;

  createdAt: string;
  updatedAt: string;

  trigger: ImprovementTrigger;

  evidence: {
    runCount: number;
    failureCount: number;
    clusters: string[];
    runtimes: SkillRuntime[];
    medianEditRatio: number | null;
    exampleRunIds: string[];
  };

  objective: OptimizationObjective;
  explanation: RecommendationExplanation;

  /** Unified diff of SKILL.md, base → candidate. */
  proposedPatch: string;
  baseContent: string;
  candidateContent: string;
  edits: RecommendationEdit[];
  lockedRegions: string[];

  predictedImpact?: {
    dimension: string;
    delta: number;
  }[];

  validation: CandidateValidation;
  dependencyImpact: DependencyImpact | null;
  provenance: OptimizerProvenance;

  status: RecommendationStatus;
  /** Candidate was edited by a human after validation and must be re-evaluated. */
  requiresReevaluation: boolean;
  requiredApprovals: number;
  approvals: string[];
  reviews: RecommendationReview[];
  releaseRequestId: string | null;

  reviewer?: string;

  /** impact × confidence × usage, used to order the improvement queue. */
  priorityScore: number;
}

export interface RecommendationReviewRequest {
  decision: ReviewDecision;
  reasons?: RejectionReason[];
  comment?: string;
  /** Per-edit accept/reject decisions (partial acceptance). */
  editDecisions?: Record<string, RecommendationEditStatus>;
  /** Full manual replacement of the candidate SKILL.md (forces re-evaluation). */
  candidateContent?: string;
}

// ---------------------------------------------------------------------------
// Read payloads
// ---------------------------------------------------------------------------

export interface SkillRunListItem {
  runId: string;
  runtime: SkillRuntime;
  model: string | null;
  skillVersionId: string;
  telemetryLevel: TelemetryLevel;
  success: boolean | null;
  startedAt: string;
  started: string;
  latencyMs: number | null;
  estimatedCost: number | null;
  weakLabel: number | null;
  feedbackCategories: ExplicitFeedbackCategory[];
  taskArchetype: string | null;
  redactionApplied: boolean;
}

export interface LearningHistoryPoint {
  version: string;
  releasedAt: string;
  runsUsed: number | null;
  score: number | null;
  delta: number | null;
  optimizerGenerated: boolean;
  regressions: number;
}

export interface SkillIntelligencePayload {
  skillId: string;
  skillName: string;
  skillTier: SkillTier;
  telemetryEnabled: boolean;
  health: SkillHealthSnapshot;
  cohorts: CohortScore[];
  coverage: TelemetryCoverageRow[];
  clusters: FailureCluster[];
  eligibility: OptimizationEligibility;
  runs: SkillRunListItem[];
  learningHistory: LearningHistoryPoint[];
  jobs: OptimizationJobSummary[];
  autoOptimizationMode: AutoOptimizationMode;
}

export interface ImprovementQueueItem {
  recommendationId: string;
  skillId: string;
  skillName: string;
  skillTier: SkillTier;
  status: RecommendationStatus;
  delta: number;
  evidenceStrength: EvidenceStrength;
  validated: boolean;
  runCount: number;
  priorityScore: number;
  band: "high" | "medium" | "low";
}

export interface NeedsDataItem {
  skillId: string;
  skillName: string;
  runCount: number;
  minRuns: number;
}

export interface OrganizationIntelligencePayload {
  activeSkills: number;
  runsThisMonth: number;
  evalCoveredSkillsPct: number | null;
  skillsImproving: number;
  skillsDegrading: number;
  recommendationsAwaitingReview: number;
  medianQualityImprovement90d: number | null;
  telemetrySufficientPct: number | null;
  highestOpportunity: { skillId: string; skillName: string; delta: number } | null;
  coverage: TelemetryCoverageRow[];
  queue: ImprovementQueueItem[];
  needsData: NeedsDataItem[];
  settings: SkillIntelligenceSettings;
}

export interface OptimizationTriggerRequest {
  trigger?: ImprovementTrigger;
  aggressiveness?: OptimizationAggressiveness;
  objective?: string;
}

export interface IngestTokenCreatePayload {
  tokenId: string;
  /** Returned exactly once. Only a SHA-256 hash is stored. */
  token: string;
  label: string;
  createdAt: string;
}

export type SkillRunIngestResponse = ResourceResponse<SkillRunIngestResult>;
export type SkillFeedbackResponse = ResourceResponse<SkillFeedbackRecord>;
export type SkillOutcomeResponse = ResourceResponse<SkillOutcomeRecord>;
export type SkillIntelligenceResponse = ResourceResponse<SkillIntelligencePayload>;
export type SkillImprovementListResponse = CollectionResponse<SkillImprovementRecommendation>;
export type SkillImprovementResponse = ResourceResponse<SkillImprovementRecommendation>;
export type OptimizationJobResponse = ResourceResponse<OptimizationJobSummary>;
export type OrganizationIntelligenceResponse = ResourceResponse<OrganizationIntelligencePayload>;
export type SkillIntelligenceSettingsResponse = ResourceResponse<SkillIntelligenceSettings>;
export type IngestTokenCreateResponse = ResourceResponse<IngestTokenCreatePayload>;

// ---------------------------------------------------------------------------
// Worker contract (control plane ⇄ services/skill-intelligence)
//
// The worker holds no database credentials. It claims a lease on a job and
// receives this sanitized bundle; it returns raw paired case results which the
// control plane re-scores and re-gates itself.
// ---------------------------------------------------------------------------

export interface OptimizationBundleRun {
  runId: string;
  runtime: SkillRuntime;
  model: string | null;
  skillVersionId: string;
  telemetryLevel: TelemetryLevel;
  success: boolean | null;
  weakLabel: number | null;
  feedbackCategories: ExplicitFeedbackCategory[];
  rubricFailures: string[];
  taskArchetype: string | null;
  inputFingerprint: string | null;
  /** Redacted at ingest; redacted again by the worker before optimization. */
  input: string | null;
  output: string | null;
  startedAt: string;
}

export interface OptimizationJobBundle {
  schemaVersion: 1;
  jobId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  tenantId: string;
  mode: "optimize" | "evaluate-only";
  skill: {
    skillId: string;
    name: string;
    tier: SkillTier;
    classification: SkillClassification;
    baseVersion: string;
    /** Current production SKILL.md. The only file SkillOpt may propose changes to. */
    skillMd: string;
  };
  /** For evaluate-only jobs (human-modified candidates): the exact content to evaluate. */
  candidateOverride: string | null;
  trigger: ImprovementTrigger;
  objective: OptimizationObjective;
  changeBudget: ChangeBudget;
  optimizer: { provider: OptimizerProviderId; model: string | null };
  thresholds: EvidenceThresholds;
  clusters: FailureCluster[];
  /** Structured rejection reasons from earlier reviews; prose is never included. */
  rejectionSignals: Array<{ reason: RejectionReason; count: number }>;
  dependents: { direct: number; transitive: number; suiteSkillIds: string[] };
  runs: OptimizationBundleRun[];
  piiClasses: SkillIntelligenceSettings["redactPiiClasses"];
}

export interface OptimizationCaseResult {
  caseId: string;
  partition: "validation" | "regression" | "holdout";
  runtime?: SkillRuntime;
  baseline: number;
  candidate: number;
  dimensions?: Record<string, { baseline: number; candidate: number }>;
  baselineLatencyMs?: number;
  candidateLatencyMs?: number;
  baselineCost?: number;
  candidateCost?: number;
}

export interface OptimizationDatasetSummary {
  partition: "train" | "validation" | "regression" | "holdout";
  caseCount: number;
  runIds: string[];
  datasetHash: string;
  curationSummary: Record<string, number>;
}

export interface OptimizationJobResult {
  schemaVersion: 1;
  jobId: string;
  leaseToken: string;
  status: "completed" | "failed";
  error?: string;
  candidateContent?: string;
  editRationales?: Array<{ baseStart: number; rationale: string }>;
  inferredPattern?: string;
  cases?: OptimizationCaseResult[];
  dependentSuites?: Array<{ skillId: string; passed: boolean }>;
  datasets?: OptimizationDatasetSummary[];
  provenance?: OptimizerProvenance;
}

export type OptimizationJobClaimResponse = ResourceResponse<OptimizationJobBundle | null>;
