// Improvement trigger engine and minimum-evidence gate. SkillOpt never runs on
// every execution; Savant decides when there is enough evidence to justify an
// optimization job.

import type {
  AutoOptimizationMode,
  EvidenceThresholds,
  FailureCluster,
  ImprovementTrigger,
  OptimizationEligibility,
  SkillTier,
  TriggerFinding,
} from "@savant/types";

import { computeTrend, isFailureRun, medianEditRatio, type AnalyzedRun } from "./health.ts";
import { resolveTierThresholds } from "./policy.ts";

/** Share of distinct tasks the curation stage reserves for validation. */
export const VALIDATION_PARTITION_SHARE = 0.2;

export type TriggerConfig = {
  degradationThreshold: number;
  highEditRateThreshold: number;
  newEnvironmentMinRuns: number;
  highUseRunsPer30d: number;
};

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  degradationThreshold: 5,
  highEditRateThreshold: 0.15,
  newEnvironmentMinRuns: 5,
  highUseRunsPer30d: 200,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function countDistinctTasks(runs: readonly AnalyzedRun[]): number {
  return new Set(runs.map((run) => run.inputFingerprint ?? run.runId)).size;
}

export function detectTriggers(input: {
  runs: readonly AnalyzedRun[];
  clusters: readonly FailureCluster[];
  thresholds: EvidenceThresholds;
  lastOptimizationAt: string | null;
  now?: Date;
  config?: TriggerConfig;
}): TriggerFinding[] {
  const now = input.now ?? new Date();
  const config = input.config ?? DEFAULT_TRIGGER_CONFIG;
  const findings: TriggerFinding[] = [];

  const trend7d = computeTrend(input.runs, 7, now);
  if (trend7d != null && trend7d <= -config.degradationThreshold) {
    findings.push({
      trigger: "performance-degradation",
      detail: `7-day task success dropped ${Math.abs(trend7d).toFixed(1)} points (threshold ${config.degradationThreshold}).`,
      severity: trend7d <= -2 * config.degradationThreshold ? "high" : "medium",
    });
  }

  for (const cluster of input.clusters) {
    if (cluster.clusterId === "uncategorized") {
      continue;
    }
    if (cluster.runCount >= input.thresholds.minFailureExamples && cluster.distinctTasks >= 3) {
      findings.push({
        trigger: "failure-cluster",
        detail: `${cluster.runCount} similar failures ("${cluster.label}") across ${cluster.distinctTasks} distinct tasks.`,
        severity: cluster.share >= 40 ? "high" : "medium",
      });
    }
  }

  const editRatio = medianEditRatio(input.runs);
  if (editRatio != null && editRatio > config.highEditRateThreshold) {
    findings.push({
      trigger: "high-edit-rate",
      detail: `Median human revision is ${(editRatio * 100).toFixed(0)}% (threshold ${(config.highEditRateThreshold * 100).toFixed(0)}%).`,
      severity: editRatio > 2 * config.highEditRateThreshold ? "high" : "medium",
    });
  }

  const recentCutoff = now.getTime() - 7 * DAY_MS;
  const older = input.runs.filter((run) => Date.parse(run.startedAt) < recentCutoff);
  if (older.length > 0) {
    const seen = new Set(older.flatMap((run) => [`runtime:${run.runtime}`, run.model ? `model:${run.model}` : null]).filter(Boolean));
    const recentCounts = new Map<string, number>();
    for (const run of input.runs) {
      if (Date.parse(run.startedAt) < recentCutoff) {
        continue;
      }
      for (const key of [`runtime:${run.runtime}`, run.model ? `model:${run.model}` : null]) {
        if (key && !seen.has(key)) {
          recentCounts.set(key, (recentCounts.get(key) ?? 0) + 1);
        }
      }
    }
    for (const [key, count] of recentCounts) {
      if (count >= config.newEnvironmentMinRuns) {
        const [kind, value] = key.split(":");
        findings.push({
          trigger: "new-environment",
          detail: `Skill began running on a new ${kind} (${value}) with ${count} runs this week.`,
          severity: "low",
        });
      }
    }
  }

  const runsLast30d = input.runs.filter((run) => Date.parse(run.startedAt) >= now.getTime() - 30 * DAY_MS).length;
  const cadenceDays = runsLast30d >= config.highUseRunsPer30d ? 7 : 30;
  const last = input.lastOptimizationAt ? Date.parse(input.lastOptimizationAt) : null;
  if (runsLast30d > 0 && (last == null || now.getTime() - last >= cadenceDays * DAY_MS)) {
    findings.push({
      trigger: "scheduled",
      detail: cadenceDays === 7
        ? "Weekly optimization window for a high-use skill."
        : "Monthly optimization window for a low-use skill.",
      severity: "low",
    });
  }

  return findings;
}

