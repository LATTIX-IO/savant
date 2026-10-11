/** Canonical, non-executable reference across Savant authored and observed capabilities. */
export type CapabilityArtifactKind =
  | "skill" | "plugin" | "agent" | "tool" | "model" | "mcp" | "knowledge" | "instruction"
  | "workflow_spec" | "test_suite" | "eval_run" | "experiment" | "scorecard"
  | "quality_gate" | "runtime_observation";

export interface CapabilityGitLocator {
  source: "git";
  /** Savant tenant-scoped repository UUID or opaque identifier; never the remote URL. */
  repositoryId: string;
  /** Repo-relative file path with no traversal. */
  path: string;
  /** Pinned immutable Git commit, distinct from the canonical SHA-256 content hash. */
  commitSha: string;
}
export interface CapabilityDatabaseLocator {
  source: "database";
  /** Opaque, tenant-scoped operational run/reference ID. */
  recordId: string;
}
export type CapabilityLocator = CapabilityGitLocator | CapabilityDatabaseLocator;

export interface CapabilityReferenceV1 {
  schemaVersion: 1;
  kind: CapabilityArtifactKind;
  organizationId: string;
  artifactId: string;
  /** Strict SemVer; never infer a version from a branch or label. */
  version: string;
  /** Optional only for pre-digest legacy references; no synthetic digest is permitted. */
  contentHash?: string;
  locator: CapabilityLocator;
  /** Preserves provider metadata but is never interpreted as code or instructions. */
  extensions?: Record<string, unknown>;
}
export type CapabilityRelation = "depends_on" | "evaluates" | "observes" | "derived_from";
export interface CapabilityLinkV1 {
  relation: CapabilityRelation;
  from: CapabilityReferenceV1;
  to: CapabilityReferenceV1;
}
export interface CapabilityLossEntry {
  code: "version_unrecognized" | "repository_missing" | "commit_missing" | "digest_missing" | "path_missing";
  description: string;
}
export type CapabilityProjection =
  | { status: "ready"; reference: CapabilityReferenceV1; lossReport: CapabilityLossEntry[] }
  | { status: "unavailable"; reason: "version_invalid" | "identity_invalid" | "revision_invalid" | "digest_invalid" };
export type LegacySkillMigration =
  | { status: "ready"; reference: CapabilityReferenceV1; lossReport: CapabilityLossEntry[] }
  | { status: "unresolved"; original: Record<string, unknown>; lossReport: CapabilityLossEntry[] };
