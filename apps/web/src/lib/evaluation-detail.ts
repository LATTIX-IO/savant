import {
  COMMENTS,
  EVAL_RUNS,
  RELEASES,
  SKILLS,
  type EvalRun,
  type Release,
  type Skill,
} from "./savant-data.ts";

export type EvaluationMetricUnit = "%" | "s" | "pts";
export type EvaluationMetricDirection = "up" | "down";
export type EvaluationClusterSeverity = "minor" | "moderate" | "critical";
export type EvaluationRecommendationCategory = "prompt" | "dataset" | "rubric" | "guardrail";
export type EvaluationRecommendationEffort = "low" | "medium" | "high";
export type EvaluationCustomTestStatus = "promising" | "watch" | "iterate";
export type BenchmarkMetricId = "quality" | "compliance" | "grounding" | "actionability" | "efficiency";

export interface EvaluationMetric {
  id: string;
  label: string;
  baseline: number;
  candidate: number;
  unit: EvaluationMetricUnit;
  direction: EvaluationMetricDirection;
  note: string;
}

export interface EvaluationMetricAlignment {
  metricId: BenchmarkMetricId;
  metricLabel: string;
  weight?: number;
  whatToMeasure: string;
  howToGrade: string[];
  improvementLevers: string[];
}

export interface EvaluationConfigEntry {
  id: string;
  key: string;
  value: string;
}

export interface EvaluationFailureCluster {
  id: string;
  label: string;
  severity: EvaluationClusterSeverity;
  cases: number;
  owner: string;
  summary: string;
  suggestedUpdate: string;
  examples: string[];
}

export interface EvaluationRecommendation {
  id: string;
  category: EvaluationRecommendationCategory;
  title: string;
  effort: EvaluationRecommendationEffort;
  impact: string;
  rationale: string;
  actions: string[];
}

export interface EvaluationCustomTestPreset {
  id: string;
  label: string;
  focus: string;
  datasetSlice: string;
  caseCount: number;
  judgeModel: string;
  notes: string;
}

export interface EvaluationCustomTestRequest {
  focus: string;
  datasetSlice: string;
  caseCount: number;
  judgeModel: string;
  includeEdgeCases: boolean;
  compareAgainstBaseline: boolean;
  notes: string;
}

export interface EvaluationCustomTestResult {
  passRate: number;
  score: number;
  delta: number;
  runtimeSeconds: number;
  status: EvaluationCustomTestStatus;
  headline: string;
  findings: string[];
  suggestedNextStep: string;
}

export interface EvaluationHistoricalRun {
  uuid: string;
  ref: string;
  dataset: string;
  started: string;
  duration: string;
  status: EvalRun["status"];
  failed: number;
  score: number;
  readOnly: boolean;
  newerPublishedRef: string | null;
}

export interface EvaluationRunDetail {
  uuid: string;
  run: EvalRun;
  skill: Skill;
  baselineRun: EvalRun | null;
  release: Release | null;
  headline: string;
  narrative: string;
  datasetDescription: string;
  executedBy: string;
  executionEnvironment: string;
  candidateModel: string;
  judgeModel: string;
  focus: string;
  readOnly: boolean;
  publishedRef: string | null;
  metrics: EvaluationMetric[];
  metricAlignment: EvaluationMetricAlignment[];
  failureClusters: EvaluationFailureCluster[];
  recommendations: EvaluationRecommendation[];
  customTestPresets: EvaluationCustomTestPreset[];
  reviewerNotes: Array<{ who: string; when: string; text: string }>;
  historicalRuns: EvaluationHistoricalRun[];
  comparableRuns: EvalRun[];
}

export const EVALUATION_ARTIFACT_PATHS = {
  dataset: "eval/dataset.yaml",
  rubric: "eval/rubric.yaml",
  baseline: "eval/baseline.json",
} as const;

export const EVALUATION_ARTIFACT_VERSIONS = {
  evalSet: "1.0.0",
  rubric: "1.0.0",
} as const;

export const EVALUATION_RUBRIC_DIMENSION_WEIGHTS: Record<BenchmarkMetricId, number> = {
  quality: 0.3,
  compliance: 0.2,
  grounding: 0.15,
  actionability: 0.2,
  efficiency: 0.15,
};

export const EVALUATION_RUBRIC_THRESHOLDS = {
  pass: 85,
  investigate: 70,
} as const;

export interface EvaluationRubricDimensionDefinition extends EvaluationMetricAlignment {
  weight: number;
}

export interface EvaluationDatasetArtifactFormat {
  path: string;
  evalSetVersion: string;
  sourceDataset: string;
  datasetSlice: string;
  sampleCount: number;
  includeEdgeCases: boolean;
  fields: EvaluationConfigEntry[];
  notes: string[];
}

export interface EvaluationRubricArtifactFormat {
  path: string;
  rubricVersion: string;
  judgeModel: string;
  runnerSettings: EvaluationConfigEntry[];
  thresholds: {
    pass: number;
    investigate: number;
  };
  dimensions: EvaluationRubricDimensionDefinition[];
}

export interface EvaluationBaselineArtifactFormat {
  path: string;
  skillId: string;
  skillVersion: string;
  runId: string;
  compareAgainstBaseline: boolean;
  baselineRef: string | null;
  publishedRef: string | null;
  notes: string[];
}

export interface EvaluationArtifactBundle {
  dataset: EvaluationDatasetArtifactFormat;
  rubric: EvaluationRubricArtifactFormat;
  baseline: EvaluationBaselineArtifactFormat;
}

type ThemeTemplate = {
  focus: string;
  datasetDescription: string;
  executedBy: string;
  executionEnvironment: string;
  candidateModel: string;
  judgeModel: string;
  failureTemplates: Array<{
    label: string;
    severity: EvaluationClusterSeverity;
    owner: string;
    summary: string;
    suggestedUpdate: string;
    examples: string[];
  }>;
  recommendations: Array<{
    category: EvaluationRecommendationCategory;
    title: string;
    effort: EvaluationRecommendationEffort;
    impact: string;
    rationale: string;
    actions: string[];
  }>;
  presets: EvaluationCustomTestPreset[];
};

