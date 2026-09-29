// Skill Health: multi-dimensional, continually recomputed from run telemetry.
//
// The composite score exists for navigation only. Promotion decisions inspect
// the individual dimensions (see regression-gate.ts), never the composite.

import type {
  CohortScore,
  CohortType,
  ExplicitFeedbackCategory,
  HealthDimension,
  HealthDimensionKey,
  PassiveSignalType,
  SkillHealthSnapshot,
  SkillRuntime,
  TaskOutcome,
  TelemetryCoverageRow,
  TelemetryLevel,
} from "@savant/types";

import { mean, median, round } from "./statistics.ts";

/** Normalized run view used by all analysis (health, cohorts, clusters, triggers). */
export type AnalyzedRun = {
  runId: string;
  runtime: SkillRuntime;
  model: string | null;
  skillVersionId: string;
  connectorId: string;
  telemetryLevel: TelemetryLevel;
  success: boolean | null;
  startedAt: string;
  latencyMs: number | null;
  estimatedCost: number | null;
  weakLabel: number | null;
  taskArchetype: string | null;
  businessUnit: string | null;
  inputStructure: "structured" | "unstructured" | null;
  inputFingerprint: string | null;
  feedbackCategories: ExplicitFeedbackCategory[];
  passiveSignals: PassiveSignalType[];
  rubricFailures: string[];
  editRatio: number | null;
  humanAccepted: boolean | null;
  taskOutcome: TaskOutcome | null;
  outputScore: number | null;
};

export type HealthContext = {
  /** Latest indexed evaluation pass rate (0..100), if any. */
  evalBenchmark: number | null;
  /** Share (0..100) of recent evaluation runs without regressions, if any. */
  regressionStability: number | null;
  now?: Date;
};

export const HEALTH_DIMENSION_LABELS: Record<HealthDimensionKey, string> = {
  "task-success": "Task success",
  "human-acceptance": "Human acceptance",
  "eval-benchmark": "Eval benchmark",
  "policy-compliance": "Policy compliance",
  consistency: "Consistency",
  efficiency: "Efficiency",
  "regression-stability": "Regression stability",
};

const DIMENSION_WEIGHTS: Record<HealthDimensionKey, number> = {
  "task-success": 0.25,
  "human-acceptance": 0.2,
  "eval-benchmark": 0.15,
  "policy-compliance": 0.15,
  consistency: 0.1,
  efficiency: 0.05,
  "regression-stability": 0.1,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimum runs before a cohort can be flagged as underperforming. */
export const COHORT_MIN_RUNS = 10;
/** Points below the skill-wide score at which a cohort is flagged. */
export const COHORT_FLAG_MARGIN = 10;

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round((numerator / denominator) * 100, 1) : null;
}

/** Task outcome wins over self-reported success when both are present. */
export function runSucceeded(run: AnalyzedRun): boolean | null {
  if (run.taskOutcome === "succeeded") {
    return true;
  }
  if (run.taskOutcome === "failed") {
    return false;
  }
  return run.success;
}

export function runAccepted(run: AnalyzedRun): boolean | null {
  if (run.humanAccepted != null) {
    return run.humanAccepted;
  }
  if (run.weakLabel != null) {
    return run.weakLabel > 0;
  }
  return null;
}

/** A run counts as a failure example for clustering and triggers. */
export function isFailureRun(run: AnalyzedRun): boolean {
  if (runSucceeded(run) === false) {
    return true;
  }
  if (run.weakLabel != null && run.weakLabel < 0) {
    return true;
  }
  return run.feedbackCategories.some((category) => category !== "good-result");
}

function taskSuccessScore(runs: readonly AnalyzedRun[]) {
  const known = runs.map(runSucceeded).filter((value): value is boolean => value != null);
  return { score: percentage(known.filter(Boolean).length, known.length), sampleCount: known.length };
}

function acceptanceScore(runs: readonly AnalyzedRun[]) {
  const known = runs.map(runAccepted).filter((value): value is boolean => value != null);
  return { score: percentage(known.filter(Boolean).length, known.length), sampleCount: known.length };
}

