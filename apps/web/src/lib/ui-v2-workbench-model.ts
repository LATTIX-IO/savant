import type { SkillDetailPayload, SkillSourcePayload } from "@savant/types";
import { MAX_SKILL_SOURCE_LENGTH } from "./skill-builder.ts";

export type WorkbenchGate =
  | { kind: "not-loaded" | "read-only" | "unchanged" | "invalid" | "ready"; message: string };

export function getWorkbenchGate(source: SkillSourcePayload | null, draft: string): WorkbenchGate {
  if (!source) return { kind: "not-loaded", message: "Load a verified repository source before editing." };
  if (source.mode !== "repository" || !source.canSave) {
    return { kind: "read-only", message: source.saveDisabledReason || "This skill source is read-only." };
  }
  // Legacy direct-commit writes currently lack an expected-commit precondition.
  // Never expose the unsafe write path through the new workbench.
  if (source.saveMode !== "proposal" || !source.repositoryId) {
    return { kind: "read-only", message: "Reviewable change proposals are required. This repository connection supports only an unversioned direct commit." };
  }
  if (draft === source.content) return { kind: "unchanged", message: "No changes to propose." };
  if (!draft.trim() || draft.length > MAX_SKILL_SOURCE_LENGTH) {
    return { kind: "invalid", message: "SKILL.md must contain meaningful content and be at most 200,000 characters." };
  }
  return { kind: "ready", message: "Creates a change proposal requiring approval; does not commit or merge." };
}

export function matchesWorkbenchSourceSnapshot(expected: SkillSourcePayload, actual: SkillSourcePayload): boolean {
  return expected.skillId === actual.skillId &&
    expected.skillUuid === actual.skillUuid &&
    expected.repositoryId === actual.repositoryId &&
    expected.sourcePath === actual.sourcePath &&
    expected.branch === actual.branch &&
    expected.sourceCommitSha === actual.sourceCommitSha &&
    expected.contentSha === actual.contentSha &&
    expected.content === actual.content &&
    actual.mode === "repository" &&
    actual.canSave === true &&
    actual.saveMode === "proposal";
}

export function workbenchChangeStats(base: string, draft: string): {
  originalLines: number; proposedLines: number; changed: boolean;
} {
  return {
    originalLines: base.split("\n").length,
    proposedLines: draft.split("\n").length,
    changed: base !== draft,
  };
}

export function sourceRevisionLabel(source: SkillSourcePayload | null): string {
  if (!source || source.mode !== "repository") return "Source not verified";
  return source.sourceCommitSha || "Commit not reported";
}

export type WorkbenchSubmission =
  | { kind: "created"; proposalId: string; status: string }
  | { kind: "blocked"; reason: "read-only" | "stale" | "context-changed"; message: string };

/**
 * Checks the exact server-backed source before dispatch. Provider-side
 * approval/merge still owns final concurrency and write authorization.
 */
export async function submitReviewedWorkbenchProposal(options: {
  source: SkillSourcePayload;
  draft: string;
  isCurrent: () => boolean;
  readCurrentSource: () => Promise<SkillSourcePayload>;
  createProposal: (input: { repositoryId: string; name: string; path: string; content: string }) =>
    Promise<{ id: string; status: string }>;
}): Promise<WorkbenchSubmission> {
  const gate = getWorkbenchGate(options.source, options.draft);
  if (gate.kind !== "ready" || !options.source.repositoryId) {
    return { kind: "blocked", reason: "read-only", message: gate.message };
  }
  if (!options.isCurrent()) {
    return { kind: "blocked", reason: "context-changed", message: "Workbench context changed. No proposal was submitted." };
  }
  const latest = await options.readCurrentSource();
  if (!options.isCurrent()) {
    return { kind: "blocked", reason: "context-changed", message: "Workbench context changed. No proposal was submitted." };
  }
  if (!matchesWorkbenchSourceSnapshot(options.source, latest)) {
    return { kind: "blocked", reason: "stale",
      message: "Repository source changed. No proposal was submitted. Reload and reconcile your draft." };
  }
  const created = await options.createProposal({
    repositoryId: options.source.repositoryId,
    name: options.source.name,
    path: options.source.sourcePath,
    content: options.draft,
  });
  return { kind: "created", proposalId: created.id, status: created.status };
}

/**
 * Read-only Canvas: relationships are at skill level, not source-commit-level.
 * Do not infer edges, tools, provider spans or a run's source revision.
 */
export type WorkbenchObservedCanvas = {
  source: { path: string; commit: string | null } | null;
  evaluations: ReadonlyArray<{
    id: string; dataset: string; ref: string; status: string; passed: number; cases: number;
  }>;
};
export function buildObservedWorkbenchCanvas(
  source: SkillSourcePayload | null, detail: SkillDetailPayload | null,
): WorkbenchObservedCanvas {
  if (!source || source.mode !== "repository") return { source: null, evaluations: [] };
  const related = detail?.skill.skillUuid === source.skillUuid ? detail.evaluations : [];
  return {
    source: { path: source.sourcePath, commit: source.sourceCommitSha },
    evaluations: related.slice(0, 12).map(run => ({
      id: run.id, dataset: run.dataset, ref: run.ref, status: run.status,
      passed: run.passed, cases: run.cases,
    })),
  };
}