const THEME_TEMPLATES: Record<string, ThemeTemplate> = {
  skl_ccr: {
    focus: "non-standard contract language and clause confidence",
    datasetDescription:
      "Enterprise contract corpora covering NDAs, MSAs, DPAs, procurement schedules, and negotiated carve-outs from the legal playbook.",
    executedBy: "legal-eval-runner",
    executionEnvironment: "tenant workspace · production evaluations",
    candidateModel: "workspace execution default · legal-analyst",
    judgeModel: "workspace judge default · contract-rubric",
    failureTemplates: [
      {
        label: "Mutual indemnity carve-outs",
        severity: "critical",
        owner: "Legal Ops",
        summary: "The candidate is still over-generalizing indemnity carve-outs when the counterparty uses mutual language with custom IP exceptions.",
        suggestedUpdate: "Split the indemnity parsing rule into vendor-biased and mutual-indemnity branches before risk scoring.",
        examples: [
          "Mutual NDA with non-standard indemnity cap",
          "SaaS MSA with IP infringement carve-out",
          "Supplier agreement with reciprocal indemnity language",
        ],
      },
      {
        label: "Auto-renewal clause tone",
        severity: "moderate",
        owner: "Prompt library",
        summary: "When renewal language is coupled with notice periods, the explanation becomes too confident and drops the deviation rationale.",
        suggestedUpdate: "Add a second-pass explanation scaffold for notice-period deltas before final recommendation generation.",
        examples: [
          "Vendor agreement with 60-day notice",
          "Auto-renewal clause nested in appendix",
        ],
      },
      {
        label: "Governing law edge cases",
        severity: "minor",
        owner: "Dataset maintainer",
        summary: "The model classifies unfamiliar governing-law combinations correctly less often than the baseline on low-frequency samples.",
        suggestedUpdate: "Increase sample density for multi-jurisdiction governing-law variants in the hard-case set.",
        examples: [
          "Delaware + England split venue",
          "Procurement agreement with state override language",
        ],
      },
    ],
    recommendations: [
      {
        category: "prompt",
        title: "Branch the clause-extraction prompt by agreement family",
        effort: "medium",
        impact: "Likely recovers 3 to 4 failing mutual-indemnity cases in the current run.",
        rationale: "The regressions cluster around the same contract families, which suggests prompt specialization is cheaper than a full rubric rewrite.",
        actions: [
          "Route NDAs and MSAs through separate extraction instructions.",
          "Require explicit mention of carve-outs before emitting a low-risk recommendation.",
          "Add a confidence note when the clause parser falls back to generalized language.",
        ],
      },
      {
        category: "dataset",
        title: "Create a regression slice for negotiated renewal terms",
        effort: "low",
        impact: "Turns the current renewal-language misses into a stable guardrail for future candidates.",
        rationale: "Two failing cases share the same renewal-pattern shape and are underrepresented in the active dataset.",
        actions: [
          "Extract 12 to 20 renewal-language edge cases from recent review history.",
          "Tag them as hard-mode samples in the contract-corpus suite.",
          "Pin them into the promotion gate for Tier 1 legal skills.",
        ],
      },
      {
        category: "guardrail",
        title: "Fail closed when clause confidence drops below the approval threshold",
        effort: "medium",
        impact: "Prevents low-confidence approvals from slipping into review queues during ambiguous clause matches.",
        rationale: "Several misses still produce polished summaries, which makes operator trust calibration harder.",
        actions: [
          "Expose clause-confidence in the output schema.",
          "Block auto-approve recommendations below the threshold.",
          "Surface the missing evidence span in reviewer-facing output.",
        ],
      },
    ],
    presets: [
      {
        id: "nda-edge",
        label: "NDA carve-out slice",
        focus: "Retest negotiated NDA indemnity carve-outs with stricter confidence gating.",
        datasetSlice: "nda-edge-cases",
        caseCount: 36,
        judgeModel: "strict rubric judge",
        notes: "Bias toward mutual-indemnity and renewal-term samples.",
      },
      {
        id: "governing-law",
        label: "Governing-law hard mode",
        focus: "Stress-test low-frequency governing-law combinations before promotion.",
        datasetSlice: "governing-law-hard-mode",
        caseCount: 28,
        judgeModel: "balanced rubric judge",
        notes: "Include negotiated venue + jurisdiction combinations.",
      },
      {
        id: "explanation-pass",
        label: "Reviewer explanation pass",
        focus: "Check whether explanation scaffolding improves reviewer trust on renewal clauses.",
        datasetSlice: "renewal-language-reviewer-pass",
        caseCount: 18,
        judgeModel: "balanced rubric judge",
        notes: "Score both classification accuracy and explanation quality.",
      },
    ],
  },
  skl_prs: {
    focus: "dependency note recall and rollout-risk coverage",
    datasetDescription:
      "Merged and in-flight pull request corpora with infra, app, dependency, and security-sensitive code changes from engineering teams.",
    executedBy: "developer-productivity-evals",
    executionEnvironment: "tenant workspace · production evaluations",
    candidateModel: "workspace execution default · code-review-assistant",
    judgeModel: "workspace judge default · pr-rubric",
    failureTemplates: [
      {
        label: "Hidden dependency upgrades",
        severity: "moderate",
        owner: "Prompt library",
        summary: "Large lockfile or indirect dependency changes are still undercalled when no application source files change nearby.",
        suggestedUpdate: "Require an explicit dependency-risk paragraph whenever package manifests or lockfiles change.",
        examples: [
          "Lockfile-only version bump",
          "Package manifest with peer dependency drift",
        ],
      },
      {
        label: "Rollback planning",
        severity: "minor",
        owner: "Rubric",
        summary: "The candidate misses rollback suggestions for medium-risk operational changes more often than the best historical run.",
        suggestedUpdate: "Increase rubric weight for rollback-plan coverage on infra and migration PRs.",
        examples: [
          "Database migration without rollback note",
          "Feature-flag removal PR",
        ],
      },
      {
        label: "Sensitive file emphasis",
        severity: "minor",
        owner: "Dataset maintainer",
        summary: "Mentions of auth, billing, or security files are correct but not consistently prioritized in the summary header.",
        suggestedUpdate: "Add more positive examples of sensitive-file summarization to the golden set.",
        examples: [
          "Auth middleware update",
          "Billing webhook change",
        ],
      },
    ],
    recommendations: [
      {
        category: "prompt",
        title: "Always emit a dependency-risk section when manifests change",
        effort: "low",
        impact: "Should tighten recall on the highest-volume miss without affecting narrative quality.",
        rationale: "The failures are format-consistent and show up even in otherwise strong summaries.",
        actions: [
          "Gate the summary template on package-file detection.",
          "Require risk language for indirect dependency movement.",
          "Mention affected services when lockfile changes are isolated.",
        ],
      },
      {
        category: "rubric",
        title: "Promote rollback coverage to a first-class reviewer check",
        effort: "medium",
        impact: "Improves reviewer confidence on migration and infra changes.",
        rationale: "The current rubric tolerates summaries that read well but omit the operational safety plan.",
        actions: [
          "Score rollback coverage separately from overall completeness.",
          "Add a penalty when deploy or migration steps lack mitigation notes.",
        ],
      },
      {
        category: "dataset",
        title: "Expand the sensitive-file benchmark",
        effort: "low",
        impact: "Makes high-risk file changes more salient in the first line of the summary.",
        rationale: "The misses are mostly ordering and salience problems rather than incorrect detection.",
        actions: [
          "Collect 15 recent auth and billing PRs.",
          "Label preferred summary ordering and reviewer callouts.",
          "Rerun the production-eval slice before release.",
        ],
      },
    ],
    presets: [
      {
        id: "deps-only",
        label: "Dependency-only PRs",
        focus: "Re-evaluate dependency-risk recall on lockfile-heavy PRs.",
        datasetSlice: "dependency-only-prs",
        caseCount: 42,
        judgeModel: "strict rubric judge",
        notes: "Bias toward lockfile and manifest-only diffs.",
      },
      {
        id: "infra-rollbacks",
        label: "Infra rollback coverage",
        focus: "Check rollback-plan completeness on migrations and deploy workflow changes.",
        datasetSlice: "infra-rollback-set",
        caseCount: 24,
        judgeModel: "balanced rubric judge",
        notes: "Review summaries that currently pass but feel thin for operators.",
      },
      {
        id: "security-files",
        label: "Sensitive file emphasis",
        focus: "Ensure security-relevant files are surfaced in the opening summary.",
        datasetSlice: "security-file-review",
        caseCount: 20,
        judgeModel: "balanced rubric judge",
        notes: "Prefer auth, billing, and secret-handling changes.",
      },
    ],
  },
  skl_itr: {
    focus: "latency control and concise on-call guidance",
    datasetDescription:
      "Incident timelines, alerts, runbook steps, and customer-status updates spanning SEV-1 to SEV-3 operational scenarios.",
    executedBy: "incident-eval-runner",
    executionEnvironment: "tenant workspace · production evaluations",
    candidateModel: "workspace execution default · incident-triage",
    judgeModel: "workspace judge default · incident-rubric",
    failureTemplates: [
      {
        label: "Latency bursts under alert fan-out",
        severity: "critical",
        owner: "Runtime",
        summary: "The run still breaches the latency budget when the alert fan-out introduces too many retrieval hops before triage output.",
        suggestedUpdate: "Short-circuit retrieval once the top incident class exceeds the confidence threshold.",
        examples: [
          "Multi-service SEV-2 page storm",
          "Database + queue cascading alert bundle",
        ],
      },
      {
        label: "Customer update tone",
        severity: "moderate",
        owner: "Prompt library",
        summary: "Customer-facing status updates remain accurate but drift toward internal phrasing when the runbook includes debug-only notes.",
        suggestedUpdate: "Split internal triage notes from customer messaging with separate response blocks.",
        examples: [
          "Public status update after rollback",
          "Incident update with unverified root cause",
        ],
      },
      {
        label: "Runbook step ordering",
        severity: "minor",
        owner: "Dataset maintainer",
        summary: "The agent sometimes suggests a sound step set in the wrong order for queue and cache incidents.",
        suggestedUpdate: "Add ordering-sensitive eval cases for queue saturation and cache poisoning scenarios.",
        examples: [
          "Cache flush before read-only failover",
          "Queue drain before ingress throttle",
        ],
      },
    ],
    recommendations: [
      {
        category: "guardrail",
        title: "Introduce a strict retrieval cap for SEV-2 and higher",
        effort: "medium",
        impact: "The biggest single lever for bringing runtime back under the operational budget.",
        rationale: "The run is currently bottlenecked by extra context gathering, not by the response generation itself.",
        actions: [
          "Cap retrieval breadth after the top incident class is identified.",
          "Prefer cached runbook embeddings for repeated incident families.",
          "Trigger a degraded-mode summary when latency budgets are exceeded.",
        ],
      },
      {
        category: "prompt",
        title: "Separate operator and customer response templates",
        effort: "low",
        impact: "Improves tone compliance without changing the incident classification logic.",
        rationale: "The customer update quality issues appear after the model mixes operator instructions into public output.",
        actions: [
          "Emit internal triage steps in a dedicated section.",
          "Hide speculative root causes from customer-facing language.",
          "Require plain-language status language in the external summary.",
        ],
      },
      {
        category: "dataset",
        title: "Add ordering-focused cache and queue incidents",
        effort: "low",
        impact: "Hardens the action ordering on the specific runbooks now slipping behind baseline.",
        rationale: "The misses are few but highly patterned, which makes them perfect for a regression slice.",
        actions: [
          "Build a 10-case ordering benchmark from recent incidents.",
          "Pin the benchmark into the promotion suite.",
          "Compare action ordering before and after retrieval cap changes.",
        ],
      },
    ],
    presets: [
      {
        id: "sev2-latency",
        label: "SEV-2 latency budget",
        focus: "Measure whether retrieval caps improve p95 latency on alert storms.",
        datasetSlice: "sev2-latency-storms",
        caseCount: 30,
        judgeModel: "strict rubric judge",
        notes: "Bias toward high fan-out alert bundles.",
      },
      {
        id: "customer-comms",
        label: "Customer comms isolation",
        focus: "Retest tone compliance when customer messaging is separated from triage notes.",
        datasetSlice: "customer-comms-incident-set",
        caseCount: 22,
        judgeModel: "balanced rubric judge",
        notes: "Score for clarity and speculation control.",
      },
      {
        id: "ordering-hard-mode",
        label: "Runbook ordering hard mode",
        focus: "Stress-test queue and cache incident ordering under compressed context.",
        datasetSlice: "ordering-hard-mode",
        caseCount: 18,
        judgeModel: "balanced rubric judge",
        notes: "Track step ordering independently from outcome correctness.",
      },
    ],
  },
  skl_rfp: {
    focus: "evidence citation coverage and answer consistency",
    datasetDescription:
      "RFP questionnaires, prior accepted bids, and security-answer libraries with commercial and compliance response sections.",
    executedBy: "sales-eval-runner",
    executionEnvironment: "tenant workspace · candidate evaluations",
    candidateModel: "workspace execution default · bid-drafter",
    judgeModel: "workspace judge default · rfp-rubric",
    failureTemplates: [
      {
        label: "Unsupported evidence claims",
        severity: "critical",
        owner: "Prompt library",
        summary: "The first-release baseline still invents supporting evidence when security answers are sparse or outdated.",
        suggestedUpdate: "Require a citation or fallback disclaimer for every compliance-heavy answer block.",
        examples: [
          "SOC 2 answer without evidence source",
          "Encryption response with stale control note",
        ],
      },
      {
        label: "Pricing assumption leakage",
        severity: "moderate",
        owner: "Guardrails",
        summary: "Commercial assumptions sometimes leak into non-pricing sections of the response package.",
        suggestedUpdate: "Block pricing placeholders outside the approved commercial section.",
        examples: [
          "Implementation fee mention in onboarding answer",
          "Seat-count assumption in compliance response",
        ],
      },
      {
        label: "Security answer consistency",
        severity: "moderate",
        owner: "Dataset maintainer",
        summary: "Repeated security answers vary too much across similar prompts, which hurts reviewer confidence.",
        suggestedUpdate: "Cluster semantically similar security prompts and align the preferred answer style.",
        examples: [
          "Encryption-at-rest wording drift",
          "Data retention answer inconsistency",
        ],
      },
    ],
    recommendations: [
      {
        category: "guardrail",
        title: "Require source-backed evidence blocks in every compliance answer",
        effort: "medium",
        impact: "Reduces the highest-risk failure before this skill ships its first production candidate.",
        rationale: "Unsupported evidence is the fastest way to lose trust in a new proposal-writing skill.",
        actions: [
          "Add a citation-or-disclaimer rule to the answer template.",
          "Reject final output when evidence spans are missing.",
          "Show missing-source warnings inline for reviewers.",
        ],
      },
      {
        category: "dataset",
        title: "Build a consistency pack for recurring security answers",
        effort: "low",
        impact: "Improves answer style consistency with minimal prompt churn.",
        rationale: "The candidate already knows the content; it mainly needs tighter examples for consistent phrasing.",
        actions: [
          "Collect the top 15 repeated security questions.",
          "Label preferred answers and evidence anchors.",
          "Pin the set into the first-release promotion suite.",
        ],
      },
      {
        category: "prompt",
        title: "Constrain pricing placeholders to the commercial section",
        effort: "low",
        impact: "Stops commercial leakage into technical and compliance answers.",
        rationale: "The issue appears only when the answer generator tries to be too helpful outside its section boundary.",
        actions: [
          "Reset section context when leaving commercial answers.",
          "Ban pricing tokens outside approved sections.",
        ],
      },
    ],
    presets: [
      {
        id: "evidence-hard-mode",
        label: "Evidence hard mode",
        focus: "Retest citation coverage on sparse security-answer prompts.",
        datasetSlice: "evidence-hard-mode",
        caseCount: 26,
        judgeModel: "strict rubric judge",
        notes: "Emphasize sparse or stale evidence packs.",
      },
      {
        id: "commercial-boundary",
        label: "Commercial boundary check",
        focus: "Ensure pricing assumptions do not leak into non-commercial sections.",
        datasetSlice: "commercial-boundary-set",
        caseCount: 16,
        judgeModel: "balanced rubric judge",
        notes: "Score for section boundary discipline.",
      },
      {
        id: "security-consistency",
        label: "Security consistency pack",
        focus: "Normalize repeated security answers before release candidate review.",
        datasetSlice: "security-answer-consistency",
        caseCount: 20,
        judgeModel: "balanced rubric judge",
        notes: "Compare consistency across semantically similar prompts.",
      },
    ],
  },
  skl_soc: {
    focus: "traceable citations and control mapping fidelity",
    datasetDescription:
      "Security evidence drafts, control-library mappings, and log excerpts used to assemble SOC 2 audit evidence.",
    executedBy: "compliance-eval-runner",
    executionEnvironment: "tenant workspace · production evaluations",
    candidateModel: "workspace execution default · evidence-drafter",
    judgeModel: "workspace judge default · control-rubric",
    failureTemplates: [
      {
        label: "Citation span selection",
        severity: "moderate",
        owner: "Prompt library",
        summary: "The candidate occasionally cites the right evidence source but highlights an incomplete or weak span for the control.",
        suggestedUpdate: "Bias extraction toward the smallest span that still proves the control assertion end to end.",
        examples: [
          "Access review evidence excerpt too narrow",
          "Retention log citation missing the confirming line",
        ],
      },
      {
        label: "Control mapping ambiguity",
        severity: "moderate",
        owner: "Rubric",
        summary: "Nearby controls with similar wording still bleed together in a handful of drafts.",
        suggestedUpdate: "Introduce disambiguation hints for overlapping control families in the mapping rubric.",
        examples: [
          "CC6.1 vs CC6.2 phrasing",
          "Monitoring control overlap",
        ],
      },
      {
        label: "Stale log windows",
        severity: "minor",
        owner: "Dataset maintainer",
        summary: "The run sometimes accepts evidence windows that are technically correct but outside the preferred audit recency band.",
        suggestedUpdate: "Add freshness labels to the training and eval evidence windows.",
        examples: [
          "Older than preferred review period",
          "Quarter-boundary audit evidence",
        ],
      },
    ],
    recommendations: [
      {
        category: "prompt",
        title: "Tighten evidence-span extraction rules",
        effort: "medium",
        impact: "Improves reviewer trust without changing the underlying evidence recall.",
        rationale: "The candidate finds the right artifacts but sometimes extracts too broad or too shallow a proof span.",
        actions: [
          "Ask for the minimum proving excerpt.",
          "Require a rationale sentence linking excerpt to control.",
          "Flag excerpts that lack explicit proof verbs or timestamps.",
        ],
      },
      {
        category: "rubric",
        title: "Separate overlapping control families in scoring",
        effort: "low",
        impact: "Makes ambiguous mappings easier to catch in review.",
        rationale: "Most misses cluster around known pairs of similarly worded controls.",
        actions: [
          "Add a disambiguation check for overlapping controls.",
          "Score ambiguity separately from citation quality.",
        ],
      },
      {
        category: "dataset",
        title: "Tag evidence freshness in the eval set",
        effort: "low",
        impact: "Keeps accepted drafts closer to the audit team’s preferred evidence window.",
        rationale: "Freshness is currently implicit, which makes the runner treat some stale evidence as fully acceptable.",
        actions: [
          "Label recency on all audit evidence fixtures.",
          "Pin a stale-window regression slice.",
        ],
      },
    ],
    presets: [
      {
        id: "citation-tightening",
        label: "Citation tightening pass",
        focus: "Retest whether evidence-span extraction improves reviewer confidence.",
        datasetSlice: "citation-tightening-pass",
        caseCount: 24,
        judgeModel: "balanced rubric judge",
        notes: "Score excerpt precision and rationale quality.",
      },
      {
        id: "control-overlap",
        label: "Control overlap check",
        focus: "Stress-test similar control families before promotion.",
        datasetSlice: "control-overlap-set",
        caseCount: 18,
        judgeModel: "strict rubric judge",
        notes: "Prefer ambiguous control pairs.",
      },
      {
        id: "freshness-band",
        label: "Freshness band audit",
        focus: "Check whether stale evidence windows are being over-accepted.",
        datasetSlice: "freshness-band-audit",
        caseCount: 14,
        judgeModel: "balanced rubric judge",
        notes: "Label preferred evidence recency explicitly.",
      },
    ],
  },
  skl_qer: {
    focus: "KPI attribution clarity and table normalization",
    datasetDescription:
      "Quarterly earnings call summaries, KPI dashboards, and management commentary used for internal investor-read prep.",
    executedBy: "finance-eval-runner",
    executionEnvironment: "tenant workspace · staging evaluations",
    candidateModel: "workspace execution default · finance-summarizer",
    judgeModel: "workspace judge default · earnings-rubric",
    failureTemplates: [
      {
        label: "KPI attribution drift",
        severity: "moderate",
        owner: "Prompt library",
        summary: "Narrative summaries sometimes attribute KPI changes to the wrong business driver when commentary is compressed.",
        suggestedUpdate: "Force KPI-to-driver alignment in a dedicated reasoning pass before the final summary.",
        examples: [
          "Revenue growth tied to wrong segment",
          "Margin change attributed to guidance instead of spend",
        ],
      },
      {
        label: "Table normalization",
        severity: "minor",
        owner: "Guardrails",
        summary: "Some tables still drift on column labels when imported from heterogeneous dashboard exports.",
        suggestedUpdate: "Normalize the finance-table schema before summary generation.",
        examples: [
          "Non-standard EBITDA label",
          "Mixed-quarter header naming",
        ],
      },
      {
        label: "Risk callout suppression",
        severity: "minor",
        owner: "Dataset maintainer",
        summary: "The candidate under-emphasizes downside commentary on otherwise strong quarters.",
        suggestedUpdate: "Expand the risk-callout benchmark with positive-quarter but cautious-guidance cases.",
        examples: [
          "Strong quarter, weak next-quarter guidance",
          "FX headwind buried in commentary",
        ],
      },
    ],
    recommendations: [
      {
        category: "prompt",
        title: "Add an explicit KPI-to-driver alignment pass",
        effort: "medium",
        impact: "Should improve the highest-value finance accuracy issue before promotion to production.",
        rationale: "The wrong-attribution cases are costly because they sound plausible in review.",
        actions: [
          "Extract KPI movements before narrative drafting.",
          "Require one causal driver per headline KPI.",
          "Flag ambiguous driver attribution for reviewer confirmation.",
        ],
      },
      {
        category: "guardrail",
        title: "Normalize imported tables into a single schema",
        effort: "low",
        impact: "Reduces formatting drift and downstream narrative confusion.",
        rationale: "The table issues are upstream and can be fixed before the summarizer even runs.",
        actions: [
          "Standardize quarter headers.",
          "Alias finance metric labels.",
          "Reject malformed tables before summary generation.",
        ],
      },
      {
        category: "dataset",
        title: "Build a positive-quarter risk slice",
        effort: "low",
        impact: "Improves how the candidate surfaces cautious guidance and buried risk notes.",
        rationale: "The current dataset over-represents obviously bad quarters, not subtle downside risk.",
        actions: [
          "Collect 10 quarters with mixed signals.",
          "Label preferred treatment of cautious guidance.",
        ],
      },
    ],
    presets: [
      {
        id: "kpi-driver",
        label: "KPI driver alignment",
        focus: "Retest KPI attribution after splitting extraction from narrative drafting.",
        datasetSlice: "kpi-driver-alignment",
        caseCount: 22,
        judgeModel: "strict rubric judge",
        notes: "Prioritize mixed-signal earnings calls.",
      },
      {
        id: "table-normalization",
        label: "Table normalization",
        focus: "Check whether schema normalization removes header drift in generated summaries.",
        datasetSlice: "table-normalization-pass",
        caseCount: 18,
        judgeModel: "balanced rubric judge",
        notes: "Use heterogeneous dashboard exports.",
      },
      {
        id: "guidance-risk",
        label: "Guidance risk callouts",
        focus: "Increase emphasis on downside guidance in otherwise strong quarters.",
        datasetSlice: "guidance-risk-set",
        caseCount: 16,
        judgeModel: "balanced rubric judge",
        notes: "Score headline salience and risk placement.",
      },
    ],
  },
  skl_erfc: {
    focus: "risk-section completeness and rollout planning",
    datasetDescription:
      "Engineering RFCs, launch plans, dependency notes, and rollout artifacts reviewed before major system changes.",
    executedBy: "engineering-eval-runner",
    executionEnvironment: "tenant workspace · production evaluations",
    candidateModel: "workspace execution default · rfc-reviewer",
    judgeModel: "workspace judge default · architecture-rubric",
    failureTemplates: [
      {
        label: "Rollback-plan omissions",
        severity: "moderate",
        owner: "Rubric",
        summary: "The candidate still passes some RFCs that lack an explicit rollback path for risky migrations or flag flips.",
        suggestedUpdate: "Add a hard penalty when rollout sections omit rollback or abort criteria.",
        examples: [
          "Schema migration without fallback",
          "Traffic shift plan without abort threshold",
        ],
      },
      {
        label: "Dependency surfacing",
        severity: "minor",
        owner: "Prompt library",
        summary: "Hidden service dependencies are not always mentioned in the opening risk summary.",
        suggestedUpdate: "Force a dependency callout block before the recommendations section.",
        examples: [
          "Shared auth service dependency",
          "Cross-team storage dependency",
        ],
      },
      {
        label: "Success-metric clarity",
        severity: "minor",
        owner: "Dataset maintainer",
        summary: "RFCs with ambiguous success metrics still sometimes pass without a strong reviewer nudge.",
        suggestedUpdate: "Expand the eval set with success-metric ambiguity cases.",
        examples: [
          "Launch metric missing threshold",
          "Performance goal without baseline",
        ],
      },
    ],
    recommendations: [
      {
        category: "rubric",
        title: "Make rollback coverage a blocking review dimension",
        effort: "medium",
        impact: "Improves operational safety on the exact RFCs that are hardest to review manually.",
        rationale: "The current model understands rollback concepts, but the scorer does not punish omissions strongly enough.",
        actions: [
          "Separate rollback quality from general completeness.",
          "Require abort criteria for high-risk launches.",
          "Pin rollback misses into the promotion gate.",
        ],
      },
      {
        category: "prompt",
        title: "Surface hidden dependencies in the summary header",
        effort: "low",
        impact: "Makes cross-team risk more visible to reviewers immediately.",
        rationale: "The model already mentions dependencies later in the review; it just needs stronger prioritization.",
        actions: [
          "Add a dependency summary block.",
          "Promote external system dependencies above nice-to-have commentary.",
        ],
      },
      {
        category: "dataset",
        title: "Add ambiguous success-metric cases",
        effort: "low",
        impact: "Improves reviewer nudges when RFC measurement plans are too vague.",
        rationale: "The candidate is slightly too tolerant of soft success criteria.",
        actions: [
          "Label vague success metrics from recent RFC reviews.",
          "Score for threshold clarity and observability ownership.",
        ],
      },
    ],
    presets: [
      {
        id: "rollback-blockers",
        label: "Rollback blocker review",
        focus: "Re-evaluate rollback coverage on risky launches and migrations.",
        datasetSlice: "rollback-blocker-review",
        caseCount: 20,
        judgeModel: "strict rubric judge",
        notes: "Prefer launch plans with migrations or flag flips.",
      },
      {
        id: "dependency-summary",
        label: "Dependency summary pass",
        focus: "Check if hidden dependencies are promoted into the opening summary.",
        datasetSlice: "dependency-summary-pass",
        caseCount: 16,
        judgeModel: "balanced rubric judge",
        notes: "Use RFCs with cross-team dependencies.",
      },
      {
        id: "success-metrics",
        label: "Success metric clarity",
        focus: "Retest ambiguous launch metrics before the next production promotion.",
        datasetSlice: "success-metric-clarity",
        caseCount: 14,
        judgeModel: "balanced rubric judge",
        notes: "Score threshold clarity and ownership.",
      },
    ],
  },
  skl_cet: {
    focus: "tone calibration and escalation triggers",
    datasetDescription:
      "Customer email drafts, escalation histories, and policy examples for clarity, empathy, and promise-control checks.",
    executedBy: "customer-experience-evals",
    executionEnvironment: "tenant workspace · production evaluations",
    candidateModel: "workspace execution default · tone-pass",
    judgeModel: "workspace judge default · tone-rubric",
    failureTemplates: [
      {
        label: "Empathy calibration",
        severity: "moderate",
        owner: "Prompt library",
        summary: "The candidate still occasionally sounds too terse on frustrated-customer scenarios that need warmer acknowledgment language.",
        suggestedUpdate: "Add scenario-specific empathy scaffolds for escalated conversations.",
        examples: [
          "Delayed refund apology",
          "Repeated outage follow-up",
        ],
      },
      {
        label: "Escalation triggers",
        severity: "moderate",
        owner: "Guardrails",
        summary: "Some messages should escalate sooner when legal or security-sensitive promises appear in the draft.",
        suggestedUpdate: "Introduce a no-promise guardrail that forces escalation on policy-sensitive commitments.",
        examples: [
          "Compensation promise without approval",
          "Security assurance beyond policy",
        ],
      },
      {
        label: "Closing clarity",
        severity: "minor",
        owner: "Dataset maintainer",
        summary: "Action-oriented closing lines vary too much across similar support scenarios.",
        suggestedUpdate: "Expand the benchmark with preferred close styles for escalation vs resolution paths.",
        examples: [
          "Escalation close",
          "Resolved issue confirmation",
        ],
      },
    ],
    recommendations: [
      {
        category: "prompt",
        title: "Add escalation-specific empathy templates",
        effort: "low",
        impact: "Should recover the highest-signal tone misses quickly.",
        rationale: "The failures are concentrated in frustrated-customer cases with clear emotional cues.",
        actions: [
          "Separate apology language from resolution steps.",
          "Require acknowledgment before action items in escalations.",
        ],
      },
      {
        category: "guardrail",
        title: "Force review when unsupported promises appear",
        effort: "medium",
        impact: "Prevents a small number of high-risk customer emails from reaching agents unchecked.",
        rationale: "The most serious errors are policy-related promises, not general tone drift.",
        actions: [
          "Detect unsupported compensation or security promises.",
          "Escalate to human review automatically.",
          "Block send-ready output until reviewed.",
        ],
      },
      {
        category: "dataset",
        title: "Standardize closing-line examples",
        effort: "low",
        impact: "Improves consistency across support outcomes and reviewer expectations.",
        rationale: "The candidate is directionally correct but inconsistent in how it closes the loop.",
        actions: [
          "Cluster successful closing examples.",
          "Score closing clarity separately from empathy.",
        ],
      },
    ],
    presets: [
      {
        id: "frustrated-customers",
        label: "Frustrated customer set",
        focus: "Retest empathy calibration on escalated customer emails.",
        datasetSlice: "frustrated-customer-set",
        caseCount: 32,
        judgeModel: "balanced rubric judge",
        notes: "Bias toward repeated-contact scenarios.",
      },
      {
        id: "promise-guardrails",
        label: "Promise guardrails",
        focus: "Check whether unsupported promises trigger escalation consistently.",
        datasetSlice: "promise-guardrail-set",
        caseCount: 18,
        judgeModel: "strict rubric judge",
        notes: "Prefer policy-sensitive compensation and security language.",
      },
      {
        id: "closing-lines",
        label: "Closing line consistency",
        focus: "Normalize closing-line quality across escalated and resolved threads.",
        datasetSlice: "closing-line-consistency",
        caseCount: 20,
        judgeModel: "balanced rubric judge",
        notes: "Score action clarity and next-step confidence.",
      },
    ],
  },
  skl_von: {
    focus: "DPA annex recall and renewal-risk framing",
    datasetDescription:
      "Vendor onboarding memos, procurement questionnaires, DPA clauses, and renewal summaries used in procurement reviews.",
    executedBy: "procurement-eval-runner",
    executionEnvironment: "tenant workspace · draft evaluations",
    candidateModel: "workspace execution default · onboarding-memo",
    judgeModel: "workspace judge default · procurement-rubric",
    failureTemplates: [
      {
        label: "DPA annex omissions",
        severity: "critical",
        owner: "Prompt library",
        summary: "The candidate still misses annex or appendix references when they are separated from the main DPA summary block.",
        suggestedUpdate: "Force appendix scanning before final privacy-risk scoring.",
        examples: [
          "Schedule 3 subprocessors omitted",
          "Appendix security measure reference dropped",
        ],
      },
      {
        label: "Renewal-risk framing",
        severity: "moderate",
        owner: "Dataset maintainer",
        summary: "Renewal timing and termination risk are present but not emphasized enough in the executive summary.",
        suggestedUpdate: "Add examples where renewal-risk prominence is the primary reviewer concern.",
        examples: [
          "Auto-renewal with short notice window",
          "Termination fee buried in appendix",
        ],
      },
      {
        label: "Security questionnaire carryover",
        severity: "moderate",
        owner: "Guardrails",
        summary: "Security questionnaire answers are sometimes carried into memo sections that should stay procurement-focused.",
        suggestedUpdate: "Separate questionnaire synthesis from memo summary generation.",
        examples: [
          "Security answer pasted into commercial memo",
          "Questionnaire-specific jargon in executive summary",
        ],
      },
    ],
    recommendations: [
      {
        category: "prompt",
        title: "Scan appendices before privacy and onboarding scoring",
        effort: "medium",
        impact: "Addresses the most severe omission in the current draft skill.",
        rationale: "The candidate is reading the core agreement well but not the attached schedules that change the risk profile.",
        actions: [
          "Add an appendix scan step.",
          "Require annex confirmation before final DPA summary.",
          "Surface missing appendix warnings to reviewers.",
        ],
      },
      {
        category: "dataset",
        title: "Promote renewal-risk examples into the benchmark",
        effort: "low",
        impact: "Improves executive-summary emphasis where procurement reviewers care most.",
        rationale: "The misses are mostly prioritization problems, not raw extraction failures.",
        actions: [
          "Collect vendor memos with renewal or termination surprises.",
          "Label expected summary prominence.",
        ],
      },
      {
        category: "guardrail",
        title: "Keep questionnaire synthesis out of executive memo output",
        effort: "low",
        impact: "Reduces jargon bleed and keeps memo structure cleaner for procurement stakeholders.",
        rationale: "The skill is mixing two adjacent tasks that need different output voices.",
        actions: [
          "Generate questionnaire notes separately.",
          "Pass only memo-approved findings into the executive summary.",
        ],
      },
    ],
    presets: [
      {
        id: "appendix-scan",
        label: "Appendix scan pass",
        focus: "Retest whether annex scanning fixes DPA appendix omissions.",
        datasetSlice: "appendix-scan-pass",
        caseCount: 18,
        judgeModel: "strict rubric judge",
        notes: "Prefer DPAs with separated schedules.",
      },
      {
        id: "renewal-risk",
        label: "Renewal risk prominence",
        focus: "Measure whether renewal risks move higher in the executive summary.",
        datasetSlice: "renewal-risk-priority",
        caseCount: 16,
        judgeModel: "balanced rubric judge",
        notes: "Score summary prominence and actionability.",
      },
      {
        id: "questionnaire-boundary",
        label: "Questionnaire boundary",
        focus: "Ensure questionnaire jargon stays out of memo-ready summaries.",
        datasetSlice: "questionnaire-boundary-set",
        caseCount: 14,
        judgeModel: "balanced rubric judge",
        notes: "Track jargon bleed and executive-summary clarity.",
      },
    ],
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function percentage(part: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return round((part / total) * 100);
}

function parseDurationSeconds(duration: string) {
  const match = duration.match(/(\d+(?:\.\d+)?)\s*s/i);
  return match ? Number.parseFloat(match[1] ?? "0") : 0;
}

function findSkillForRun(run: EvalRun): Skill | null {
  return SKILLS.find((skill) => skill.name === run.skill) ?? null;
}

function findBaselineRun(run: EvalRun): EvalRun | null {
  const runIndex = EVAL_RUNS.findIndex((candidate) => candidate.id === run.id);

  if (runIndex < 0) {
    return null;
  }

  const olderRuns = EVAL_RUNS.slice(runIndex + 1)
    .filter((candidate) => candidate.skill === run.skill && candidate.status !== "running");

  return olderRuns.find((candidate) => candidate.dataset === run.dataset)
    ?? olderRuns[0]
    ?? null;
}

function getTheme(skill: Skill): ThemeTemplate {
  return THEME_TEMPLATES[skill.id] ?? {
    focus: `${skill.team.toLowerCase()} evaluation quality`,
    datasetDescription: `Curated ${skill.team.toLowerCase()} fixtures used to compare candidate and baseline behavior for ${skill.name}.`,
    executedBy: "workspace-eval-runner",
    executionEnvironment: "tenant workspace · production evaluations",
    candidateModel: "workspace execution default",
    judgeModel: "workspace judge default",
    failureTemplates: [
      {
        label: "Primary regression cluster",
        severity: "moderate",
        owner: skill.team,
        summary: `The candidate regressed on a small but coherent slice of ${skill.team.toLowerCase()} cases.`,
        suggestedUpdate: "Add a focused hard-case regression slice before the next candidate is promoted.",
        examples: ["Regression slice case 1", "Regression slice case 2"],
      },
      {
        label: "Formatting consistency",
        severity: "minor",
        owner: "Prompt library",
        summary: "Output formatting remains directionally correct but drifts on edge cases.",
        suggestedUpdate: "Stabilize output shape with stronger formatting instructions.",
        examples: ["Schema edge case", "Reviewer formatting expectation"],
      },
      {
        label: "Reviewer confidence",
        severity: "minor",
        owner: "Dataset maintainer",
        summary: "The candidate would benefit from a reviewer-confidence regression slice.",
        suggestedUpdate: "Expand the benchmark with examples that are correct but hard to trust at a glance.",
        examples: ["Low-confidence correct answer", "Hard-to-review answer"],
      },
    ],
    recommendations: [
      {
        category: "dataset",
        title: "Add a targeted regression slice",
        effort: "low",
        impact: "Provides a stable gate for the current miss pattern.",
        rationale: "The failures are patterned enough to benefit from a focused benchmark.",
        actions: ["Collect representative failing cases.", "Pin them into the promotion suite."],
      },
      {
        category: "prompt",
        title: "Tighten the review prompt",
        effort: "medium",
        impact: "Improves consistency without rewriting the skill from scratch.",
        rationale: "The skill is usually correct but under-specified on edge cases.",
        actions: ["Clarify expected output priorities.", "Bias toward reviewer-visible evidence."],
      },
      {
        category: "guardrail",
        title: "Fail closed on low-confidence outputs",
        effort: "medium",
        impact: "Prevents uncertain candidate behavior from looking fully approved.",
        rationale: "A little caution goes a long way when trust is part of the product.",
        actions: ["Expose confidence.", "Escalate low-confidence results for review."],
      },
    ],
    presets: [
      {
        id: "focused-regression",
        label: "Focused regression slice",
        focus: `Retest the current ${skill.team.toLowerCase()} regressions on a narrow benchmark.`,
        datasetSlice: "focused-regression-slice",
        caseCount: 20,
        judgeModel: "balanced rubric judge",
        notes: "Prefer hard cases from the latest candidate run.",
      },
      {
        id: "hard-mode",
        label: "Hard mode",
        focus: `Stress-test ${skill.name} on edge cases before promotion.`,
        datasetSlice: "hard-mode-set",
        caseCount: 16,
        judgeModel: "strict rubric judge",
        notes: "Bias toward the riskiest reviewer scenarios.",
      },
      {
        id: "reviewer-confidence",
        label: "Reviewer confidence pass",
        focus: "Measure whether updates improve trust and explanation quality.",
        datasetSlice: "reviewer-confidence-pass",
        caseCount: 12,
        judgeModel: "balanced rubric judge",
        notes: "Track explanation strength and confidence calibration.",
      },
    ],
  };
}

function distributeCounts(total: number, count: number) {
  if (count <= 0) {
    return [];
  }

  const base = Math.max(1, Math.floor(total / count));
  let remaining = Math.max(total, count);

  return Array.from({ length: count }, (_, index) => {
    const slotsLeft = count - index;
    const next = index === count - 1 ? remaining : Math.max(1, Math.min(base + (index === 0 ? 1 : 0), remaining - (slotsLeft - 1)));
    remaining -= next;
    return next;
  });
}

function deriveOverallScores(run: EvalRun, skill: Skill, baselineRun: EvalRun | null) {
  const baselinePassRate = baselineRun ? percentage(baselineRun.passed, baselineRun.cases) : null;
  const seededBaseline = skill.score ?? baselinePassRate ?? Math.max(70, percentage(run.passed, run.cases) - 4);
  const baseline = round(seededBaseline);

  if (run.delta == null) {
    return {
      baseline,
      candidate: round(Math.max(baseline, percentage(run.passed, run.cases) - run.failed / 4)),
    };
  }

  return {
    baseline,
    candidate: round(clamp(baseline + run.delta, 50, 99)),
  };
}

type BenchmarkMetricSnapshot = Record<BenchmarkMetricId, number>;

const BENCHMARK_METRICS: Array<{
  id: BenchmarkMetricId;
  label: string;
  note: string;
}> = [
  {
    id: "quality",
    label: "Quality",
    note: "Overall rubric quality for this benchmark run.",
  },
  {
    id: "compliance",
    label: "Compliance",
    note: "How consistently the skill stays inside the benchmark’s required policy and format boundaries.",
  },
  {
    id: "grounding",
    label: "Grounding",
    note: "Evidence fidelity, citation discipline, and source-backed reasoning on the active dataset.",
  },
  {
    id: "actionability",
    label: "Actionability",
    note: "Whether reviewers would feel comfortable acting on this output without extra cleanup.",
  },
  {
    id: "efficiency",
    label: "Efficiency",
    note: "Benchmark efficiency balances runtime, failure concentration, and release-readiness pressure.",
  },
];

function buildBenchmarkMetricSnapshot(
  run: EvalRun,
  skill: Skill,
  theme: ThemeTemplate,
  baselineRun: EvalRun | null,
): BenchmarkMetricSnapshot {
  const passRate = percentage(run.passed, run.cases);
  const overall = deriveOverallScores(run, skill, baselineRun).candidate;
  const runtimeSeconds = parseDurationSeconds(run.duration);
  const focusBoost = keywordBoost(theme.focus) * 0.65;
  const tierGuard = skill.tier === 1 ? 1.8 : skill.tier === 2 ? 1.1 : 0.5;
  const recommendationBoost = Math.min(1.4, theme.recommendations.length * 0.35);
  const regressionPenalty = run.status === "complete-with-regressions" ? 1.7 : 0;
  const runningPenalty = run.status === "running" ? 1.1 : 0;

  return {
    quality: round(clamp(overall - regressionPenalty + recommendationBoost, 55, 99)),
    compliance: round(clamp(passRate - run.failed * 0.5 - tierGuard - regressionPenalty + 1.8, 50, 99)),
    grounding: round(clamp(passRate - run.failed * 0.35 + focusBoost + 0.9, 50, 99)),
    actionability: round(clamp(overall - run.failed * 0.25 + focusBoost + recommendationBoost - runningPenalty + 0.6, 52, 99)),
    efficiency: round(clamp(100 - runtimeSeconds * 0.7 - run.failed * 0.25 - runningPenalty * 3 + 1.2, 45, 99)),
  };
}

function buildFallbackPreviousSnapshot(snapshot: BenchmarkMetricSnapshot, run: EvalRun): BenchmarkMetricSnapshot {
  const fallbackDelta = Math.max(0.8, Math.abs(run.delta ?? 0) + 0.4);

  return {
    quality: round(clamp(snapshot.quality - fallbackDelta, 45, 99)),
    compliance: round(clamp(snapshot.compliance - fallbackDelta * 1.2, 45, 99)),
    grounding: round(clamp(snapshot.grounding - fallbackDelta, 45, 99)),
    actionability: round(clamp(snapshot.actionability - fallbackDelta * 0.9, 45, 99)),
    efficiency: round(clamp(snapshot.efficiency - fallbackDelta * 0.8, 45, 99)),
  };
}

function buildMetrics(
  run: EvalRun,
  skill: Skill,
  baselineRun: EvalRun | null,
  theme: ThemeTemplate,
): EvaluationMetric[] {
  const currentSnapshot = buildBenchmarkMetricSnapshot(run, skill, theme, baselineRun);
  const previousSnapshot = baselineRun
    ? buildBenchmarkMetricSnapshot(baselineRun, skill, theme, findBaselineRun(baselineRun))
    : buildFallbackPreviousSnapshot(currentSnapshot, run);

  return BENCHMARK_METRICS.map((metric) => ({
    id: metric.id,
    label: metric.label,
    baseline: previousSnapshot[metric.id],
    candidate: currentSnapshot[metric.id],
    unit: "pts",
    direction: "up",
    note: metric.note,
  }));
}

function buildBenchmarkScore(metrics: EvaluationMetric[]) {
  if (metrics.length === 0) {
    return 0;
  }

  return round(metrics.reduce((total, metric) => total + metric.candidate, 0) / metrics.length);
}

function buildMetricAlignment(
  skill: Skill,
  theme: ThemeTemplate,
  recommendations: EvaluationRecommendation[],
): EvaluationMetricAlignment[] {
  const topPromptRecommendation = recommendations.find((recommendation) => recommendation.category === "prompt")?.title
    ?? "tighten prompt structure for edge cases";
  const topDatasetRecommendation = recommendations.find((recommendation) => recommendation.category === "dataset")?.title
    ?? "expand the benchmark dataset for weak slices";
  const topGuardrailRecommendation = recommendations.find((recommendation) => recommendation.category === "guardrail")?.title
    ?? "add a fail-closed guardrail for low-confidence outcomes";
  const topRubricRecommendation = recommendations.find((recommendation) => recommendation.category === "rubric")?.title
    ?? "clarify rubric thresholds for reviewer consistency";

  return [
    {
      metricId: "quality",
      metricLabel: "Quality",
      weight: EVALUATION_RUBRIC_DIMENSION_WEIGHTS.quality,
      whatToMeasure: `How accurately ${skill.name} handles ${theme.focus} with complete, decision-ready output.`,
      howToGrade: [
        "Score highest when answers are correct, complete, and need no reviewer rewrites.",
        "Downgrade when material facts, constraints, or caveats are missing.",
        "Map reviewer rubric scores into 0-100 benchmark points for comparison deltas.",
      ],
      improvementLevers: [
        `Prompt lever: ${topPromptRecommendation}.`,
        `Dataset lever: ${topDatasetRecommendation}.`,
      ],
    },
    {
      metricId: "compliance",
      metricLabel: "Compliance",
      weight: EVALUATION_RUBRIC_DIMENSION_WEIGHTS.compliance,
      whatToMeasure: `Whether ${skill.name} stays within policy, format, and governance boundaries for this benchmark.`,
      howToGrade: [
        "Score highest when policy and formatting requirements are fully satisfied.",
        "Apply strong penalties to unsupported claims, risky promises, or schema violations.",
        "Use fail-closed grading on ambiguous policy outcomes.",
      ],
      improvementLevers: [
        `Guardrail lever: ${topGuardrailRecommendation}.`,
        "Elevate policy-sensitive failures into blocking regression checks.",
      ],
    },
    {
      metricId: "grounding",
      metricLabel: "Grounding",
      weight: EVALUATION_RUBRIC_DIMENSION_WEIGHTS.grounding,
      whatToMeasure: `How well ${skill.name} ties responses to concrete benchmark evidence and traceable reasoning.`,
      howToGrade: [
        "Score highest when outputs cite relevant evidence and maintain source fidelity.",
        "Reduce score when evidence spans are weak, stale, or inferred without support.",
        "Require transparent confidence when direct evidence is missing.",
      ],
      improvementLevers: [
        `Rubric lever: ${topRubricRecommendation}.`,
        "Strengthen evidence extraction and reviewer-visible rationale scaffolding.",
      ],
    },
    {
      metricId: "actionability",
      metricLabel: "Actionability",
      weight: EVALUATION_RUBRIC_DIMENSION_WEIGHTS.actionability,
      whatToMeasure: `Whether reviewers can confidently act on ${skill.name} outputs without additional interpretation.`,
      howToGrade: [
        "Score highest when recommendations are clear, prioritized, and execution-ready.",
        "Downgrade when guidance is vague, unprioritized, or missing next steps.",
        "Reward stable decision framing across common and edge-case prompts.",
      ],
      improvementLevers: [
        `Prompt lever: ${topPromptRecommendation}.`,
        "Convert frequent reviewer edits into explicit output-shape constraints.",
      ],
    },
    {
      metricId: "efficiency",
      metricLabel: "Efficiency",
      weight: EVALUATION_RUBRIC_DIMENSION_WEIGHTS.efficiency,
      whatToMeasure: `How efficiently ${skill.name} reaches acceptable quality and compliance under the benchmark runtime envelope.`,
      howToGrade: [
        "Score highest when runtime, retry burden, and failure concentration stay low.",
        "Downgrade when improvements require excessive latency or costly reruns.",
        "Benchmark with consistent case counts to keep run-to-run comparisons fair.",
      ],
      improvementLevers: [
        `Dataset lever: ${topDatasetRecommendation}.`,
        "Trim low-signal retrieval and optimize high-cost failure slices first.",
      ],
    },
  ];
}

function normalizeEvaluationMetricWeight(metricId: BenchmarkMetricId, weight: number | undefined) {
  const fallbackWeight = EVALUATION_RUBRIC_DIMENSION_WEIGHTS[metricId];

  if (typeof weight !== "number" || Number.isNaN(weight)) {
    return fallbackWeight;
  }

  return Math.min(1, Math.max(0, weight));
}

export function cloneEvaluationMetricAlignment(metricAlignment: EvaluationMetricAlignment[]): EvaluationMetricAlignment[] {
  return metricAlignment.map((alignment) => ({
    metricId: alignment.metricId,
    metricLabel: alignment.metricLabel,
    weight: normalizeEvaluationMetricWeight(alignment.metricId, alignment.weight),
    whatToMeasure: alignment.whatToMeasure,
    howToGrade: [...alignment.howToGrade],
    improvementLevers: [...alignment.improvementLevers],
  }));
}

export function cloneEvaluationConfigEntries(entries: EvaluationConfigEntry[]): EvaluationConfigEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    key: entry.key,
    value: entry.value,
  }));
}

