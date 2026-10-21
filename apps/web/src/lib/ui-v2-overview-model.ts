import type { EvaluationRunListItem, OverviewPayload, SkillListItem } from "@savant/types";
import { getUiV2RepositoryHealth } from "./ui-v2-library-model.ts";

/** A priority queue derived only from observed control-plane incidents. */
export type UiV2Attention = {
  id: string; kind: "regression" | "repository" | "approval";
  priority: "P1" | "P2" | "Decision"; title: string; detail: string;
};
export function buildUiV2Attention(overview: OverviewPayload): UiV2Attention[] {
  const regressions = overview.regressions.map((reg, i) => ({
    id: `regression-${i}`, kind: "regression" as const,
    priority: reg.severity === "critical" ? "P1" as const : "P2" as const,
    title: reg.skill, detail: `${reg.metric}: ${reg.from} → ${reg.to}${reg.unit ?? ""}`,
  }));
  const repositories = overview.repositories.filter(repo =>
    getUiV2RepositoryHealth(repo) === "action-required").map(repo => ({
    id: `repository-${repo.id}`, kind: "repository" as const, priority: "P2" as const,
    title: repo.name, detail: repo.syncMessage ?? "Repository connection needs attention",
  }));
  const approvals = overview.approvals.map(ap => ({
    id: `approval-${ap.id}`, kind: "approval" as const, priority: "Decision" as const,
    title: ap.skill, detail: ap.blocking,
  }));
  return [...regressions, ...repositories, ...approvals]
    .sort((a,b) => ({ P1:0, P2:1, Decision:2 })[a.priority] -
      ({ P1:0, P2:1, Decision:2 })[b.priority]);
}

export function medianObservedQuality(skills: readonly SkillListItem[]): number | null {
  const values = skills.map(skill => skill.score)
    .filter((score): score is number => score !== null && Number.isFinite(score))
    .sort((a,b) => a - b);
  if (values.length === 0) return null;
  const half = Math.floor(values.length / 2);
  return values.length % 2 ? values[half]! : (values[half - 1]! + values[half]!) / 2;
}

export function observedInFlight(runs: readonly EvaluationRunListItem[]): EvaluationRunListItem[] {
  return runs.filter(run => run.status === "running");
}
