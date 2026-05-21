export type GitProvider =
  | "github"
  | "gitlab"
  | "azure"
  | "bitbucket"
  | "selfhosted"
  | (string & {});

export type SourceOfTruth = "git" | "database" | "derived-index" | "mixed";

export interface ControlPlaneResponseMeta {
  generatedAt: string;
  sourceOfTruth: SourceOfTruth;
  schemaVersion: 1;
}

export interface CollectionResponse<T> {
  data: T[];
  meta: ControlPlaneResponseMeta & {
    count: number;
  };
}

export interface ResourceResponse<T> {
  data: T;
  meta: ControlPlaneResponseMeta;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

export interface UserSummary {
  name: string;
  role: string;
  initials: string;
}

export interface OrganizationSummary {
  name: string;
  short: string;
  env: string;
  user: UserSummary;
}

export type RepositorySyncStatus = "ok" | "warn" | "stale";

export interface RepositoryListItem {
  id: string;
  provider: GitProvider;
  name: string;
  branch: string;
  skills: number;
  lastSync: string;
  status: RepositorySyncStatus;
}

export interface RepositoryCommitSummary {
  commit: string;
  who: string;
  when: string;
  msg: string;
}

export interface RepositoryDetailRecord {
  description: string;
  visibility: string;
  syncMode: string;
  webhookHealth: string;
  defaultBranch: string;
  protectedBranches: string[];
  tierPolicy: string;
  members: string[];
  skillsByTier: Record<1 | 2 | 3, number>;
  recentCommits: RepositoryCommitSummary[];
}

export interface RepositoryDetailPayload {
  repository: RepositoryListItem;
  details: RepositoryDetailRecord;
}

export interface ApprovalItem {
  id: string;
  skill: string;
  tier: string;
  version: string;
  change: string;
  who: string;
  when: string;
  blocking: string;
}

export interface RecentChangeItem {
  skill: string;
  ref: string;
  who: string;
  when: string;
  delta: string;
  env: string;
}

export type RegressionSeverity = "critical" | "moderate" | "minor";

export interface RegressionItem {
  skill: string;
  metric: string;
  from: number;
  to: number;
  severity: RegressionSeverity;
  unit?: string;
}

export type SkillTier = 1 | 2 | 3;

export interface SkillListItem {
  id: string;
  name: string;
  description: string;
  tier: SkillTier;
  owner: string;
  team: string;
  repo: string;
  repoProvider: GitProvider;
  ref: string;
  commit: string;
  branch: string;
  candidateRef: string;
  candidateCommit: string;
  versionCount: number;
  prodEnv: string;
  channel: string;
  score: number | null;
  trend: number[];
  accessGroup: string;
  lastEval: string;
  status: string;
}

export interface RubricComparisonRow {
  label: string;
  baseline: number;
  candidate: number;
  direction: "up" | "down";
}

export type TimelineNodeColor = "moss" | "brass" | "blood" | "slate";

export interface ApprovalTimelineItem {
  who: string;
  role: string;
  action: string;
  when: string;
  node: TimelineNodeColor;
}

export interface ReviewerComment {
  who: string;
  when: string;
  text: string;
}

export type EvaluationStatus =
  | "running"
  | "complete"
  | "complete-with-regressions"
  | "complete-baseline";

export interface EvalRunSummary {
  id: string;
  skill: string;
  ref: string;
  dataset: string;
  cases: number;
  passed: number;
  failed: number;
  started: string;
  duration: string;
  delta: number | null;
  status: EvaluationStatus;
}

export interface RequiredApprovalItem {
  role: string;
  assignee: string | null;
  status: "approved" | "pending";
  when: string | null;
}

export interface FlaggedCaseItem {
  caseId: string;
  description: string;
  rubric: string;
  baseline: number;
  candidate: number;
  delta: number;
}

export interface VersionHistoryItem {
  ref: string;
  commit: string;
  who: string;
  when: string;
  channel: "candidate" | "production" | "archived";
  score: number;
  delta: number;
}

export interface AccessGrantItem {
  name: string;
  members: number;
  permission: string;
  source: string;
  lastSync: string;
}

export interface AccessPolicyRuleItem {
  rule: string;
  value: string;
}

export interface ActivityEventItem {
  when: string;
  who: string;
  action: string;
  target: string;
  node: TimelineNodeColor;
}

export type ReleaseEnvironment = "draft" | "staging" | "production";

export interface ReleaseReadinessItem {
  label: string;
  ok: boolean | null;
  meta: string;
}

export interface ReleaseQueueItem {
  id: string;
  skill: string;
  candidateRef: string;
  candidateCommit: string;
  fromEnv: ReleaseEnvironment;
  toEnv: ReleaseEnvironment;
  requested: string;
  when: string;
  approvalsDone: number;
  approvalsRequired: number;
  approvalsBlocked: string | null;
  readinessPct: number;
  readiness: ReleaseReadinessItem[];
  targets: string[];
}

export interface AuditHighlightItem {
  when: string;
  who: string;
  action: string;
  target: string;
  node: TimelineNodeColor;
}

export interface OverviewKpi {
  key:
    | "skills-in-production"
    | "eval-coverage"
    | "first-pass-acceptance"
    | "release-turnaround";
  label: string;
  value: number;
  unit?: "%" | "d";
  deltaLabel: string;
  trend: "up" | "down" | "flat";
}

export interface OverviewPayload {
  organization: OrganizationSummary;
  counts: {
    skillsUnderGovernance: number;
    pendingApprovals: number;
    activeRegressionAlerts: number;
    connectedRepositories: number;
  };
  kpis: OverviewKpi[];
  approvals: ApprovalItem[];
  recentChanges: RecentChangeItem[];
  regressions: RegressionItem[];
  repositories: RepositoryListItem[];
  auditHighlights: AuditHighlightItem[];
  releaseQueue: ReleaseQueueItem[];
}

export interface SkillDetailPayload {
  skill: SkillListItem;
  evaluations: EvalRunSummary[];
  rubricBaseline: RubricComparisonRow[];
  approvalTimeline: ApprovalTimelineItem[];
  requiredApprovals: RequiredApprovalItem[];
  reviewerComments: ReviewerComment[];
  flaggedCases: FlaggedCaseItem[];
  versionHistory: VersionHistoryItem[];
  accessGrants: AccessGrantItem[];
  accessPolicyRules: AccessPolicyRuleItem[];
  activityLog: ActivityEventItem[];
  activeRelease: ReleaseQueueItem | null;
  auditHighlights: AuditHighlightItem[];
}

export interface ReleaseHistoryItem {
  ref: string;
  skill: string;
  env: string;
  who: string;
  when: string;
  outcome: string;
}

export type PolicyType = "access" | "approval" | "distribution" | "environment";

export interface PolicyRuleItem {
  rule: string;
  value: string;
}

export interface PolicySummary {
  id: string;
  name: string;
  type: PolicyType;
  scope: string;
  state: "active" | "draft";
  affects: number;
  appliedBy: string;
  updated: string;
  rules: PolicyRuleItem[];
}

export type AuditCategory =
  | "approval"
  | "release"
  | "evaluation"
  | "access"
  | "version"
  | "policy"
  | "repo"
  | "review";

export interface AuditEventRecord {
  when: string;
  time: string;
  who: string;
  action: string;
  target: string;
  category: AuditCategory;
  node: TimelineNodeColor;
}

export type ConnectorCategory = "local" | "native" | "notify" | "bundle";
export type ConnectorStatus = "healthy" | "degraded" | "warning" | "offline";

export interface ConnectorRecord {
  id: string;
  name: string;
  category: ConnectorCategory;
  kind: string;
  status: ConnectorStatus;
  lastSync: string;
  version: string;
  skills: number | string;
  users: number | string;
  scope: string;
}

export interface MemberRecord {
  name: string;
  email: string;
  role: string;
  groups: string[];
  status: "active" | "off-boarded";
  last: string;
}

export type OverviewResponse = ResourceResponse<OverviewPayload>;
export type RepositoryListResponse = CollectionResponse<RepositoryListItem>;
export type RepositoryDetailResponse = ResourceResponse<RepositoryDetailPayload>;
export type SkillListResponse = CollectionResponse<SkillListItem>;
export type SkillDetailResponse = ResourceResponse<SkillDetailPayload>;