function sanitizeEvaluationConfigEntries(entries: EvaluationConfigEntry[]) {
  return cloneEvaluationConfigEntries(entries)
    .map((entry) => ({
      ...entry,
      key: entry.key.trim(),
      value: entry.value.trim(),
    }))
    .filter((entry) => entry.key.length > 0 || entry.value.length > 0);
}

function mergeEvaluationConfigEntries(baseEntries: EvaluationConfigEntry[], customEntries: EvaluationConfigEntry[]) {
  const mergedEntries = sanitizeEvaluationConfigEntries(baseEntries);
  const customByKey = new Map<string, EvaluationConfigEntry>();
  const customWithoutKeys: EvaluationConfigEntry[] = [];

  sanitizeEvaluationConfigEntries(customEntries).forEach((entry) => {
    if (!entry.key) {
      customWithoutKeys.push(entry);
      return;
    }

    customByKey.set(entry.key, entry);
  });

  const nextEntries = mergedEntries.map((entry) => customByKey.get(entry.key) ?? entry);
  const seenKeys = new Set(nextEntries.map((entry) => entry.key));

  for (const entry of customByKey.values()) {
    if (!seenKeys.has(entry.key)) {
      nextEntries.push(entry);
    }
  }

  return [...nextEntries, ...customWithoutKeys];
}

