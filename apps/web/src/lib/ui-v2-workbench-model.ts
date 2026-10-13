import type { SkillSourcePayload } from "@savant/types";
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