/** Core outcome score used for trends and cohorts: task success blended with acceptance. */
export function coreScore(runs: readonly AnalyzedRun[]): number | null {
  const values = [taskSuccessScore(runs).score, acceptanceScore(runs).score].filter(
    (value): value is number => value != null,
  );
  const average = mean(values);
  return average == null ? null : round(average, 1);
}

function policyComplianceScore(runs: readonly AnalyzedRun[]) {
  if (runs.length === 0) {
    return { score: null, sampleCount: 0 };
  }
  const violations = runs.filter((run) => run.feedbackCategories.includes("unsafe-recommendation")).length;
  return { score: percentage(runs.length - violations, runs.length), sampleCount: runs.length };
}

function consistencyScore(runs: readonly AnalyzedRun[]) {
  // Consistency = how evenly the skill performs across runtimes. Falls back to
  // weak-label dispersion when only one runtime is observed.
  const byRuntime = groupBy(runs, (run) => run.runtime);
  const runtimeScores = [...byRuntime.values()]
    .filter((group) => group.length >= 3)
    .map((group) => coreScore(group))
    .filter((value): value is number => value != null);

  if (runtimeScores.length >= 2) {
    const spread = Math.max(...runtimeScores) - Math.min(...runtimeScores);
    return { score: round(Math.max(0, 100 - spread), 1), sampleCount: runs.length };
  }

  const labels = runs.map((run) => run.weakLabel).filter((value): value is number => value != null);
  if (labels.length < 3) {
    return { score: null, sampleCount: labels.length };
  }
  const average = mean(labels) ?? 0;
  const deviation = Math.sqrt(labels.reduce((sum, value) => sum + (value - average) ** 2, 0) / labels.length);
  return { score: round(100 * (1 - Math.min(1, deviation)), 1), sampleCount: labels.length };
}

function efficiencyScore(runs: readonly AnalyzedRun[]) {
  if (runs.length === 0) {
    return { score: null, sampleCount: 0 };
  }

  const reworked = runs.filter((run) =>
    run.passiveSignals.includes("regenerated") || run.passiveSignals.includes("retried"),
  ).length;
  const reworkComponent = 1 - reworked / runs.length;

  const latencies = runs
    .map((run) => run.latencyMs)
    .filter((value): value is number => value != null && value > 0)
    .sort((left, right) => left - right);

  if (latencies.length < 5) {
    return { score: round(reworkComponent * 100, 1), sampleCount: runs.length };
  }

  const p90 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.9))] ?? 1;
  const latencyComponent = (median(latencies) ?? p90) / p90;
  return { score: round((0.5 * reworkComponent + 0.5 * latencyComponent) * 100, 1), sampleCount: runs.length };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key == null) {
      continue;
    }
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

function runsBetween(runs: readonly AnalyzedRun[], fromMs: number, toMs: number): AnalyzedRun[] {
  return runs.filter((run) => {
    const at = Date.parse(run.startedAt);
    return at >= fromMs && at < toMs;
  });
}

/** Difference in core score between the latest window and the one before it. */
export function computeTrend(runs: readonly AnalyzedRun[], windowDays: number, now: Date): number | null {
  const end = now.getTime();
  const windowMs = windowDays * DAY_MS;
  const current = coreScore(runsBetween(runs, end - windowMs, end + 1));
  const previous = coreScore(runsBetween(runs, end - 2 * windowMs, end - windowMs));
  return current == null || previous == null ? null : round(current - previous, 1);
}

export function computeHealthDimensions(
  runs: readonly AnalyzedRun[],
  context: HealthContext,
): HealthDimension[] {
  const computed: Record<HealthDimensionKey, { score: number | null; sampleCount: number }> = {
    "task-success": taskSuccessScore(runs),
    "human-acceptance": acceptanceScore(runs),
    "eval-benchmark": { score: context.evalBenchmark, sampleCount: context.evalBenchmark == null ? 0 : 1 },
    "policy-compliance": policyComplianceScore(runs),
    consistency: consistencyScore(runs),
    efficiency: efficiencyScore(runs),
    "regression-stability": {
      score: context.regressionStability,
      sampleCount: context.regressionStability == null ? 0 : 1,
    },
  };

  return (Object.keys(HEALTH_DIMENSION_LABELS) as HealthDimensionKey[]).map((key) => ({
    key,
    label: HEALTH_DIMENSION_LABELS[key],
    score: computed[key].score,
    sampleCount: computed[key].sampleCount,
  }));
}