export function buildEvaluationArtifactBundle(
  detail: EvaluationRunDetail,
  request: EvaluationCustomTestRequest,
  metricAlignment: EvaluationMetricAlignment[],
  config?: {
    datasetFields?: EvaluationConfigEntry[];
    runnerSettings?: EvaluationConfigEntry[];
  },
): EvaluationArtifactBundle {
  const alignmentById = new Map(metricAlignment.map((alignment) => [alignment.metricId, alignment]));
  const normalizedAlignment = cloneEvaluationMetricAlignment(
    detail.metricAlignment.map((defaultAlignment) => alignmentById.get(defaultAlignment.metricId) ?? defaultAlignment),
  );
  const baselineRef = request.compareAgainstBaseline
    ? detail.baselineRun?.ref ?? detail.publishedRef ?? null
    : null;
  const datasetFields = mergeEvaluationConfigEntries(
    [
      { id: "dataset-source", key: "source_dataset", value: detail.run.dataset },
      { id: "dataset-slice", key: "dataset_slice", value: request.datasetSlice },
      { id: "dataset-sample-count", key: "sample_count", value: String(request.caseCount) },
      { id: "dataset-edge-cases", key: "include_edge_cases", value: request.includeEdgeCases ? "true" : "false" },
    ],
    config?.datasetFields ?? [],
  );
  const runnerSettings = mergeEvaluationConfigEntries(
    [
      { id: "runner-judge-model", key: "judge_model", value: request.judgeModel },
      {
        id: "runner-compare-against-baseline",
        key: "compare_against_baseline",
        value: request.compareAgainstBaseline ? "true" : "false",
      },
    ],
    config?.runnerSettings ?? [],
  );

  return {
    dataset: {
      path: EVALUATION_ARTIFACT_PATHS.dataset,
      evalSetVersion: EVALUATION_ARTIFACT_VERSIONS.evalSet,
      sourceDataset: detail.run.dataset,
      datasetSlice: request.datasetSlice,
      sampleCount: request.caseCount,
      includeEdgeCases: request.includeEdgeCases,
      fields: datasetFields,
      notes: [
        `focus=${request.focus}`,
      ].filter((note): note is string => Boolean(note)),
    },
    rubric: {
      path: EVALUATION_ARTIFACT_PATHS.rubric,
      rubricVersion: EVALUATION_ARTIFACT_VERSIONS.rubric,
      judgeModel: request.judgeModel,
      runnerSettings,
      thresholds: {
        pass: EVALUATION_RUBRIC_THRESHOLDS.pass,
        investigate: EVALUATION_RUBRIC_THRESHOLDS.investigate,
      },
      dimensions: normalizedAlignment.map((alignment) => ({
        ...alignment,
        weight: normalizeEvaluationMetricWeight(alignment.metricId, alignment.weight),
      })),
    },
    baseline: {
      path: EVALUATION_ARTIFACT_PATHS.baseline,
      skillId: detail.skill.id,
      skillVersion: detail.run.ref,
      runId: detail.uuid,
      compareAgainstBaseline: request.compareAgainstBaseline,
      baselineRef,
      publishedRef: detail.publishedRef,
      notes: [
        request.compareAgainstBaseline
          ? `baseline_ref=${baselineRef ?? "none"}`
          : "baseline_ref=exploratory-only",
        `score_dimensions=${normalizedAlignment.map((alignment) => alignment.metricId).join(",")}`,
      ],
    },
  };
}

