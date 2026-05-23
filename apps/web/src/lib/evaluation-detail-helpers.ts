import type {
  ReleaseQueueItem,
  ResourceResponse,
  SkillListItem,
} from "@savant/types";

export type EvaluationMetricUnit = "%" | "s" | "pts";
export type EvaluationMetricDirection = "up" | "down";
export type EvaluationClusterSeverity = "minor" | "moderate" | "critical";
export type EvaluationRecommendationCategory = "prompt" | "dataset" | "rubric" | "guardrail";
export type EvaluationRecommendationEffort = "low" | "medium" | "high";
export type EvaluationCustomTestStatus = "promising" | "watch" | "iterate";
export type BenchmarkMetricId = "quality" | "compliance" | "grounding" | "actionability" | "efficiency";
export type EvaluationRunStatus = "running" | "complete" | "complete-with-regressions" | "complete-baseline" | "failed";

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

export interface EvaluationRunSummary {
  id: string;
  ref: string;
  dataset: string;
  cases: number;
  passed: number;
  failed: number;
  started: string;
  duration: string;
  delta: number | null;
  status: EvaluationRunStatus;
}

export interface EvaluationHistoricalRun extends EvaluationRunSummary {
  uuid: string;
  score: number;
  readOnly: boolean;
  newerPublishedRef: string | null;
}

export interface EvaluationRunDetail {
  uuid: string;
  run: EvaluationRunSummary;
  skill: SkillListItem;
  baselineRun: EvaluationRunSummary | null;
  release: ReleaseQueueItem | null;
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
}

export type EvaluationDetailResponse = ResourceResponse<EvaluationRunDetail>;

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

function buildBenchmarkScore(metrics: EvaluationMetric[]) {
  if (metrics.length === 0) {
    return 0;
  }

  return round(metrics.reduce((total, metric) => total + metric.candidate, 0) / metrics.length);
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
