import type { RepositoryProviderReadiness } from "./repository-provider-readiness";

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

export interface RepositoryProjectionMetadata {
  indexedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastWebhookAt: string | null;
}

export interface RepositoryListItem {
  id: string;
  provider: GitProvider;
  providerReadiness: RepositoryProviderReadiness;
  name: string;
  webUrl: string | null;
  branch: string;
  skills: number;
  lastSync: string;
  status: RepositorySyncStatus;
  projection: RepositoryProjectionMetadata;
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

export interface SkillProjectionMetadata {
  sourcePath: string | null;
  sourceCommitSha: string | null;
  indexedAt: string | null;
}

export interface SkillListItem {
  id: string;
  skillUuid: string;
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
  projection: SkillProjectionMetadata;
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
  | "complete-baseline"
  | "failed";

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

export interface EvaluationRunListItem extends EvalRunSummary {
  skillId: string;
  skillTier: SkillTier;
  startedAt: string | null;
  passRate: number;
}

export type EvaluationDashboardMetricKey =
  | "coverage"
  | "avg-cases"
  | "regressions-24h"
  | "median-pass-rate";

export type EvaluationDashboardMetricTrend = "up" | "down" | "flat";

export interface EvaluationDashboardMetric {
  key: EvaluationDashboardMetricKey;
  label: string;
  value: number;
  trendLabel: string;
  trend: EvaluationDashboardMetricTrend;
  unit?: string | undefined;
  displayDecimals?: number | undefined;
}

export interface EvaluationTierCoverageItem {
  tier: SkillTier;
  evaluatedSkills: number;
  totalSkills: number;
  coveragePct: number;
}

export interface EvaluationDashboardPayload {
  kpis: EvaluationDashboardMetric[];
  runs: EvaluationRunListItem[];
  coverageByTier: EvaluationTierCoverageItem[];
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

export interface SkillSourcePayload {
  skillId: string;
  skillUuid: string;
  name: string;
  repository: string;
  repoProvider: GitProvider;
  branch: string;
  sourcePath: string;
  sourceCommitSha: string | null;
  contentSha: string | null;
  content: string;
  mode: "repository" | "fallback";
  canSave: boolean;
  saveDisabledReason?: string | undefined;
}

export interface SkillSourceUpdateRequest {
  content: string;
  commitMessage?: string | undefined;
  connectionId?: string | undefined;
}

export interface SkillSourceCommitSummary {
  sha: string;
  committedAt: string;
  url: string | null;
  changedPaths: string[];
}

export interface SkillSourceUpdatePayload {
  skillId: string;
  skillUuid: string;
  branch: string;
  sourcePath: string;
  commit: SkillSourceCommitSummary;
  warnings: string[];
}

export interface ReleaseHistoryItem {
  ref: string;
  skill: string;
  env: ReleaseEnvironment;
  who: string;
  when: string;
  outcome: "released" | "rolled-back";
}

export type ReleaseDashboardMetricKey =
  | "active-candidates"
  | "release-turnaround"
  | "rollbacks-30d"
  | "pinned-in-production";

export type ReleaseDashboardMetricTrend = "up" | "down" | "flat";

export interface ReleaseDashboardMetric {
  key: ReleaseDashboardMetricKey;
  label: string;
  value: number | null;
  unit?: "d" | undefined;
  displayDecimals?: number | undefined;
  trendLabel: string;
  trend: ReleaseDashboardMetricTrend;
}

export interface ReleaseDashboardPayload {
  kpis: ReleaseDashboardMetric[];
  inMotion: ReleaseQueueItem[];
  history: ReleaseHistoryItem[];
}

export type PolicyType = "access" | "approval" | "distribution" | "environment";

export interface PolicyRuleItem {
  rule: string;
  value: string;
}

export type PolicyActivityStatus = "allowed" | "blocked" | "info";

export interface PolicyActivityRecord {
  occurredAt: string;
  when: string;
  who: string;
  action: string;
  detail: string;
  status: PolicyActivityStatus;
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
  recentActivity: PolicyActivityRecord[];
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

export type AuditEventRange = "24h" | "7d" | "30d" | "90d" | "all";

export interface AuditEventRecord {
  occurredAt: string;
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

export type ConnectorDashboardMetricKey =
  | "active-connectors"
  | "enabled-targets"
  | "sync-runs-24h"
  | "issues";

export type ConnectorDashboardMetricTrend = "up" | "down" | "flat";

export interface ConnectorDashboardMetric {
  key: ConnectorDashboardMetricKey;
  label: string;
  value: number;
  trendLabel: string;
  trend: ConnectorDashboardMetricTrend;
}

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

export interface ConnectorDashboardPayload {
  kpis: ConnectorDashboardMetric[];
  connectors: ConnectorRecord[];
}

export interface MemberRecord {
  name: string;
  email: string;
  role: string;
  groups: string[];
  status: "active" | "off-boarded";
  last: string;
}

export type PublicAuthProvider = "auth0" | (string & {});
export type PublicAuthProviderStatus = "configured" | "development-bypass" | "unconfigured";

export interface PublicAuthProviderSettings {
  provider: PublicAuthProvider;
  status: PublicAuthProviderStatus;
  tenantDomain: string | null;
  clientId: string | null;
  appBaseUrl: string | null;
  callbackUrl: string | null;
  logoutUrl: string | null;
  applicationType: "regular_web";
  tokenEndpointAuthMethod: "client_secret_post";
  sessionMode: "server-side session";
}

export type AIProviderId = "openai" | "anthropic" | "azure-openai" | "openai-compatible" | (string & {});
export type AIConnectionStatus = "active" | "needs-rotation" | "revoked";

export interface AIConnectionSummary {
  aiConnectionUuid: string;
  provider: AIProviderId;
  label: string;
  defaultModel: string;
  purpose: string;
  status: AIConnectionStatus;
  lastUsed: string;
  lastRotated: string;
  secretStore: string;
  usageScope: string;
  supportsExecution: boolean;
  supportsJudging: boolean;
  isDefaultExecution: boolean;
  isDefaultJudge: boolean;
}

export interface AIConnectionCreateRequest {
  provider: AIProviderId;
  label: string;
  defaultModel: string;
  purpose: string;
  usageScope: string;
  apiKey: string;
  allowedModels?: string[] | undefined;
  supportsExecution?: boolean | undefined;
  supportsJudging?: boolean | undefined;
  isDefaultExecution?: boolean | undefined;
  isDefaultJudge?: boolean | undefined;
  baseUrl?: string | undefined;
  apiVersion?: string | undefined;
}

export interface AIConnectionRevokeRequest {
  reason?: string | undefined;
}

export interface AIConnectionRotateRequest {
  apiKey: string;
  defaultModel?: string | undefined;
  purpose?: string | undefined;
  usageScope?: string | undefined;
  allowedModels?: string[] | undefined;
  baseUrl?: string | undefined;
  apiVersion?: string | undefined;
}

export interface AIConnectionSetDefaultRequest {
  setAsExecutionDefault?: boolean | undefined;
  setAsJudgeDefault?: boolean | undefined;
}

export interface WorkspaceGeneralSettings {
  workspaceName: string;
  workspaceSlug: string;
  workspaceUrl: string;
  subdomain: string;
  defaultTier: SkillTier;
  timeZone: string;
  approvalRequirement: number;
  stagingBurnInHours: number;
  requireEvalSuite: boolean;
}

export interface WorkspaceSecuritySettings {
  bundleSigningKeyRef: string;
  bundleSigningKeyLastRotated: string;
  customerManagedKey: boolean;
  keyVaultProvider: string;
  auditRetentionYears: number;
  evalRetentionDays: number;
  streamToSiem: boolean;
}

export interface WorkspaceNotificationSettings {
  approvalRequestedChannels: string[];
  regressionDetectedChannels: string[];
  rollbackExecutedChannels: string[];
  policyViolationChannels: string[];
  weeklySummaryEnabled: boolean;
  weeklySummaryChannels: string[];
}

export interface WorkspaceBillingSettings {
  planName: string;
  billingCycle: string | null;
  renewalDate: string;
  skillsIncluded: number | null;
  activeSkills: number;
  includedSeats: number;
  usedSeats: number;
  evalRunCapMonthly: number | null;
  evalRunsUsedMonthly: number | null;
  distributionsMonthly: number | null;
  storageGbUsed: number | null;
  storageGbCap: number | null;
  apiCallsMonthly: number | null;
  apiCallsDeltaPct: number | null;
}

export interface WorkspaceSettingsPayload {
  general: WorkspaceGeneralSettings;
  authentication: PublicAuthProviderSettings;
  aiConnections: AIConnectionSummary[];
  members: MemberRecord[];
  security: WorkspaceSecuritySettings;
  notifications: WorkspaceNotificationSettings;
  billing: WorkspaceBillingSettings;
}

export type OverviewResponse = ResourceResponse<OverviewPayload>;
export type RepositoryListResponse = CollectionResponse<RepositoryListItem>;
export type RepositoryDetailResponse = ResourceResponse<RepositoryDetailPayload>;
export type SkillListResponse = CollectionResponse<SkillListItem>;
export type SkillDetailResponse = ResourceResponse<SkillDetailPayload>;
export type SkillSourceResponse = ResourceResponse<SkillSourcePayload>;
export type SkillSourceUpdateResponse = ResourceResponse<SkillSourceUpdatePayload>;
export type WorkspaceSettingsResponse = ResourceResponse<WorkspaceSettingsPayload>;
export type AIConnectionListResponse = CollectionResponse<AIConnectionSummary>;
export type AIConnectionResponse = ResourceResponse<AIConnectionSummary>;
export type AuditListResponse = CollectionResponse<AuditEventRecord>;
export type PolicyListResponse = CollectionResponse<PolicySummary>;
export type EvaluationDashboardResponse = ResourceResponse<EvaluationDashboardPayload>;
export type ReleaseDashboardResponse = ResourceResponse<ReleaseDashboardPayload>;
export type ConnectorDashboardResponse = ResourceResponse<ConnectorDashboardPayload>;