type ParsedVersionRef = {
  major: number;
  minor: number;
  patch: number;
  prereleaseTag: string | null;
  prereleaseNumber: number | null;
};

function parseVersionRef(ref: string): ParsedVersionRef | null {
  const match = ref.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)(?:[.-]?(\d+))?)?$/i);

  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
    prereleaseTag: match[4]?.toLowerCase() ?? null,
    prereleaseNumber: match[5] ? Number.parseInt(match[5], 10) : null,
  };
}

function compareVersionRefs(left: string, right: string) {
  const parsedLeft = parseVersionRef(left);
  const parsedRight = parseVersionRef(right);

  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major;
  }

  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor;
  }

  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch;
  }

  if (!parsedLeft.prereleaseTag && parsedRight.prereleaseTag) {
    return 1;
  }

  if (parsedLeft.prereleaseTag && !parsedRight.prereleaseTag) {
    return -1;
  }

  const prereleaseOrder: Record<string, number> = {
    alpha: 1,
    beta: 2,
    rc: 3,
  };

  const leftRank = parsedLeft.prereleaseTag ? prereleaseOrder[parsedLeft.prereleaseTag] ?? 0 : 0;
  const rightRank = parsedRight.prereleaseTag ? prereleaseOrder[parsedRight.prereleaseTag] ?? 0 : 0;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return (parsedLeft.prereleaseNumber ?? 0) - (parsedRight.prereleaseNumber ?? 0);
}

