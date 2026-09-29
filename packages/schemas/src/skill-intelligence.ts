// JSON Schemas (draft 2020-12) for the Skill Intelligence wire contracts.
//
// These are published for Savant adapters, SDKs, sync agents, and the Python
// worker. The TypeScript source of truth is @savant/types/skill-intelligence;
// the control plane's hand-written validators in apps/web enforce the same
// rules. packages/schemas/fixtures/ holds a canonical worker bundle example
// that both the TypeScript and Python test suites check against.

const RUNTIMES = ["openai", "claude", "codex", "copilot", "vscode", "api", "other"] as const;

export const trajectoryStepSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/skill-intelligence/trajectory-step.json",
  title: "SkillRunTrajectoryStep",
  type: "object",
  required: ["kind", "content"],
  properties: {
    kind: { enum: ["message", "tool-call", "tool-result", "reasoning-summary", "event"] },
    name: { type: "string", maxLength: 120 },
    content: { type: "string", maxLength: 20000 },
    at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const;

export const skillRunEventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/skill-intelligence/run-event.json",
  title: "SkillRunIngestRequest",
  description: "POST /api/skill-runs (single) or { runs: [...] } (batch ≤ 100). Stored at the lower of telemetryLevel and the tenant capture mode; all text is redacted before persistence.",
  type: "object",
  required: ["runId", "skillId", "skillVersionId", "connectorId", "runtime", "telemetryLevel", "startedAt"],
  properties: {
    runId: { type: "string", maxLength: 200 },
    skillId: { type: "string", maxLength: 200 },
    skillVersionId: { type: "string", maxLength: 200 },
    connectorId: { type: "string", maxLength: 200 },
    runtime: { enum: RUNTIMES },
    model: { type: "string", maxLength: 160 },
    startedAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time" },
    telemetryLevel: { enum: ["full", "io", "outcome"] },
    success: { type: "boolean" },
    latencyMs: { type: "integer", minimum: 0 },
    inputTokens: { type: "integer", minimum: 0 },
    outputTokens: { type: "integer", minimum: 0 },
    estimatedCost: { type: "number", minimum: 0 },
    taskArchetype: { type: "string", maxLength: 80 },
    inputStructure: { enum: ["structured", "unstructured"] },
    businessUnit: { type: "string", maxLength: 80 },
    userRef: { type: "string", maxLength: 200, description: "Pseudonymized unless the tenant retains raw identity." },
    groupIds: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 50 },
    input: { type: "string", maxLength: 200000 },
    output: { type: "string", maxLength: 200000 },
    trajectory: { type: "array", items: { $ref: "trajectory-step.json" }, maxItems: 500 },
    feedback: {
      type: "object",
      properties: {
        accepted: { type: "boolean" },
        rating: { type: "integer", minimum: 1, maximum: 5 },
        revisionRequired: { type: "boolean" },
        editDistance: { type: "number", minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
  },
} as const;

export const skillFeedbackSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/skill-intelligence/feedback.json",
  title: "SkillFeedbackRequest",
  description: "POST /api/skill-runs/{runId}/feedback. Raw events are stored; weak-label scores are derived and versioned separately.",
  type: "object",
  required: ["kind"],
  properties: {
    kind: { enum: ["passive", "explicit"] },
    signal: {
      enum: [
        "accepted-untouched", "accepted-after-edit", "discarded", "regenerated", "retried",
        "alternate-skill-selected", "human-override", "copied", "exported",
        "downstream-completed", "downstream-failed",
      ],
    },
    categories: {
      type: "array",
      items: {
        enum: [
          "good-result", "bad-result", "missing-knowledge", "incorrect-procedure", "too-verbose",
          "insufficient-detail", "obsolete-information", "format-failure", "tool-use-failure",
          "unsafe-recommendation", "should-have-done",
        ],
      },
    },
    rating: { type: "integer", minimum: 1, maximum: 5 },
    editRatio: { type: "number", minimum: 0, maximum: 1 },
    comment: { type: "string", maxLength: 2000 },
    reporterRole: { enum: ["user", "sme", "system"] },
    rubricDimension: { type: "string", maxLength: 120 },
  },
  allOf: [
    { if: { properties: { kind: { const: "passive" } } }, then: { required: ["signal"] } },
    { if: { properties: { kind: { const: "explicit" } } }, then: { anyOf: [{ required: ["categories"] }, { required: ["rating"] }] } },
  ],
} as const;

export const optimizationRunSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/skill-intelligence/optimization-run.json",
  title: "OptimizationJobResult",
  description: "Worker → POST /api/internal/optimization-jobs/{jobId}/result. The control plane re-derives edits and recomputes the gate from these raw paired results.",
  type: "object",
  required: ["schemaVersion", "jobId", "leaseToken", "status"],
  properties: {
    schemaVersion: { const: 1 },
    jobId: { type: "string" },
    leaseToken: { type: "string" },
    status: { enum: ["completed", "failed"] },
    error: { type: "string", maxLength: 1000 },
    candidateContent: { type: "string" },
    editRationales: {
      type: "array",
      items: { type: "object", required: ["baseStart", "rationale"], properties: { baseStart: { type: "integer", minimum: 0 }, rationale: { type: "string" } } },
    },
    inferredPattern: { type: "string" },
    cases: {
      type: "array",
      items: {
        type: "object",
        required: ["caseId", "partition", "baseline", "candidate"],
        properties: {
          caseId: { type: "string" },
          partition: { enum: ["validation", "regression", "holdout"] },
          runtime: { enum: RUNTIMES },
          baseline: { type: "number" },
          candidate: { type: "number" },
          dimensions: {
            type: "object",
            additionalProperties: {
              type: "object",
              required: ["baseline", "candidate"],
              properties: { baseline: { type: "number" }, candidate: { type: "number" } },
            },
          },
          baselineLatencyMs: { type: "number" },
          candidateLatencyMs: { type: "number" },
          baselineCost: { type: "number" },
          candidateCost: { type: "number" },
        },
      },
    },
    datasets: {
      type: "array",
      items: {
        type: "object",
        required: ["partition", "caseCount", "runIds", "datasetHash"],
        properties: {
          partition: { enum: ["train", "validation", "regression", "holdout"] },
          caseCount: { type: "integer" },
          runIds: { type: "array", items: { type: "string" } },
          datasetHash: { type: "string" },
          curationSummary: { type: "object", additionalProperties: { type: "integer" } },
        },
      },
    },
    provenance: {
      type: "object",
      required: ["engine", "engineDisplayName", "version", "optimizerModel", "optimizerBackend", "configHash"],
      properties: {
        engine: { const: "skillopt" },
        engineDisplayName: { type: "string" },
        version: { type: "string" },
        sourceCommit: { type: ["string", "null"] },
        optimizerModel: { type: "string" },
        optimizerBackend: { type: "string" },
        configHash: { type: "string" },
      },
    },
  },
} as const;

export const recommendationReviewSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/skill-intelligence/recommendation-review.json",
  title: "RecommendationReviewRequest",
  description: "POST /api/improvements/{id}/review. Modification voids approvals and forces re-evaluation; rejection requires structured reasons.",
  type: "object",
  required: ["decision"],
  properties: {
    decision: { enum: ["approve", "reject", "modify", "request-more-testing"] },
    reasons: {
      type: "array",
      items: {
        enum: [
          "recommendation-incorrect", "insufficient-evidence", "style-regression", "security-concern",
          "overfit", "duplicate-instruction", "violates-organizational-method",
          "good-idea-wrong-wording", "unnecessary-complexity",
        ],
      },
    },
    comment: { type: "string", maxLength: 4000 },
    editDecisions: { type: "object", additionalProperties: { enum: ["proposed", "accepted", "rejected"] } },
    candidateContent: { type: "string", maxLength: 200000 },
  },
  allOf: [{ if: { properties: { decision: { const: "reject" } } }, then: { required: ["reasons"] } }],
} as const;
