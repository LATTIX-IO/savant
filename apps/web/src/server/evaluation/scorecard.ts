import { parse as parseYaml } from "yaml";

/**
 * Import-time skill evaluation.
 *
 * Skill repositories that follow the lattix-skills evaluation framework ship
 * `eval/dataset.yaml` with *scored samples* (observed quality, compliance,
 * grounding, actionability, latency, cost, revisions, verdict), an
 * `eval/rubric.yaml` with dimension weights and thresholds, and a committed
 * `eval/baseline.json` scorecard. This is a faithful port of the repository's
 * own `scripts/run_eval.py` ("deterministic bootstrap evaluation"), so the
 * scorecard Savant computes on import matches what the repository's tooling
 * produces, and drift from the committed baseline can be reported.
 *
 * Datasets that only contain unscored cases (inputs and expected outcomes)
 * can't be scored deterministically; they need live execution against the
 * workspace's AI provider and are reported as `requires_execution`.
 */

export const DEFAULT_DIMENSIONS = {
  quality: 0.3,
  compliance: 0.2,
  grounding: 0.15,
  actionability: 0.2,
  efficiency: 0.15,
} as const;

export type Dimension = keyof typeof DEFAULT_DIMENSIONS;

export type EvalSample = {
  caseId: string;
  prompt: string | null;
  quality: number;
  formatCompliance: number;
  policyCompliance: boolean;
  groundingRelevant: boolean;
  groundingScore: number;
  actionability: number;
  latencyMs: number;
  estimatedCostUsd: number;
  humanRevisionCount: number;
  verdict: "pass" | "investigate" | "fail" | string;
};

export type Scorecard = {
  sampleCount: number;
  qualityScore: number;
  complianceScore: number;
  groundingScore: number;
  actionabilityScore: number;
  efficiencyScore: number;
  overallScore: number;
  passRate: number;
  investigateRate: number;
  failRate: number;
  passCount: number;
  investigateCount: number;
  failCount: number;
  avgLatencyMs: number;
  avgEstimatedCostUsd: number;
  avgHumanRevisionCount: number;
  weights: Record<Dimension, number>;
  thresholds: { pass: number | null; investigate: number | null };
};

export type SkillEvaluation =
  | {
      status: "scored";
      scorecard: Scorecard;
      samples: EvalSample[];
      committedBaseline: { overallScore: number; runId: string | null; timestamp: string | null } | null;
      /** Computed minus committed overall score (null without a committed baseline). */
      baselineDelta: number | null;
      evalSetVersion: string | null;
      rubricVersion: string | null;
    }
  | { status: "requires_execution"; caseCount: number; reason: string }
  | { status: "missing"; reason: string }
  | { status: "invalid"; reason: string };

const round = (value: number) => Math.round(value * 100) / 100;
const average = (values: number[]) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Same as the repository's `compute_efficiency_score`. */
export function computeEfficiencyScore(avgLatencyMs: number, avgCostUsd: number, avgRevisions: number): number {
  const latency = Math.max(0, 100 - Math.min(avgLatencyMs, 5000) / 50);
  const cost = Math.max(0, 100 - Math.min(avgCostUsd, 0.25) * 400);
  const revisions = Math.max(0, 100 - Math.min(avgRevisions, 5) * 20);
  return round(latency * 0.4 + cost * 0.3 + revisions * 0.3);
}

function normalizedWeights(input: unknown): Record<Dimension, number> {
  const source = record(input) ?? DEFAULT_DIMENSIONS;
  const weights = Object.fromEntries(
    (Object.keys(DEFAULT_DIMENSIONS) as Dimension[]).map((key) => [key, Math.max(0, num((source as Record<string, unknown>)[key]) ?? 0)]),
  ) as Record<Dimension, number>;
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    throw new Error("Rubric dimensions must sum to a positive value.");
  }
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / total])) as Record<Dimension, number>;
}

function parseSample(raw: unknown, index: number): EvalSample {
  const sample = record(raw);
  if (!sample) {
    throw new Error(`sample ${index + 1} is not a mapping`);
  }
  const required = (key: string) => {
    const value = num(sample[key]);
    if (value === null) throw new Error(`sample ${String(sample.case_id ?? index + 1)} is missing numeric ${key}`);
    return value;
  };
  const flag = (key: string) => {
    const value = bool(sample[key]);
    if (value === null) throw new Error(`sample ${String(sample.case_id ?? index + 1)} is missing boolean ${key}`);
    return value;
  };
  return {
    caseId: typeof sample.case_id === "string" ? sample.case_id : `sample-${index + 1}`,
    prompt: typeof sample.prompt === "string" ? sample.prompt : null,
    quality: required("quality"),
    formatCompliance: required("format_compliance"),
    policyCompliance: flag("policy_compliance"),
    groundingRelevant: flag("grounding_relevant"),
    groundingScore: required("grounding_score"),
    actionability: required("actionability"),
    latencyMs: required("latency_ms"),
    estimatedCostUsd: required("estimated_cost_usd"),
    humanRevisionCount: required("human_revision_count"),
    verdict: typeof sample.verdict === "string" ? sample.verdict : "unknown",
  };
}