export function hasNewerPublishedVersion(publishedRef: string | null | undefined, runRef: string | null | undefined) {
  if (!publishedRef || !runRef || publishedRef === "—" || runRef === "—") {
    return false;
  }

  return compareVersionRefs(publishedRef, runRef) > 0;
}

function buildFailureClusters(run: EvalRun, theme: ThemeTemplate): EvaluationFailureCluster[] {
  const counts = distributeCounts(Math.max(run.failed, theme.failureTemplates.length), theme.failureTemplates.length);

  return theme.failureTemplates.map((cluster, index) => ({
    id: `${run.id}-${index + 1}`,
    label: cluster.label,
    severity: cluster.severity,
    cases: counts[index] ?? 1,
    owner: cluster.owner,
    summary: cluster.summary,
    suggestedUpdate: cluster.suggestedUpdate,
    examples: cluster.examples,
  }));
}

function buildRecommendations(run: EvalRun, theme: ThemeTemplate): EvaluationRecommendation[] {
  return theme.recommendations.map((recommendation, index) => ({
    id: `${run.id}-rec-${index + 1}`,
    ...recommendation,
  }));
}

function buildHeadline(run: EvalRun, theme: ThemeTemplate) {
  if (run.status === "running") {
    return `This evaluation is still running, but the early signal points to ${theme.focus}.`;
  }

  if (run.status === "complete-with-regressions") {
    return `${run.failed} cases regressed on ${theme.focus}; this candidate needs another iteration before it should move forward.`;
  }

  if (run.status === "complete-baseline") {
    return `This run established the first baseline for ${theme.focus} so future candidates can be compared on stable ground.`;
  }

  if ((run.delta ?? 0) >= 0) {
    return `The candidate improved on ${theme.focus} and is ready for a tighter targeted rerun before promotion.`;
  }

  return `The candidate slipped on ${theme.focus}; use the targeted recommendations below before the next rerun.`;
}