const TRIGGER_PRIORITY: ImprovementTrigger[] = [
  "performance-degradation",
  "failure-cluster",
  "high-edit-rate",
  "new-environment",
  "scheduled",
  "manual",
];

export function primaryTrigger(findings: readonly TriggerFinding[]): ImprovementTrigger | null {
  for (const trigger of TRIGGER_PRIORITY) {
    if (findings.some((finding) => finding.trigger === trigger)) {
      return trigger;
    }
  }
  return null;
}

export function evaluateOptimizationEligibility(input: {
  runs: readonly AnalyzedRun[];
  clusters: readonly FailureCluster[];
  tier: SkillTier;
  thresholds: EvidenceThresholds;
  /** Authored eval cases that can serve as held-out validation. */
  authoredEvalCases: number;
  telemetryDisabled: boolean;
  providerBlocker: string | null;
  lastOptimizationAt: string | null;
  now?: Date;
}): OptimizationEligibility {
  const thresholds = resolveTierThresholds(input.thresholds, input.tier);
  const distinctTasks = countDistinctTasks(input.runs);
  const failureExamples = input.runs.filter(isFailureRun).length;
  const heldOutCandidates = Math.floor(distinctTasks * VALIDATION_PARTITION_SHARE) + input.authoredEvalCases;
  const blockers: string[] = [];

  if (input.telemetryDisabled) {
    blockers.push("Optimization telemetry is disabled for this skill.");
  }
  if (input.providerBlocker) {
    blockers.push(input.providerBlocker);
  }
  if (input.runs.length < thresholds.minRuns) {
    blockers.push(`Needs ${thresholds.minRuns} runs (has ${input.runs.length}).`);
  }
  if (distinctTasks < thresholds.minDistinctTasks) {
    blockers.push(`Needs ${thresholds.minDistinctTasks} distinct tasks (has ${distinctTasks}).`);
  }
  if (failureExamples < thresholds.minFailureExamples) {
    blockers.push(`Needs ${thresholds.minFailureExamples} failure examples (has ${failureExamples}).`);
  }
  if (heldOutCandidates < thresholds.minHeldOutCases) {
    blockers.push(`Needs ${thresholds.minHeldOutCases} held-out cases (has ${heldOutCandidates}).`);
  }

  const triggerInput: Parameters<typeof detectTriggers>[0] = {
    runs: input.runs,
    clusters: input.clusters,
    thresholds,
    lastOptimizationAt: input.lastOptimizationAt,
  };
  if (input.now) {
    triggerInput.now = input.now;
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    thresholds,
    observed: {
      runs: input.runs.length,
      distinctTasks,
      failureExamples,
      heldOutCandidates,
    },
    triggers: input.telemetryDisabled ? [] : detectTriggers(triggerInput),
  };
}

/** Whether Savant should enqueue a job on its own, without a human click. */
export function shouldAutoEnqueue(input: {
  mode: AutoOptimizationMode;
  eligibility: OptimizationEligibility;
  hasActiveJob: boolean;
  hasOpenRecommendation: boolean;
}): boolean {
  if (input.mode !== "recommend" && input.mode !== "continuous-evaluation") {
    return false;
  }
  if (input.hasActiveJob || input.hasOpenRecommendation || !input.eligibility.eligible) {
    return false;
  }
  return input.eligibility.triggers.some((finding) => finding.trigger !== "scheduled" || input.mode === "continuous-evaluation");
}
