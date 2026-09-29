// Candidate acceptance gate.
//
//   PRIMARY OBJECTIVE      candidate > baseline
//   CRITICAL SAFETY        candidate >= baseline
//   REGRESSION TESTS       pass
//   LOCKED RULES           unchanged
//   HUMAN APPROVAL         present
//
// The control plane recomputes this from raw paired case results submitted by
// the worker. A higher total score can never conceal a safety regression
// because every guardrail dimension is checked on its own.

import type {
  CandidateValidation,
  ChangeBudget,
  DimensionDelta,
  GateCheck,
  OptimizationObjective,
  RecommendationEdit,
  RuntimeMatrixRow,
  SkillRuntime,
  SkillTier,
} from "@savant/types";

import { verifyLockedRegionsUnchanged } from "./locked-sections.ts";
import { TIER_OPTIMIZATION_POLICIES } from "./policy.ts";
import { verifyChangeBudget } from "./skill-diff.ts";
import {
  classifyEvidenceStrength,
  hashStringToSeed,
  mean,
  pairedBootstrapInterval,
  round,
} from "./statistics.ts";

export type CasePartition = "validation" | "regression" | "holdout";

export type CaseResult = {
  caseId: string;
  partition: CasePartition;
  runtime?: SkillRuntime;
  /** Overall case score on a 0..100 scale. */
  baseline: number;
  candidate: number;
  dimensions?: Record<string, { baseline: number; candidate: number }>;
  baselineLatencyMs?: number;
  candidateLatencyMs?: number;
  baselineCost?: number;
  candidateCost?: number;
};

export type DependentSuiteResult = { skillId: string; passed: boolean };

/** Dimensions treated as safety-critical guardrails unless the objective adds more. */
export const DEFAULT_CRITICAL_DIMENSIONS = ["security-compliance", "policy-compliance", "format-compliance"];

export const REGRESSION_PASS_MARK = 70;
export const REGRESSION_TOLERANCE = 2;
export const HOLDOUT_TOLERANCE = 1;
export const PORTABILITY_TOLERANCE = 3;
const LOWER_IS_BETTER = new Set(["latency", "cost", "edit-rate", "verbosity"]);

function check(key: GateCheck["key"], label: string, passed: boolean, blocking: boolean, detail: string): GateCheck {
  return { key, label, passed, blocking, detail };
}

function aggregateDimensions(cases: readonly CaseResult[], critical: ReadonlySet<string>): DimensionDelta[] {
  const sums = new Map<string, { baseline: number; candidate: number; count: number }>();
  for (const result of cases) {
    for (const [dimension, value] of Object.entries(result.dimensions ?? {})) {
      const entry = sums.get(dimension) ?? { baseline: 0, candidate: 0, count: 0 };
      entry.baseline += value.baseline;
      entry.candidate += value.candidate;
      entry.count += 1;
      sums.set(dimension, entry);
    }
  }

  return [...sums.entries()].map(([dimension, entry]) => {
    const baseline = round(entry.baseline / entry.count, 1);
    const candidate = round(entry.candidate / entry.count, 1);
    return {
      dimension,
      baseline,
      candidate,
      delta: round(candidate - baseline, 1),
      lowerIsBetter: LOWER_IS_BETTER.has(dimension),
      critical: critical.has(dimension),
    };
  }).sort((left, right) => Number(right.critical) - Number(left.critical) || left.dimension.localeCompare(right.dimension));
}

function percentChange(values: ReadonlyArray<[number | undefined, number | undefined]>): number | null {
  const pairs = values.filter((pair): pair is [number, number] => pair[0] != null && pair[1] != null && pair[0] > 0);
  if (pairs.length === 0) {
    return null;
  }
  const baseline = pairs.reduce((sum, [value]) => sum + value, 0);
  const candidate = pairs.reduce((sum, [, value]) => sum + value, 0);
  return round(((candidate - baseline) / baseline) * 100, 1);
}

function isImprovement(delta: DimensionDelta | undefined, direction: "increase" | "decrease"): boolean {
  if (!delta) {
    return false;
  }
  return direction === "increase" ? delta.delta > 0 : delta.delta < 0;
}

export function regressionCasePassed(result: Pick<CaseResult, "baseline" | "candidate">): boolean {
  return result.candidate >= Math.min(result.baseline, REGRESSION_PASS_MARK) - REGRESSION_TOLERANCE;
}