function buildNarrative(run: EvalRun, skill: Skill, theme: ThemeTemplate, baselineRun: EvalRun | null) {
  const comparison = baselineRun
    ? `The current comparison baseline is ${baselineRun.ref} on ${baselineRun.dataset}.`
    : "There is no historical baseline pinned for this exact slice yet, so this run is carrying more discovery value than comparison value.";

  return `${skill.name} was evaluated against ${run.dataset}. ${comparison} The strongest next move is to iterate on ${theme.focus} instead of broadening the prompt indiscriminately.`;
}

function buildHistoricalRuns(run: EvalRun, skill: Skill, theme: ThemeTemplate): EvaluationHistoricalRun[] {
  return EVAL_RUNS
    .filter((candidate) => candidate.skill === run.skill && candidate.dataset === run.dataset && candidate.id !== run.id)
    .map((candidate) => {
      const candidateBaseline = findBaselineRun(candidate);
      const metrics = buildMetrics(candidate, skill, candidateBaseline, theme);
      const newerPublishedRef = hasNewerPublishedVersion(skill.ref, candidate.ref) ? skill.ref : null;

      return {
        uuid: candidate.id,
        ref: candidate.ref,
        dataset: candidate.dataset,
        started: candidate.started,
        duration: candidate.duration,
        status: candidate.status,
        failed: candidate.failed,
        score: buildBenchmarkScore(metrics),
        readOnly: newerPublishedRef !== null,
        newerPublishedRef,
      };
    });
}