export function computeScorecard(samples: EvalSample[], rubric: unknown): Scorecard {
  const qualityScore = round(average(samples.map((sample) => sample.quality * 100)));
  const complianceScore = round(average(samples.map((sample) => ((sample.formatCompliance + (sample.policyCompliance ? 1 : 0)) / 2) * 100)));
  const grounding = samples.filter((sample) => sample.groundingRelevant).map((sample) => sample.groundingScore * 100);
  const groundingScore = round(grounding.length > 0 ? average(grounding) : 100);
  const actionabilityScore = round(average(samples.map((sample) => sample.actionability * 100)));
  const avgLatencyMs = round(average(samples.map((sample) => sample.latencyMs)));
  const avgEstimatedCostUsd = round(average(samples.map((sample) => sample.estimatedCostUsd)));
  const avgHumanRevisionCount = round(average(samples.map((sample) => sample.humanRevisionCount)));
  const efficiencyScore = computeEfficiencyScore(avgLatencyMs, avgEstimatedCostUsd, avgHumanRevisionCount);
  const rubricRecord = record(rubric);
  const weights = normalizedWeights(rubricRecord?.dimensions);
  const overallScore = round(
    qualityScore * weights.quality
    + complianceScore * weights.compliance
    + groundingScore * weights.grounding
    + actionabilityScore * weights.actionability
    + efficiencyScore * weights.efficiency,
  );
  const count = (verdict: string) => samples.filter((sample) => sample.verdict === verdict).length;
  const passCount = count("pass");
  const investigateCount = count("investigate");
  const failCount = count("fail");
  const thresholds = record(rubricRecord?.thresholds);

  return {
    sampleCount: samples.length,
    qualityScore,
    complianceScore,
    groundingScore,
    actionabilityScore,
    efficiencyScore,
    overallScore,
    passRate: round(passCount / samples.length),
    investigateRate: round(investigateCount / samples.length),
    failRate: round(failCount / samples.length),
    passCount,
    investigateCount,
    failCount,
    avgLatencyMs,
    avgEstimatedCostUsd,
    avgHumanRevisionCount,
    weights,
    thresholds: { pass: num(thresholds?.pass), investigate: num(thresholds?.investigate) },
  };
}

/** Evaluates one skill package from its eval/ files (content keyed by path). */
export function evaluateSkillPackage(root: string, files: Readonly<Record<string, string>>): SkillEvaluation {
  const datasetText = files[`${root}/eval/dataset.yaml`];
  if (datasetText === undefined) {
    return { status: "missing", reason: "No eval/dataset.yaml." };
  }

  let dataset: Record<string, unknown> | null;
  let rubric: unknown = null;
  try {
    dataset = record(parseYaml(datasetText));
    const rubricText = files[`${root}/eval/rubric.yaml`];
    rubric = rubricText === undefined ? null : parseYaml(rubricText);
  } catch (error) {
    return { status: "invalid", reason: error instanceof Error ? error.message.split("\n")[0] ?? "invalid YAML" : "invalid YAML" };
  }
  if (!dataset) {
    return { status: "invalid", reason: "eval/dataset.yaml is not a mapping." };
  }

  const samples = Array.isArray(dataset.samples) ? dataset.samples : null;
  if (!samples || samples.length === 0) {
    const cases = Array.isArray(dataset.cases) ? dataset.cases.length : 0;
    return cases > 0
      ? { status: "requires_execution", caseCount: cases, reason: "The dataset has unscored cases; scoring them requires running the skill against an AI provider." }
      : { status: "invalid", reason: "eval/dataset.yaml has no samples or cases." };
  }

  let parsedSamples: EvalSample[];
  let scorecard: Scorecard;
  try {
    parsedSamples = samples.map(parseSample);
    scorecard = computeScorecard(parsedSamples, rubric);
  } catch (error) {
    return { status: "invalid", reason: error instanceof Error ? error.message : "The dataset could not be scored." };
  }

  let committedBaseline: { overallScore: number; runId: string | null; timestamp: string | null } | null = null;
  const baselineText = files[`${root}/eval/baseline.json`];
  if (baselineText !== undefined) {
    try {
      const baseline = record(JSON.parse(baselineText));
      const overall = num(baseline?.overall_score);
      if (overall !== null) {
        committedBaseline = {
          overallScore: overall,
          runId: typeof baseline?.run_id === "string" ? baseline.run_id : null,
          timestamp: typeof baseline?.timestamp === "string" ? baseline.timestamp : null,
        };
      }
    } catch {
      committedBaseline = null;
    }
  }

  return {
    status: "scored",
    scorecard,
    samples: parsedSamples,
    committedBaseline,
    baselineDelta: committedBaseline ? round(scorecard.overallScore - committedBaseline.overallScore) : null,
    evalSetVersion: typeof dataset.eval_set_version === "string" ? dataset.eval_set_version : null,
    rubricVersion: typeof record(rubric)?.rubric_version === "string" ? String(record(rubric)?.rubric_version) : null,
  };
}

/** A baseline.json in the repository's scorecard format, for updating a stale committed baseline. */
export function buildBaselineDocument(input: {
  skillId: string;
  skillVersion: string | null;
  evalSetVersion: string | null;
  rubricVersion: string | null;
  runId: string;
  timestamp: string;
  scorecard: Scorecard;
}): string {
  const s = input.scorecard;
  return JSON.stringify({
    skill_id: input.skillId,
    skill_version: input.skillVersion ?? "0.1.0",
    eval_set_version: input.evalSetVersion ?? "1.0.0",
    rubric_version: input.rubricVersion ?? "1.0.0",
    run_id: input.runId,
    timestamp: input.timestamp,
    sample_count: s.sampleCount,
    quality_score: s.qualityScore,
    compliance_score: s.complianceScore,
    grounding_score: s.groundingScore,
    actionability_score: s.actionabilityScore,
    efficiency_score: s.efficiencyScore,
    overall_score: s.overallScore,
    pass_rate: s.passRate,
    investigate_rate: s.investigateRate,
    fail_rate: s.failRate,
    notes: [
      "Deterministic bootstrap evaluation.",
      `avg_latency_ms=${s.avgLatencyMs}`,
      `avg_estimated_cost_usd=${s.avgEstimatedCostUsd}`,
    ],
  }, null, 2) + "\n";
}