export function computeCompositeHealth(dimensions: readonly HealthDimension[]): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const dimension of dimensions) {
    if (dimension.score == null) {
      continue;
    }
    weighted += dimension.score * DIMENSION_WEIGHTS[dimension.key];
    totalWeight += DIMENSION_WEIGHTS[dimension.key];
  }
  return totalWeight > 0 ? round(weighted / totalWeight, 0) : null;
}

export function computeSkillHealth(
  skillId: string,
  runs: readonly AnalyzedRun[],
  context: HealthContext,
): SkillHealthSnapshot {
  const now = context.now ?? new Date();
  const dimensions = computeHealthDimensions(runs, context);
  const fullRuns = runs.filter((run) => run.telemetryLevel === "full").length;

  return {
    skillId,
    composite: computeCompositeHealth(dimensions),
    dimensions,
    trend7d: computeTrend(runs, 7, now),
    trend30d: computeTrend(runs, 30, now),
    runCount: runs.length,
    fullTrajectoryCoverage: percentage(fullRuns, runs.length) ?? 0,
    computedAt: now.toISOString(),
  };
}

const COHORT_KEYS: Record<CohortType, (run: AnalyzedRun) => string | null> = {
  runtime: (run) => run.runtime,
  model: (run) => run.model,
  "skill-version": (run) => run.skillVersionId,
  "task-archetype": (run) => run.taskArchetype,
  connector: (run) => run.connectorId,
  "business-unit": (run) => run.businessUnit,
  "input-structure": (run) => run.inputStructure,
};

/**
 * Technical cohorts only. Demographic or sensitive-person attributes are
 * deliberately not representable here.
 */
export function computeCohorts(
  runs: readonly AnalyzedRun[],
  cohortTypes: readonly CohortType[] = ["runtime", "model", "skill-version", "task-archetype"],
): CohortScore[] {
  const overall = coreScore(runs);
  const cohorts: CohortScore[] = [];

  for (const cohortType of cohortTypes) {
    const groups = groupBy(runs, COHORT_KEYS[cohortType]);
    if (groups.size < 2 && cohortType !== "runtime") {
      continue;
    }

    for (const [cohortKey, group] of groups) {
      const score = coreScore(group);
      cohorts.push({
        cohortType,
        cohortKey,
        score,
        runCount: group.length,
        flagged: overall != null
          && score != null
          && group.length >= COHORT_MIN_RUNS
          && score < overall - COHORT_FLAG_MARGIN,
      });
    }
  }

  return cohorts.sort((left, right) =>
    left.cohortType === right.cohortType
      ? right.runCount - left.runCount
      : left.cohortType.localeCompare(right.cohortType),
  );
}

export function computeTelemetryCoverage(runs: readonly Pick<AnalyzedRun, "runtime" | "telemetryLevel">[]): TelemetryCoverageRow[] {
  const byRuntime = groupBy(runs, (run) => run.runtime);
  const rows: TelemetryCoverageRow[] = [];

  for (const [runtime, group] of byRuntime) {
    const levelCounts: Record<TelemetryLevel, number> = { full: 0, io: 0, outcome: 0 };
    for (const run of group) {
      levelCounts[run.telemetryLevel] += 1;
    }
    const dominantLevel = (["full", "io", "outcome"] as const).reduce((best, level) =>
      levelCounts[level] > levelCounts[best] ? level : best,
    );
    rows.push({
      runtime: runtime as SkillRuntime,
      runCount: group.length,
      dominantLevel,
      coveragePct: percentage(levelCounts[dominantLevel], group.length) ?? 0,
      levelCounts,
    });
  }

  return rows.sort((left, right) => right.runCount - left.runCount);
}

/** Median fraction of output edited before use, over runs that report it. */
export function medianEditRatio(runs: readonly AnalyzedRun[]): number | null {
  const ratios = runs.map((run) => run.editRatio).filter((value): value is number => value != null);
  const value = median(ratios);
  return value == null ? null : round(value, 3);
}
