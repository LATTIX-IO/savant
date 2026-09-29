// Deterministic failure clustering. Clusters come from structured signals —
// explicit feedback categories, rubric dimensions, and run metadata — rather
// than an LLM inventing groupings. Anything left over is reported as
// "uncategorized" so reviewers can see what the clusters do not explain.

import type { FailureCluster, FailureClusterBasis, SkillRuntime } from "@savant/types";

import { FEEDBACK_CATEGORY_LABELS } from "./feedback-signals.ts";
import { isFailureRun, type AnalyzedRun } from "./health.ts";
import { round } from "./statistics.ts";

export const MIN_CLUSTER_SIZE = 3;
const MAX_EXAMPLES = 8;

type ClusterAccumulator = {
  clusterId: string;
  label: string;
  basis: FailureClusterBasis;
  runs: AnalyzedRun[];
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function add(map: Map<string, ClusterAccumulator>, key: string, init: Omit<ClusterAccumulator, "runs">, run: AnalyzedRun) {
  const existing = map.get(key);
  if (existing) {
    existing.runs.push(run);
    return;
  }
  map.set(key, { ...init, runs: [run] });
}

function distinctTaskCount(runs: readonly AnalyzedRun[]): number {
  return new Set(runs.map((run) => run.inputFingerprint ?? run.runId)).size;
}

export function clusterFailures(runs: readonly AnalyzedRun[]): FailureCluster[] {
  const failures = runs.filter(isFailureRun);
  if (failures.length === 0) {
    return [];
  }

  const clusters = new Map<string, ClusterAccumulator>();
  const explained = new Set<string>();

  for (const run of failures) {
    for (const dimension of run.rubricFailures) {
      add(clusters, `rubric:${dimension}`, {
        clusterId: `rubric-${slug(dimension)}`,
        label: `Rubric: ${dimension}`,
        basis: "rubric-dimension",
      }, run);
      explained.add(run.runId);
    }

    for (const category of run.feedbackCategories) {
      if (category === "good-result") {
        continue;
      }
      add(clusters, `category:${category}`, {
        clusterId: `category-${category}`,
        label: FEEDBACK_CATEGORY_LABELS[category],
        basis: "feedback-category",
      }, run);
      explained.add(run.runId);
    }
  }

  // Metadata clusters: unexplained failures concentrated in one runtime + task archetype.
  const unexplained = failures.filter((run) => !explained.has(run.runId));
  const metadataGroups = new Map<string, AnalyzedRun[]>();
  for (const run of unexplained) {
    const key = `${run.runtime}|${run.taskArchetype ?? "any"}`;
    metadataGroups.set(key, [...(metadataGroups.get(key) ?? []), run]);
  }

  for (const [key, group] of metadataGroups) {
    if (group.length < MIN_CLUSTER_SIZE) {
      continue;
    }
    const [runtime, archetype] = key.split("|");
    clusters.set(`metadata:${key}`, {
      clusterId: `metadata-${slug(key)}`,
      label: archetype && archetype !== "any"
        ? `Unlabelled failures on ${runtime} · ${archetype}`
        : `Unlabelled failures on ${runtime}`,
      basis: "metadata",
      runs: group,
    });
  }

  const results: FailureCluster[] = [];
  const covered = new Set<string>();
  for (const cluster of clusters.values()) {
    if (cluster.runs.length < MIN_CLUSTER_SIZE) {
      continue;
    }
    for (const run of cluster.runs) {
      covered.add(run.runId);
    }
    results.push(toFailureCluster(cluster, failures.length));
  }

  results.sort((left, right) => right.runCount - left.runCount || left.label.localeCompare(right.label));

  const uncategorized = failures.filter((run) => !covered.has(run.runId));
  if (uncategorized.length > 0) {
    results.push(toFailureCluster({
      clusterId: "uncategorized",
      label: "Uncategorized",
      basis: "metadata",
      runs: uncategorized,
    }, failures.length));
  }

  return results;
}

function toFailureCluster(cluster: ClusterAccumulator, totalFailures: number): FailureCluster {
  const runtimes = [...new Set(cluster.runs.map((run) => run.runtime))].sort() as SkillRuntime[];
  return {
    clusterId: cluster.clusterId,
    label: cluster.label,
    basis: cluster.basis,
    runCount: cluster.runs.length,
    distinctTasks: distinctTaskCount(cluster.runs),
    runtimes,
    exampleRunIds: cluster.runs.slice(0, MAX_EXAMPLES).map((run) => run.runId),
    share: round((cluster.runs.length / totalFailures) * 100, 1),
  };
}