function buildRuntimeMatrix(cases: readonly CaseResult[]): RuntimeMatrixRow[] {
  const byRuntime = new Map<SkillRuntime, CaseResult[]>();
  for (const result of cases) {
    if (!result.runtime) {
      continue;
    }
    byRuntime.set(result.runtime, [...(byRuntime.get(result.runtime) ?? []), result]);
  }
  return [...byRuntime.entries()].map(([runtime, group]) => {
    const baseline = round(mean(group.map((entry) => entry.baseline)) ?? 0, 1);
    const candidate = round(mean(group.map((entry) => entry.candidate)) ?? 0, 1);
    return { runtime, baseline, candidate, delta: round(candidate - baseline, 1), sampleCount: group.length };
  }).sort((left, right) => left.runtime.localeCompare(right.runtime));
}

export type CandidateEvaluationInput = {
  baseContent: string;
  candidateContent: string;
  candidateContentHash: string;
  edits: readonly RecommendationEdit[];
  budget: ChangeBudget;
  objective: OptimizationObjective;
  cases: readonly CaseResult[];
  tier: SkillTier;
  dependents: { direct: number; transitive: number; suites: readonly DependentSuiteResult[] };
  minimumSamples: number;
  now?: Date;
};

export function evaluateCandidate(input: CandidateEvaluationInput): CandidateValidation {
  const validation = input.cases.filter((result) => result.partition === "validation");
  const regression = input.cases.filter((result) => result.partition === "regression");
  const holdout = input.cases.filter((result) => result.partition === "holdout");
  const tierPolicy = TIER_OPTIMIZATION_POLICIES[input.tier];

  const critical = new Set([
    ...DEFAULT_CRITICAL_DIMENSIONS,
    ...input.objective.guardrails.map((guardrail) => guardrail.dimension),
  ]);

  const baselineScore = round(mean(validation.map((result) => result.baseline)) ?? 0, 1);
  const candidateScore = round(mean(validation.map((result) => result.candidate)) ?? 0, 1);
  const interval = pairedBootstrapInterval(validation, {
    seed: hashStringToSeed(input.candidateContentHash),
  });
  const evidenceStrength = classifyEvidenceStrength(interval, input.minimumSamples);
  const dimensions = aggregateDimensions([...validation, ...regression], critical);
  const dimensionByKey = new Map(dimensions.map((dimension) => [dimension.dimension, dimension]));

  const gate: GateCheck[] = [];

  // Primary objective: every primary dimension must improve on validation.
  const primaryResults = input.objective.primary.map((primary) => {
    if (primary.dimension === "overall") {
      return { primary, improved: candidateScore > baselineScore, delta: round(candidateScore - baselineScore, 1) };
    }
    const delta = aggregateDimensions(validation, critical).find((entry) => entry.dimension === primary.dimension);
    return { primary, improved: isImprovement(delta, primary.direction), delta: delta?.delta ?? null };
  });
  const primaryPassed = validation.length > 0 && primaryResults.length > 0 && primaryResults.every((entry) => entry.improved);
  gate.push(check(
    "primary-objective",
    "Primary objective",
    primaryPassed,
    true,
    validation.length === 0
      ? "No validation cases were evaluated."
      : primaryResults.map((entry) => `${entry.primary.dimension} ${entry.delta == null ? "not measured" : `${entry.delta >= 0 ? "+" : ""}${entry.delta}`}`).join(" · "),
  ));

  // Critical safety: no guardrail may get worse, independent of the total.
  const safetyViolations = dimensions.filter((dimension) =>
    dimension.critical && (dimension.lowerIsBetter ? dimension.delta > 0 : dimension.delta < 0),
  );
  gate.push(check(
    "critical-safety",
    "Critical safety metrics",
    safetyViolations.length === 0,
    true,
    safetyViolations.length === 0
      ? `${dimensions.filter((dimension) => dimension.critical).length} guardrail dimension(s) held or improved.`
      : safetyViolations.map((dimension) => `${dimension.dimension} ${dimension.baseline} → ${dimension.candidate}`).join(" · "),
  ));

  const regressionFailures = regression.filter((result) => !regressionCasePassed(result));
  gate.push(check(
    "regression-tests",
    "Protected regression suite",
    regressionFailures.length === 0 && regression.length > 0,
    true,
    regression.length === 0
      ? "No protected regression cases were evaluated."
      : `${regression.length - regressionFailures.length} / ${regression.length} passed.`,
  ));

  const locks = verifyLockedRegionsUnchanged(input.baseContent, input.candidateContent);
  gate.push(check(
    "locked-rules",
    "Locked rules unchanged",
    locks.ok,
    true,
    locks.ok ? "All SAVANT:LOCK regions are byte-identical." : locks.violations.join(" "),
  ));

  const budget = verifyChangeBudget(input.baseContent, input.edits, input.budget);
  gate.push(check(
    "change-budget",
    "Bounded change budget",
    budget.ok,
    true,
    budget.ok
      ? `${budget.usage.changedLines} lines · ~${budget.usage.changedTokens} tokens within ${input.budget.aggressiveness} budget.`
      : budget.violations.join(" "),
  ));

  gate.push(check(
    "statistical-confidence",
    "Statistical confidence",
    evidenceStrength === "high" || evidenceStrength === "medium",
    true,
    interval
      ? `${Math.round(interval.confidence * 100)}% bootstrap interval ${round(interval.low, 1)} to ${round(interval.high, 1)} over ${interval.samples} paired cases · evidence ${evidenceStrength}.`
      : `Not enough paired validation cases (need ${input.minimumSamples}).`,
  ));

  if (holdout.length > 0) {
    const holdoutBaseline = mean(holdout.map((result) => result.baseline)) ?? 0;
    const holdoutCandidate = mean(holdout.map((result) => result.candidate)) ?? 0;
    gate.push(check(
      "shadow-holdout",
      "Shadow holdout",
      holdoutCandidate >= holdoutBaseline - HOLDOUT_TOLERANCE,
      true,
      `Holdout (never seen by the optimizer) ${round(holdoutBaseline, 1)} → ${round(holdoutCandidate, 1)} over ${holdout.length} cases.`,
    ));
  }

  const failedSuites = input.dependents.suites.filter((suite) => !suite.passed);
  const dependentsRequired = tierPolicy.crossSkillRegressionRequired && input.dependents.direct + input.dependents.transitive > 0;
  gate.push(check(
    "downstream-dependents",
    "Downstream dependents",
    failedSuites.length === 0 && (!dependentsRequired || input.dependents.suites.length > 0),
    dependentsRequired,
    input.dependents.suites.length === 0
      ? dependentsRequired
        ? `Tier ${input.tier} change affects ${input.dependents.direct} direct / ${input.dependents.transitive} transitive dependents; their regression suites must run before approval.`
        : "No dependent skill suites were required."
      : `${input.dependents.suites.length - failedSuites.length} / ${input.dependents.suites.length} dependent suites passed.`,
  ));

  const runtimeMatrix = buildRuntimeMatrix([...validation, ...regression]);
  const portabilityFailures = runtimeMatrix.filter((row) => row.sampleCount >= 3 && row.delta < -PORTABILITY_TOLERANCE);
  gate.push(check(
    "runtime-portability",
    "Cross-runtime portability",
    portabilityFailures.length === 0,
    input.tier !== 3,
    runtimeMatrix.length === 0
      ? "Runtime matrix not evaluated."
      : portabilityFailures.length === 0
        ? `No runtime regressed more than ${PORTABILITY_TOLERANCE} points across ${runtimeMatrix.length} runtime(s).`
        : portabilityFailures.map((row) => `${row.runtime} ${row.delta}`).join(" · "),
  ));

  const passed = gate.every((entry) => !entry.blocking || entry.passed);

  return {
    baselineScore,
    candidateScore,
    delta: round(candidateScore - baselineScore, 1),
    regressions: regressionFailures.length + safetyViolations.length,
    passed,
    sampleCount: validation.length,
    interval: interval
      ? { low: round(interval.low, 2), high: round(interval.high, 2), confidence: interval.confidence }
      : null,
    evidenceStrength,
    dimensions: dimensionByKey.size > 0 ? dimensions : [],
    regressionSuite: { total: regression.length, passed: regression.length - regressionFailures.length },
    holdout: holdout.length > 0
      ? {
          total: holdout.length,
          baseline: round(mean(holdout.map((result) => result.baseline)) ?? 0, 1),
          candidate: round(mean(holdout.map((result) => result.candidate)) ?? 0, 1),
        }
      : null,
    runtimeMatrix,
    latencyDeltaPct: percentChange(validation.map((result) => [result.baselineLatencyMs, result.candidateLatencyMs])),
    costDeltaPct: percentChange(validation.map((result) => [result.baselineCost, result.candidateCost])),
    gate,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
    candidateContentHash: input.candidateContentHash,
  };
}

/** Human approval is the final gate entry; it never short-circuits the others. */
export function withHumanApprovalCheck(
  validation: CandidateValidation,
  approvals: number,
  required: number,
): GateCheck[] {
  return [
    ...validation.gate.filter((entry) => entry.key !== "human-approval"),
    check(
      "human-approval",
      "Human approval",
      approvals >= required,
      true,
      `${approvals} of ${required} required reviewer approval(s).`,
    ),
  ];
}
