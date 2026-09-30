import type { ControlPlaneResponseMeta } from "./control-plane";

export type AssessmentSeverity = "blocker" | "warning" | "info";

export type AssessmentFindingStatus = "open" | "dismissed" | "proposed";

export type AssessmentFixKind =
  | "create_directory_readme"
  | "create_registry_file"
  | "register_skill"
  | "add_owner_entry"
  | "scaffold_skill_file"
  | "complete_metadata"
  | "scaffold_eval"
  | "update_eval_baseline";

export interface AssessmentFinding {
  /** Stable across syncs: code + scope + path. Dismissals are keyed on it. */
  fingerprint: string;
  code: string;
  severity: AssessmentSeverity;
  scope: "repository" | "skill";
  skillId: string | null;
  path: string | null;
  title: string;
  detail: string;
  remediation: string;
  fix: { kind: AssessmentFixKind; description: string } | null;
  status: AssessmentFindingStatus;
}

export interface AssessmentSummary {
  score: number;
  blockers: number;
  warnings: number;
  infos: number;
  skillsDiscovered: number;
  skillsIndexed: number;
  skillsSkipped: number;
  fixable: number;
}

export interface RepositoryAssessment {
  id: string;
  repositoryId: string;
  commitSha: string;
  createdAt: string;
  summary: AssessmentSummary;
  findings: AssessmentFinding[];
}

export type ChangeProposalStatus =
  | "pending_approval"
  | "opening_pr"
  | "pr_open"
  | "merged"
  | "closed"
  | "failed"
  | "rejected";

export interface ChangeProposalFile {
  path: string;
  action: "create" | "update";
  /** Content Savant read from the repository when the proposal was made (updates only). */
  previousContent: string | null;
  content: string;
}

export interface ChangeProposal {
  id: string;
  repositoryId: string;
  title: string;
  body: string;
  status: ChangeProposalStatus;
  files: ChangeProposalFile[];
  findingFingerprints: string[];
  baseBranch: string;
  headBranch: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  error: string | null;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryAssessmentResponse {
  data: { assessment: RepositoryAssessment | null; proposals: ChangeProposal[] };
  meta: ControlPlaneResponseMeta;
}

export interface ChangeProposalResponse {
  data: ChangeProposal;
  meta: ControlPlaneResponseMeta;
}