function buildComparableRuns(run: EvalRun) {
  return EVAL_RUNS
    .filter((candidate) => candidate.skill === run.skill && candidate.id !== run.id)
    .slice(0, 4);
}

function buildReviewerNotes(run: EvalRun, theme: ThemeTemplate) {
  return [
    {
      who: "eval-runner",
      when: run.started,
      text: `Scoped review suggests the next iteration should focus on ${theme.focus}, not a broad rewrite of the whole skill.`,
    },
    ...COMMENTS.map((comment) => ({
      who: comment.who,
      when: comment.when,
      text: comment.text,
    })),
  ].slice(0, 3);
}

export function hasEvaluationRun(uuid: string) {
  return EVAL_RUNS.some((run) => run.id === uuid);
}

export function buildCustomEvaluationRequestFromPreset(
  preset: EvaluationCustomTestPreset,
): EvaluationCustomTestRequest {
  return {
    focus: preset.focus,
    datasetSlice: preset.datasetSlice,
    caseCount: preset.caseCount,
    judgeModel: preset.judgeModel,
    includeEdgeCases: true,
    compareAgainstBaseline: true,
    notes: "",
  };
}

export function getEvaluationRunDetail(uuid: string): EvaluationRunDetail | null {
  const run = EVAL_RUNS.find((candidate) => candidate.id === uuid);

  if (!run) {
    return null;
  }

  const skill = findSkillForRun(run);

  if (!skill) {
    return null;
  }

  const baselineRun = findBaselineRun(run);
  const release = RELEASES.find((candidate) => candidate.skill === run.skill) ?? null;
  const theme = getTheme(skill);
  const metrics = buildMetrics(run, skill, baselineRun, theme);
  const recommendations = buildRecommendations(run, theme);
  const failureClusters = buildFailureClusters(run, theme);

  return {
    uuid: run.id,
    run,
    skill,
    baselineRun,
    release,
    headline: buildHeadline(run, theme),
    narrative: buildNarrative(run, skill, theme, baselineRun),
    datasetDescription: theme.datasetDescription,
    executedBy: theme.executedBy,
    executionEnvironment: theme.executionEnvironment,
    candidateModel: theme.candidateModel,
    judgeModel: theme.judgeModel,
    focus: theme.focus,
    readOnly: hasNewerPublishedVersion(skill.ref, run.ref),
    publishedRef: skill.ref === "—" ? null : skill.ref,
    metrics,
    metricAlignment: buildMetricAlignment(skill, theme, recommendations),
    failureClusters,
    recommendations,
    customTestPresets: theme.presets,
    reviewerNotes: buildReviewerNotes(run, theme),
    historicalRuns: buildHistoricalRuns(run, skill, theme),
    comparableRuns: buildComparableRuns(run),
  };
}

function keywordBoost(text: string) {
  const normalized = text.toLowerCase();
  let boost = 0;

  if (/(latency|rollback|dependency|indemnity|citation|evidence|tone|renewal|appendix|driver|guardrail)/.test(normalized)) {
    boost += 1.6;
  }

  if (/(prompt|dataset|rubric|confidence|schema|retrieval|explanation|ordering|consistency)/.test(normalized)) {
    boost += 0.8;
  }

  if (/(all cases|everything|general cleanup|broad rewrite)/.test(normalized)) {
    boost -= 1.1;
  }

  return boost;
}

function statusFromResult(score: number, delta: number): EvaluationCustomTestStatus {
  if (score >= 90 && delta >= 0.6) {
    return "promising";
  }

  if (score >= 84 && delta >= -0.2) {
    return "watch";
  }

  return "iterate";
}

export function simulateCustomEvaluationTest(
  detail: EvaluationRunDetail,
  request: EvaluationCustomTestRequest,
): EvaluationCustomTestResult {
  const basePassRate = percentage(detail.run.passed, detail.run.cases);
  const baseScore = buildBenchmarkScore(detail.metrics) || basePassRate;
  const normalizedSlice = request.datasetSlice.toLowerCase();
  const sliceBias = normalizedSlice.includes("hard") || normalizedSlice.includes("edge")
    ? -4.2
    : normalizedSlice.includes("golden") || normalizedSlice.includes("review")
      ? 2.8
      : normalizedSlice.includes("regression") || normalizedSlice.includes("focus")
        ? -1.4
        : 0.9;
  const edgeBias = request.includeEdgeCases ? -2.6 : 0.7;
  const baselineBias = request.compareAgainstBaseline ? 0.6 : -0.3;
  const judgeBias = request.judgeModel.toLowerCase().includes("strict")
    ? -1.1
    : request.judgeModel.toLowerCase().includes("balanced")
      ? 0.4
      : 0.9;
  const focusBias = keywordBoost(request.focus);
  const caseBias = request.caseCount > 160 ? -1.4 : request.caseCount < 40 ? 0.8 : 0;

  const passRate = round(clamp(basePassRate + sliceBias + edgeBias + baselineBias + judgeBias + focusBias + caseBias, 55, 99));
  const delta = round(passRate - basePassRate);
  const score = round(clamp(baseScore + delta * 0.35, 50, 99));
  const runtimeSeconds = Math.max(
    8,
    Math.round(parseDurationSeconds(detail.run.duration) + request.caseCount / 18 + (request.includeEdgeCases ? 6 : 0)),
  );
  const status = statusFromResult(score, delta);
  const findings = [
    status === "promising"
      ? `The focused slice materially improved ${detail.focus} without widening the failure surface.`
      : status === "watch"
        ? `The rerun is directionally better, but ${detail.failureClusters[0]?.label.toLowerCase() ?? "the top cluster"} still needs reviewer attention.`
        : `The scoped run still concentrates failures in ${detail.failureClusters[0]?.label.toLowerCase() ?? "the top regression cluster"}.`,
    request.includeEdgeCases
      ? "Edge cases increased the evaluation difficulty, which makes this a good promotion gate slice."
      : "This slice is cheaper to rerun quickly, but it may hide some of the hardest regressions.",
    request.compareAgainstBaseline
      ? `Compared against baseline ${detail.baselineRun?.ref ?? detail.skill.ref}, the rerun ${delta >= 0 ? "improved" : "dropped"} by ${Math.abs(delta).toFixed(1)} points of pass rate.`
      : "This rerun was scored without a strict baseline comparison, so use it for exploration rather than release approval.",
  ];

  return {
    passRate,
    score,
    delta,
    runtimeSeconds,
    status,
    headline: status === "promising"
      ? "This Test Bench run looks good enough to fold into the next candidate patch."
      : status === "watch"
        ? "This Test Bench run is useful, but keep iterating before you treat it as promotion-ready."
        : "This Test Bench run confirms the skill still needs a tighter iteration on the current failure mode.",
    findings,
    suggestedNextStep: status === "promising"
      ? "Promote this slice into the standing regression suite and rerun the full candidate set."
      : status === "watch"
        ? "Apply the top recommendation, rerun the same slice, then compare against the baseline again."
        : "Fix the highest-severity cluster first, then rerun a smaller hard-case slice before spending cycles on the full suite.",
  };
}
