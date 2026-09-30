import type { FlaggedCaseItem, RubricComparisonRow } from "@savant/types";

/**
 * Builds the skill Evaluation tab's rubric breakdown and flagged cases from
 * stored import-time results: the latest scorecard against the previous one
 * (or against itself for the first, baseline run).
 */

type StoredScorecard = {
  qualityScore?: number;
  complianceScore?: number;
  groundingScore?: number;
  actionabilityScore?: number;
  efficiencyScore?: number;
  overallScore?: number;
  weights?: Record<string, number>;
};

type StoredCase = {
  caseId: string;
  prompt?: string | null;
  verdict?: string;
  quality?: number;
  compliance?: number;
  grounding?: number | null;
  actionability?: number;
};

export type StoredEvaluationResult = { scorecard?: unknown; case_results?: unknown };

const DIMENSIONS = [
  ["Overall", "overallScore"],
  ["Quality", "qualityScore"],
  ["Compliance", "complianceScore"],
  ["Grounding", "groundingScore"],
  ["Actionability", "actionabilityScore"],
  ["Efficiency", "efficiencyScore"],
] as const;

const CASE_DIMENSIONS = ["quality", "compliance", "grounding", "actionability"] as const;

const round = (value: number) => Math.round(value * 10) / 10;

function scorecardOf(result: StoredEvaluationResult | undefined): StoredScorecard | null {
  const value = result?.scorecard;
  return typeof value === "object" && value !== null && typeof (value as StoredScorecard).overallScore === "number" ? value as StoredScorecard : null;
}

function casesOf(result: StoredEvaluationResult | undefined): StoredCase[] {
  return Array.isArray(result?.case_results)
    ? (result.case_results as unknown[]).filter((item): item is StoredCase => typeof item === "object" && item !== null && typeof (item as StoredCase).caseId === "string")
    : [];
}

/** Weighted case score over the per-case dimensions (efficiency is a run-level measure). */
function caseScore(item: StoredCase, weights: Record<string, number> | undefined): number {
  let total = 0;
  let weight = 0;
  for (const dimension of CASE_DIMENSIONS) {
    const value = item[dimension];
    if (typeof value !== "number") continue;
    const w = weights?.[dimension] ?? 0.25;
    total += value * w;
    weight += w;
  }
  return weight > 0 ? round(total / weight) : 0;
}

function weakestDimension(item: StoredCase): string {
  const scored = CASE_DIMENSIONS
    .map((dimension) => [dimension, item[dimension]] as const)
    .filter((entry): entry is readonly [typeof CASE_DIMENSIONS[number], number] => typeof entry[1] === "number")
    .sort((left, right) => left[1] - right[1]);
  return scored[0]?.[0] ?? "overall";
}

export function buildRubricBaseline(latest: StoredEvaluationResult | undefined, previous: StoredEvaluationResult | undefined): RubricComparisonRow[] {
  const current = scorecardOf(latest);
  if (!current) {
    return [];
  }
  const prior = scorecardOf(previous) ?? current;
  return DIMENSIONS.flatMap(([label, key]) => {
    const candidate = current[key];
    const baseline = prior[key];
    return typeof candidate === "number" && typeof baseline === "number"
      ? [{ label, baseline: round(baseline), candidate: round(candidate), direction: candidate >= baseline ? "up" as const : "down" as const }]
      : [];
  });
}

export function buildFlaggedCases(latest: StoredEvaluationResult | undefined, previous: StoredEvaluationResult | undefined): FlaggedCaseItem[] {
  const weights = scorecardOf(latest)?.weights;
  const priorById = new Map(casesOf(previous).map((item) => [item.caseId, item]));
  return casesOf(latest)
    .filter((item) => item.verdict === "fail" || item.verdict === "investigate")
    .map((item) => {
      const candidate = caseScore(item, weights);
      const prior = priorById.get(item.caseId);
      const baseline = prior ? caseScore(prior, weights) : candidate;
      return {
        caseId: item.caseId,
        description: `${item.verdict === "fail" ? "Fails" : "Needs investigation"}: ${item.prompt ?? "no prompt recorded"}`,
        rubric: weakestDimension(item),
        baseline,
        candidate,
        delta: round(candidate - baseline),
      };
    })
    .sort((left, right) => left.candidate - right.candidate);
}
