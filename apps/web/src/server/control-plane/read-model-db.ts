import { getRepositoryProviderReadiness } from "@savant/types";
import type {
  AccessGrantItem,
  AccessPolicyRuleItem,
  ActivityEventItem,
  AuditCategory,
  AuditEventRange,
  AuditEventRecord,
  ApiErrorResponse,
  ApprovalItem,
  ApprovalTimelineItem,
  AuditHighlightItem,
  AuditListResponse,
  ConnectorDashboardMetric,
  ConnectorDashboardResponse,
  ConnectorRecord,
  ConnectorCategory,
  ConnectorStatus,
  ControlPlaneResponseMeta,
  EvaluationDashboardMetric,
  EvaluationDashboardResponse,
  EvaluationRunListItem,
  EvaluationTierCoverageItem,
  EvalRunSummary,
  FlaggedCaseItem,
  OverviewKpi,
  OverviewPayload,
  OverviewResponse,
  PolicyActivityRecord,
  ReleaseDashboardMetric,
  ReleaseDashboardResponse,
  ReleaseHistoryItem,
  PolicyListResponse,
  PolicyRuleItem,
  PolicySummary,
  RegressionItem,
  ReleaseQueueItem,
  RepositoryCommitSummary,
  RepositoryDetailRecord,
  RepositoryDetailResponse,
  RepositoryListItem,
  RepositoryProjectionMetadata,
  RepositoryListResponse,
  RepositorySyncStatus,
  RequiredApprovalItem,
  ReviewerComment,
  RubricComparisonRow,
  SkillDetailPayload,
  SkillDetailResponse,
  SkillListItem,
  SkillListResponse,
  SkillProjectionMetadata,
  VersionHistoryItem,
} from "@savant/types";

import { getInitials } from "../../lib/auth0-session.ts";
import { buildRepositoryWebUrl } from "../../lib/repository-links.ts";
import { findSkillByIdentifier } from "../../lib/skill-paths.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";

export type TenantReadContext = {
  identity: {
    subject: string;
    email: string;
    displayName: string;
  } | null;
  tenant: {
    organizationId: string;
    workspaceName: string;
    workspaceSlug: string;
    isDefault: boolean;
    isLastUsed: boolean;
  };
  memberships: Array<{
    organizationId: string;
    workspaceName: string;
    workspaceSlug: string;
    isDefault: boolean;
    isLastUsed: boolean;
  }>;
  isDevelopmentFallback: boolean;
};

async function loadControlPlaneDatabase() {
  const { getControlPlaneDatabase } = await import("./database.ts");
  return getControlPlaneDatabase();
}

type RepositoryRow = {
  id: string;
  provider_type: string;
  owner_name: string;
  repo_name: string;
  canonical_clone_url: string | null;
  default_branch: string;
  repo_status: string;
  sync_status: string | null;
  skill_count: number;
  last_indexed_at: Date | string | null;
  last_successful_sync_at: Date | string | null;
  last_webhook_at: Date | string | null;
  last_activity_at: Date | string | null;
};

type RepositoryDetailRow = RepositoryRow & {
  visibility: string;
  sync_mode: string | null;
  webhook_status: string | null;
  webhook_last_delivery_at: Date | string | null;
};

type RepositoryTierCountRow = {
  tier: string;
  skill_count: number;
};

type RepositoryPermissionRow = {
  granted_to_ref: string;
};

type RepositoryCommitRow = {
  commit: string;
  last_indexed_at: Date | string;
  display_name: string;
};

type SkillRow = {
  indexed_skill_id: string;
  skill_id: string;
  display_name: string;
  tier: string;
  owner: string | null;
  status: string;
  source_path: string;
  source_commit_sha: string;
  manifest: unknown;
  provider_type: string;
  owner_name: string;
  repo_name: string;
  default_branch: string | null;
  version_count: number;
  prod_ref: string | null;
  prod_commit: string | null;
  prod_branch: string | null;
  candidate_ref: string | null;
  candidate_commit: string | null;
  latest_score: number | null;
  trend_scores: Array<number | string> | null;
  last_executed_at: Date | string | null;
  last_indexed_at: Date | string;
};

type ReviewRequestRow = {
  id: string;
  skill_id: string;
  candidate_ref: string;
  updated_at: Date | string;
  requested_by: string | null;
  blocking: string | null;
  summary: unknown;
};

type RecentSkillRow = {
  skill_id: string;
  display_name: string;
  source_commit_sha: string;
  owner: string | null;
  last_indexed_at: Date | string;
};

type RegressionRow = {
  skill_id: string;
  score_delta: number | null;
  passed_cases: number;
  total_cases: number;
};

type AuditEventRow = {
  actor_type: string;
  actor_ref: string;
  category: string;
  action: string;
  target_type: string;
  target_ref: string;
  occurred_at: Date | string;
};

type AuditSkillLookupRow = {
  indexed_skill_id: string;
  skill_id: string;
  display_name: string;
  manifest: unknown;
};

type AuditRepositoryLookupRow = {
  id: string;
  owner_name: string;
  repo_name: string;
};

type PolicyRow = {
  id: string;
  policy_key: string;
  name: string;
  policy_type: string;
  scope_type: string;
  scope_ref: string;
  state: string;
  rules: unknown;
  updated_by_name: string | null;
  updated_at: Date | string;
  binding_count: number;
};

type ReleaseQueueRow = {
  id: string;
  skill_id: string;
  source_ref: string;
  source_commit_sha: string;
  from_environment: string;
  to_environment: string;
  status: string;
  created_at: Date | string;
  requested_by: string | null;
  approvals_done: number;
  approvals_required: number;
  approvals_blocked: string | null;
  targets: string[] | null;
};

type ReleaseDashboardQueueRow = ReleaseQueueRow & {
  bundle_locator: string | null;
  manifest_path: string | null;
  eval_status: string | null;
  eval_passed_cases: number | null;
  eval_total_cases: number | null;
};

type ReleaseHistoryRow = {
  skill_id: string;
  source_ref: string;
  to_environment: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  requested_by: string | null;
  actor_name: string | null;
  final_event_at: Date | string | null;
  release_ref: string | null;
};

type ReleaseDashboardMetricRow = {
  released_last_30d: number;
  avg_turnaround_days_last_30d: number | null;
  avg_turnaround_days_prev_30d: number | null;
  rollbacks_last_30d: number;
  pinned_in_production: number;
  new_pins_last_7d: number;
};

type ConnectorDashboardRow = {
  id: string;
  connector_key: string;
  category: string;
  kind: string;
  status: string;
  config: unknown;
  installed_by_name: string | null;
  updated_at: Date | string;
  enabled_target_count: number;
  total_target_count: number;
  enabled_targets: string[] | null;
  latest_run_status: string | null;
  latest_run_started_at: Date | string | null;
  latest_run_completed_at: Date | string | null;
  sync_runs_24h: number;
  successful_runs_24h: number;
  failed_runs_24h: number;
};

type ReviewMetricRow = {
  completed_reviews: number;
  approved_reviews: number;
};

type ReleaseMetricRow = {
  avg_turnaround_days: number | null;
  released_count: number;
};

type EvaluationRow = {
  result_id: string;
  run_external_id: string | null;
  dataset_logical_name: string | null;
  dataset_source_path: string | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  status: string;
  executed_at: Date | string | null;
  indexed_at: Date | string;
  score_delta: number | null;
  comparison_commit_sha: string | null;
};

type EvaluationDashboardRow = EvaluationRow & {
  skill_id: string;
  skill_name: string;
  skill_tier: string;
};

type ReviewCommentRow = {
  author_name: string | null;
  body: string;
  created_at: Date | string;
};

type VersionHistoryRow = {
  version_ref: string;
  commit_sha: string;
  channel: string | null;
  observed_at: Date | string;
  branch_name: string | null;
  score_pct: number | null;
};

type AccessGrantRow = {
  name: string;
  member_count: number;
  permission_key: string | null;
  source: string;
  updated_at: Date | string;
};

type AccessPolicyRow = {
  name: string;
  policy_type: string;
  scope_type: string;
  scope_ref: string;
};

type ActivityLogRow = {
  actor_ref: string;
  action: string;
  target_ref: string;
  occurred_at: Date | string;
};

type ActiveReleaseRow = {
  id: string;
  source_ref: string;
  source_commit_sha: string;
  from_environment: string;
  to_environment: string;
  status: string;
  created_at: Date | string;
  requested_by: string | null;
  approvals_done: number;
  approvals_required: number;
  approvals_blocked: string | null;
  targets: string[] | null;
};

function createMeta(sourceOfTruth: ControlPlaneResponseMeta["sourceOfTruth"]): ControlPlaneResponseMeta {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    sourceOfTruth,
  };
}

export function createNotFoundResponse(code: string, message: string): ApiErrorResponse {
  return {
    error: {
      code,
      message,
    },
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value instanceof Date ? value : new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

export function serializeControlPlaneTimestamp(
  value: Date | string | null | undefined,
): string | null {
  return toDate(value)?.toISOString() ?? null;
}

export function formatRelativeControlPlaneTime(
  value: Date | string | null | undefined,
  now = new Date(),
): string {
  const date = toDate(value);
  if (!date) {
    return "never";
  }

  const deltaMs = date.getTime() - now.getTime();
  const absMs = Math.abs(deltaMs);
  const direction = deltaMs >= 0 ? "future" : "past";

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["week", 1000 * 60 * 60 * 24 * 7],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  if (absMs < 1000 * 60) {
    return direction === "future" ? "soon" : "just now";
  }

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, unitMs] of units) {
    if (absMs >= unitMs) {
      const rawValue = absMs / unitMs;
      const rounded = rawValue >= 10 ? Math.round(rawValue) : Math.round(rawValue * 10) / 10;
      const signedValue = direction === "future" ? rounded : -rounded;
      return formatter.format(signedValue, unit);
    }
  }

  return direction === "future" ? "soon" : "just now";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readManifestString(manifest: unknown, key: string): string | null {
  if (!isRecord(manifest)) {
    return null;
  }

  const value = manifest[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readManifestNestedString(
  manifest: unknown,
  outerKey: string,
  innerKey: string,
): string | null {
  if (!isRecord(manifest)) {
    return null;
  }

  const outerValue = manifest[outerKey];
  if (!isRecord(outerValue)) {
    return null;
  }

  const value = outerValue[innerKey];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function deriveSkillTeamFromSourcePath(sourcePath: string, manifest: unknown): string {
  const explicitTeam =
    readManifestString(manifest, "team") ??
    readManifestString(manifest, "ownerTeam") ??
    readManifestNestedString(manifest, "ownership", "team");

  if (explicitTeam) {
    return explicitTeam;
  }

  const tokens = sourcePath.split("/").filter(Boolean);
  if (tokens[0] === "tier2" && tokens.length >= 3) {
    return tokens[2] ?? "methodology";
  }

  if (tokens[0] === "tier3" && tokens.length >= 3) {
    return tokens[2] ?? "workflow";
  }

  if (tokens[0] === "tier1" && tokens.length >= 2) {
    return tokens[1] ?? "standards";
  }

  return "general";
}

export function buildRepositoryProjectionMetadata(input: {
  last_indexed_at: Date | string | null | undefined;
  last_successful_sync_at: Date | string | null | undefined;
  last_webhook_at: Date | string | null | undefined;
}): RepositoryProjectionMetadata {
  return {
    indexedAt: serializeControlPlaneTimestamp(input.last_indexed_at),
    lastSuccessfulSyncAt: serializeControlPlaneTimestamp(input.last_successful_sync_at),
    lastWebhookAt: serializeControlPlaneTimestamp(input.last_webhook_at),
  };
}

export function buildSkillProjectionMetadata(input: {
  source_path: string | null | undefined;
  source_commit_sha: string | null | undefined;
  last_indexed_at: Date | string | null | undefined;
}): SkillProjectionMetadata {
  return {
    sourcePath: input.source_path ?? null,
    sourceCommitSha: input.source_commit_sha ?? null,
    indexedAt: serializeControlPlaneTimestamp(input.last_indexed_at),
  };
}

export function resolveIndexedEvalDatasetLabel(input: {
  dataset_logical_name: string | null | undefined;
  dataset_source_path: string | null | undefined;
}): string {
  return input.dataset_logical_name ?? input.dataset_source_path ?? "Indexed dataset";
}

function normalizeTrendScores(scores: Array<number | string> | null | undefined): number[] {
  if (!scores) {
    return [];
  }

  return scores
    .map((score) => (typeof score === "number" ? score : Number(score)))
    .filter((score) => Number.isFinite(score))
    .reverse();
}

function roundScore(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint] ?? null;
  }

  const left = sorted[midpoint - 1];
  const right = sorted[midpoint];

  if (left == null || right == null) {
    return null;
  }

  return roundScore((left + right) / 2);
}

function mapTier(tier: string): 1 | 2 | 3 {
  if (tier === "tier1") {
    return 1;
  }

  if (tier === "tier3") {
    return 3;
  }

  return 2;
}

function mapIndexedEvaluationStatus(status: string): EvaluationRunListItem["status"] {
  if (status === "complete_with_regressions") {
    return "complete-with-regressions";
  }

  if (status === "complete_baseline") {
    return "complete-baseline";
  }

  if (status === "running") {
    return "running";
  }

  if (status === "failed") {
    return "failed";
  }

  return "complete";
}

export function buildEvaluationRunListItem(row: EvaluationDashboardRow): EvaluationRunListItem {
  const startedAt = serializeControlPlaneTimestamp(row.executed_at ?? row.indexed_at);
  const passRate = roundScore((row.passed_cases * 100) / Math.max(row.total_cases, 1)) ?? 0;

  return {
    id: row.result_id ?? row.run_external_id ?? `${row.skill_id}:${row.comparison_commit_sha ?? startedAt ?? "indexed-eval"}`,
    skillId: row.skill_id,
    skill: row.skill_name,
    skillTier: mapTier(row.skill_tier),
    ref: row.comparison_commit_sha?.slice(0, 7) ?? "—",
    dataset: resolveIndexedEvalDatasetLabel(row),
    cases: row.total_cases,
    passed: row.passed_cases,
    failed: row.failed_cases,
    started: formatRelativeControlPlaneTime(row.executed_at ?? row.indexed_at),
    startedAt,
    duration: "—",
    passRate,
    delta: roundScore(row.score_delta),
    status: mapIndexedEvaluationStatus(row.status),
  };
}

export function buildEvaluationDashboardMetrics(input: {
  totalSkills: number;
  evaluatedSkills: number;
  averageCasesPerRun: number | null;
  totalRuns: number;
  regressionsLast24h: number;
  latestRegressionSkill: string | null;
  medianPassRate: number | null;
  runningRuns: number;
  regressionRuns: number;
}): EvaluationDashboardMetric[] {
  const coverage = input.totalSkills > 0
    ? roundScore((input.evaluatedSkills / input.totalSkills) * 100) ?? 0
    : 0;
  const averageCasesPerRun = roundScore(input.averageCasesPerRun) ?? 0;
  const medianPassRate = roundScore(input.medianPassRate) ?? 0;

  return [
    {
      key: "coverage",
      label: "Coverage",
      value: coverage,
      unit: "%",
      displayDecimals: 1,
      trendLabel: `${input.evaluatedSkills} of ${input.totalSkills} skills`,
      trend: input.evaluatedSkills > 0 ? "up" : "flat",
    },
    {
      key: "avg-cases",
      label: "Avg cases per run",
      value: averageCasesPerRun,
      trendLabel: input.totalRuns > 0 ? `${input.totalRuns} indexed runs` : "No indexed runs yet",
      trend: input.totalRuns > 0 ? "flat" : "flat",
    },
    {
      key: "regressions-24h",
      label: "Regressions · 24h",
      value: input.regressionsLast24h,
      trendLabel: input.latestRegressionSkill ?? "No recent regressions",
      trend: input.regressionsLast24h > 0 ? "down" : "flat",
    },
    {
      key: "median-pass-rate",
      label: "Median pass rate",
      value: medianPassRate,
      unit: "%",
      displayDecimals: 1,
      trendLabel: input.totalRuns > 0
        ? `${input.runningRuns} running${input.regressionRuns > 0 ? ` · ${input.regressionRuns} with regressions` : ""}`
        : "No indexed runs yet",
      trend: input.regressionRuns > 0 ? "down" : input.totalRuns > 0 ? "up" : "flat",
    },
  ];
}

function buildEvaluationTierCoverage(
  skillRows: SkillRow[],
  runs: EvaluationRunListItem[],
): EvaluationTierCoverageItem[] {
  const totalSkillsByTier = {
    1: 0,
    2: 0,
    3: 0,
  } satisfies Record<1 | 2 | 3, number>;

  const evaluatedSkillsByTier = {
    1: new Set<string>(),
    2: new Set<string>(),
    3: new Set<string>(),
  } satisfies Record<1 | 2 | 3, Set<string>>;

  for (const skill of skillRows) {
    totalSkillsByTier[mapTier(skill.tier)] += 1;
  }

  for (const run of runs) {
    evaluatedSkillsByTier[run.skillTier].add(run.skillId);
  }

  return ([1, 2, 3] as const).map((tier) => ({
    tier,
    evaluatedSkills: evaluatedSkillsByTier[tier].size,
    totalSkills: totalSkillsByTier[tier],
    coveragePct: totalSkillsByTier[tier] > 0
      ? roundScore((evaluatedSkillsByTier[tier].size / totalSkillsByTier[tier]) * 100) ?? 0
      : 0,
  }));
}

export function mapRepositorySyncStatus(
  repositoryStatus: string,
  syncStatus: string | null | undefined,
): RepositorySyncStatus {
  if (repositoryStatus === "disabled" || repositoryStatus === "stale" || syncStatus === "error") {
    return "stale";
  }

  if (repositoryStatus === "warning" || syncStatus === "warn" || syncStatus === "indexing") {
    return "warn";
  }

  return "ok";
}

function buildWorkspaceShortLabel(workspaceName: string): string {
  const tokens = workspaceName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return "SV";
  }

  const [first, second] = tokens;
  return `${first?.[0] ?? "S"}${second?.[0] ?? first?.[1] ?? "V"}`.toUpperCase();
}

function buildOrganizationSummary(context: TenantReadContext): OverviewPayload["organization"] {
  const userName = context.identity?.displayName ?? context.tenant.workspaceName;

  return {
    name: context.tenant.workspaceName,
    short: buildWorkspaceShortLabel(context.tenant.workspaceName),
    env: context.isDevelopmentFallback ? "development" : "production",
    user: {
      name: userName,
      role: context.memberships.length > 1 ? "Member · multi-org" : "Member",
      initials: getInitials(userName),
    },
  };
}

function deriveSkillDescription(skill: SkillRow): string {
  return (
    readManifestString(skill.manifest, "summary") ??
    readManifestString(skill.manifest, "description") ??
    `Indexed from ${skill.owner_name}/${skill.repo_name}.`
  );
}

function deriveSkillAccessGroup(skill: SkillRow): string {
  return (
    readManifestString(skill.manifest, "accessGroup") ??
    readManifestNestedString(skill.manifest, "access", "group") ??
    "workspace-members"
  );
}

function deriveSkillChannel(skill: SkillRow): string {
  const manifestChannel = readManifestString(skill.manifest, "channel");
  if (manifestChannel) {
    return manifestChannel;
  }

  if (skill.prod_ref) {
    return "production";
  }

  if (skill.candidate_ref) {
    return "staging";
  }

  return "draft";
}

function deriveSkillUuid(skill: Pick<SkillRow, "manifest" | "indexed_skill_id">): string {
  return (
    readManifestString(skill.manifest, "skill_uuid")
    ?? readManifestString(skill.manifest, "skillUuid")
    ?? readManifestNestedString(skill.manifest, "identity", "skill_uuid")
    ?? readManifestNestedString(skill.manifest, "identity", "skillUuid")
    ?? skill.indexed_skill_id
  );
}

function buildSkillListItem(skill: SkillRow): SkillListItem {
  const trend = normalizeTrendScores(skill.trend_scores);
  const score = roundScore(skill.latest_score);

  return {
    id: skill.skill_id,
    skillUuid: deriveSkillUuid(skill),
    name: skill.display_name,
    description: deriveSkillDescription(skill),
    tier: mapTier(skill.tier),
    owner: skill.owner ?? readManifestString(skill.manifest, "owner") ?? "Unassigned",
    team: deriveSkillTeamFromSourcePath(skill.source_path, skill.manifest),
    repo: `${skill.owner_name}/${skill.repo_name}`,
    repoProvider: skill.provider_type,
    ref: skill.prod_ref ?? "—",
    commit: skill.prod_commit ?? "—",
    branch: skill.default_branch ?? skill.prod_branch ?? "main",
    candidateRef: skill.candidate_ref ?? "—",
    candidateCommit: skill.candidate_commit ?? "—",
    versionCount: skill.version_count,
    prodEnv: "production",
    channel: deriveSkillChannel(skill),
    score,
    trend,
    accessGroup: deriveSkillAccessGroup(skill),
    lastEval: formatRelativeControlPlaneTime(skill.last_executed_at),
    status: skill.status,
    projection: buildSkillProjectionMetadata(skill),
  };
}

function buildRepositoryListItem(row: RepositoryRow): RepositoryListItem {
  return {
    id: row.id,
    provider: row.provider_type,
    providerReadiness: getRepositoryProviderReadiness(row.provider_type),
    name: `${row.owner_name}/${row.repo_name}`,
    webUrl: buildRepositoryWebUrl({
      provider: row.provider_type,
      name: `${row.owner_name}/${row.repo_name}`,
      canonicalCloneUrl: row.canonical_clone_url,
    }),
    branch: row.default_branch,
    skills: row.skill_count,
    lastSync: formatRelativeControlPlaneTime(row.last_activity_at),
    status: mapRepositorySyncStatus(row.repo_status, row.sync_status),
    projection: buildRepositoryProjectionMetadata(row),
  };
}

function buildDeltaLabel(values: number[]): string {
  if (values.length < 2) {
    return "flat";
  }

  const current = values[values.length - 1];
  const previous = values[values.length - 2];
  if (current == null || previous == null) {
    return "flat";
  }

  const delta = current - previous;
  if (Math.abs(delta) < 0.05) {
    return "flat";
  }

  return delta.toFixed(1);
}

const KNOWN_CONNECTOR_NAMES: Record<string, string> = {
  vsc: "VS Code Sync Agent",
  cdx: "Codex Sync Agent",
  cur: "Cursor Sync Agent",
  cli: "savant-cli",
  gha: "GitHub Actions",
  azp: "Azure Pipelines",
  slk: "Slack",
  lnr: "Linear",
  jra: "Jira",
  bun: "Signed Bundle Export",
};

const CONNECTOR_CATEGORY_VALUES = new Set<ConnectorCategory>([
  "local",
  "native",
  "notify",
  "bundle",
]);

const CONNECTOR_STATUS_VALUES = new Set<ConnectorStatus>([
  "healthy",
  "degraded",
  "warning",
  "offline",
]);

function readConfigString(config: unknown, keys: readonly string[]): string | null {
  if (!isRecord(config)) {
    return null;
  }

  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readConfigNumber(config: unknown, keys: readonly string[]): number | null {
  if (!isRecord(config)) {
    return null;
  }

  for (const key of keys) {
    const value = config[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function humanizeConnectorKey(connectorKey: string): string {
  const known = KNOWN_CONNECTOR_NAMES[connectorKey.trim().toLowerCase()];
  if (known) {
    return known;
  }

  return connectorKey
    .split(/[_-]+/)
    .filter(Boolean)
    .map((token) => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(" ") || connectorKey;
}

function normalizeConnectorCategory(value: string): ConnectorCategory {
  const normalized = value.trim().toLowerCase();
  return CONNECTOR_CATEGORY_VALUES.has(normalized as ConnectorCategory)
    ? normalized as ConnectorCategory
    : "local";
}

function normalizeConnectorStatus(value: string): ConnectorStatus {
  const normalized = value.trim().toLowerCase();
  return CONNECTOR_STATUS_VALUES.has(normalized as ConnectorStatus)
    ? normalized as ConnectorStatus
    : "warning";
}

function buildConnectorDisplayName(row: Pick<ConnectorDashboardRow, "connector_key" | "config">): string {
  return readConfigString(row.config, ["displayName", "name", "label"])
    ?? humanizeConnectorKey(row.connector_key);
}

function buildConnectorVersion(row: Pick<ConnectorDashboardRow, "config">): string {
  return readConfigString(row.config, ["version", "agentVersion", "clientVersion", "cliVersion"])
    ?? "—";
}

function buildConnectorSkillValue(row: Pick<ConnectorDashboardRow, "config" | "enabled_target_count" | "category">): number | string {
  const configured = readConfigNumber(row.config, ["skillCount", "skills"]);
  if (configured != null) {
    return configured;
  }

  return row.category === "notify" ? "—" : row.enabled_target_count;
}

function buildConnectorUserValue(row: Pick<ConnectorDashboardRow, "config">): number | string {
  return readConfigNumber(row.config, ["userCount", "users", "agentCount", "agents"])
    ?? "—";
}

function buildConnectorScope(row: Pick<ConnectorDashboardRow, "config" | "enabled_targets" | "enabled_target_count" | "category">): string {
  const explicitScope = readConfigString(row.config, ["scopeLabel", "scope", "usageScope"]);
  if (explicitScope) {
    return explicitScope;
  }

  const enabledTargets = row.enabled_targets ?? [];
  if (enabledTargets.length === 1) {
    return enabledTargets[0] ?? "No enabled targets configured";
  }

  if (enabledTargets.length === 2) {
    return enabledTargets.join(" · ");
  }

  if (enabledTargets.length > 2) {
    return `${enabledTargets.slice(0, 2).join(" · ")} +${enabledTargets.length - 2} more`;
  }

  if (row.category === "notify") {
    return "No notification targets configured";
  }

  if (row.category === "bundle") {
    return "No bundle targets configured";
  }

  if (row.category === "native") {
    return "No native targets configured";
  }

  return "No local targets configured";
}

function buildConnectorLastSync(
  row: Pick<ConnectorDashboardRow, "latest_run_status" | "latest_run_started_at" | "latest_run_completed_at">,
  now?: Date,
): string {
  const timestamp = row.latest_run_completed_at ?? row.latest_run_started_at;
  if (!timestamp) {
    return "never";
  }

  const formatted = formatRelativeControlPlaneTime(timestamp, now);
  return row.latest_run_status === "running" ? `running · ${formatted}` : formatted;
}

export function buildConnectorRecord(row: ConnectorDashboardRow, now = new Date()): ConnectorRecord {
  const category = normalizeConnectorCategory(row.category);

  return {
    id: row.id,
    name: buildConnectorDisplayName(row),
    category,
    kind: row.kind,
    status: normalizeConnectorStatus(row.status),
    lastSync: buildConnectorLastSync(row, now),
    version: buildConnectorVersion(row),
    skills: buildConnectorSkillValue({
      config: row.config,
      enabled_target_count: row.enabled_target_count,
      category,
    }),
    users: buildConnectorUserValue(row),
    scope: buildConnectorScope({
      config: row.config,
      enabled_targets: row.enabled_targets,
      enabled_target_count: row.enabled_target_count,
      category,
    }),
  };
}

export function buildConnectorDashboardMetrics(input: {
  activeConnectors: number;
  totalConnectors: number;
  enabledTargets: number;
  localConnectors: number;
  nativeConnectors: number;
  notifyConnectors: number;
  bundleConnectors: number;
  syncRuns24h: number;
  successfulRuns24h: number;
  failedRuns24h: number;
  issues: number;
  degradedCount: number;
  warningCount: number;
  offlineCount: number;
}): ConnectorDashboardMetric[] {
  const issueParts = [
    input.degradedCount > 0 ? `${input.degradedCount} degraded` : null,
    input.warningCount > 0 ? `${input.warningCount} warning` : null,
    input.offlineCount > 0 ? `${input.offlineCount} offline` : null,
  ].filter((value): value is string => value != null);

  return [
    {
      key: "active-connectors",
      label: "Active connectors",
      value: input.activeConnectors,
      trendLabel: `${input.totalConnectors} total`,
      trend: input.issues > 0 ? "down" : input.activeConnectors > 0 ? "up" : "flat",
    },
    {
      key: "enabled-targets",
      label: "Enabled targets",
      value: input.enabledTargets,
      trendLabel: `${input.localConnectors} local · ${input.nativeConnectors} native · ${input.notifyConnectors} notify · ${input.bundleConnectors} bundle`,
      trend: input.enabledTargets > 0 ? "up" : "flat",
    },
    {
      key: "sync-runs-24h",
      label: "Sync runs · 24h",
      value: input.syncRuns24h,
      trendLabel: input.syncRuns24h > 0
        ? `${input.successfulRuns24h} successful${input.failedRuns24h > 0 ? ` · ${input.failedRuns24h} failed` : ""}`
        : "No sync activity in last 24h",
      trend: input.failedRuns24h > 0 ? "down" : input.successfulRuns24h > 0 ? "up" : "flat",
    },
    {
      key: "issues",
      label: "Issues",
      value: input.issues,
      trendLabel: issueParts.length > 0 ? issueParts.join(" · ") : "No active connector issues",
      trend: input.issues > 0 ? "down" : "flat",
    },
  ];
}

const POLICY_TYPE_VALUES = new Set<PolicySummary["type"]>([
  "access",
  "approval",
  "distribution",
  "environment",
]);

function normalizePolicyType(value: string): PolicySummary["type"] {
  const normalized = value.trim().toLowerCase();

  if (POLICY_TYPE_VALUES.has(normalized as PolicySummary["type"])) {
    return normalized as PolicySummary["type"];
  }

  if (normalized.includes("approv")) {
    return "approval";
  }

  if (normalized.includes("distrib")) {
    return "distribution";
  }

  if (normalized.includes("env")) {
    return "environment";
  }

  return "access";
}

function buildPolicyRuleItems(value: unknown): PolicyRuleItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const rule = typeof entry.rule === "string" ? entry.rule.trim() : "";
    const itemValue = typeof entry.value === "string" ? entry.value.trim() : "";

    if (!rule || !itemValue) {
      return [];
    }

    return [{ rule, value: itemValue } satisfies PolicyRuleItem];
  });
}

function normalizeLookupToken(value: string): string {
  return value.trim().toLowerCase();
}

function formatPolicyScopeTypeLabel(scopeType: string): string {
  return scopeType
    .split(/[_-]+/)
    .filter(Boolean)
    .map((token) => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

function buildPolicyScopeLabel(row: Pick<PolicyRow, "scope_type" | "scope_ref">): string {
  const scopeType = row.scope_type.trim().toLowerCase();
  const scopeRef = row.scope_ref.trim();

  if (scopeType === "workspace" || scopeType === "organization") {
    return "Workspace";
  }

  if (scopeType === "tier") {
    const match = scopeRef.match(/^tier(\d)$/i);
    return match ? `Tier ${match[1]}` : scopeRef ? `Tier · ${scopeRef}` : "Tier";
  }

  if (scopeType === "environment") {
    return scopeRef ? `Environment · ${scopeRef}` : "Environment";
  }

  if (scopeType === "repository" || scopeType === "repo") {
    return scopeRef ? `Repository · ${scopeRef}` : "Repository";
  }

  if (scopeType === "skill" || scopeType === "skill_id" || scopeType === "skill_uuid") {
    return scopeRef ? `Skill · ${scopeRef}` : "Skill";
  }

  if (scopeType === "tag") {
    return scopeRef ? `Tag · ${scopeRef}` : "Tag";
  }

  return scopeRef ? `${formatPolicyScopeTypeLabel(scopeType)} · ${scopeRef}` : formatPolicyScopeTypeLabel(scopeType);
}

function resolvePolicyTargetCount(row: Pick<PolicyRow, "binding_count" | "scope_type">): number {
  if (row.binding_count > 0) {
    return row.binding_count;
  }

  const scopeType = row.scope_type.trim().toLowerCase();
  return scopeType === "workspace" || scopeType === "organization" ? 1 : 0;
}

function mapPolicyActivityStatus(action: string): PolicyActivityRecord["status"] {
  const normalized = action.toLowerCase();

  if (
    normalized.includes("block") ||
    normalized.includes("hold") ||
    normalized.includes("reject") ||
    normalized.includes("deny")
  ) {
    return "blocked";
  }

  if (
    normalized.includes("allow") ||
    normalized.includes("approve") ||
    normalized.includes("release")
  ) {
    return "allowed";
  }

  return "info";
}

function buildPolicyActivityDetail(row: AuditEventRow): string {
  return row.target_type.trim().toLowerCase() === "policy" ? "Policy definition" : row.target_ref;
}

function buildPolicyActivityRecord(
  row: AuditEventRow,
  context: Pick<TenantReadContext, "identity">,
  now = new Date(),
): PolicyActivityRecord {
  const who = row.actor_ref === context.identity?.subject || row.actor_ref === context.identity?.email
    ? context.identity.displayName
    : row.actor_ref;

  return {
    occurredAt: serializeControlPlaneTimestamp(row.occurred_at) ?? new Date(0).toISOString(),
    when: formatRelativeControlPlaneTime(row.occurred_at, now),
    who,
    action: row.action,
    detail: buildPolicyActivityDetail(row),
    status: mapPolicyActivityStatus(row.action),
  };
}


  function humanizeReleaseState(value: string): string {
    const normalized = value.trim().replace(/_/g, " ");
    return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
  }

  function buildReleaseEvaluationReadiness(row: ReleaseDashboardQueueRow): ReleaseQueueItem["readiness"][number] {
    const normalizedStatus = row.eval_status?.trim().toLowerCase() ?? "";

    if (!normalizedStatus) {
      return {
        label: "Eval suite passing",
        ok: null,
        meta: "No indexed evaluation run for this candidate",
      };
    }

    const evaluationPassed = normalizedStatus === "complete" || normalizedStatus === "complete_baseline";
    const evaluationBlocked = normalizedStatus === "complete_with_regressions" || normalizedStatus === "failed";
    const meta = row.eval_total_cases && row.eval_total_cases > 0
      ? `${row.eval_passed_cases ?? 0}/${row.eval_total_cases} passed`
      : humanizeReleaseState(normalizedStatus);

    return {
      label: "Eval suite passing",
      ok: evaluationPassed ? true : evaluationBlocked ? false : null,
      meta,
    };
  }

  function buildReleaseApprovalReadiness(row: ReleaseDashboardQueueRow): ReleaseQueueItem["readiness"][number] {
    const isApproved = row.approvals_required > 0 && row.approvals_done >= row.approvals_required;
    const isBlocked = !isApproved && Boolean(row.approvals_blocked);

    return {
      label: "Approvals",
      ok: row.approvals_required > 0
        ? isApproved
          ? true
          : isBlocked
            ? false
            : null
        : null,
      meta: row.approvals_required > 0
        ? `${row.approvals_done}/${row.approvals_required} approvals${row.approvals_blocked ? ` · awaiting ${row.approvals_blocked}` : ""}`
        : "No approvers assigned yet",
    };
  }

  function buildReleaseBundleReadiness(row: ReleaseDashboardQueueRow): ReleaseQueueItem["readiness"][number] {
    return {
      label: "Bundle signed & built",
      ok: row.bundle_locator || row.manifest_path ? true : null,
      meta: row.bundle_locator ?? row.manifest_path ?? "Awaiting bundle build",
    };
  }

  function buildReleaseTargetReadiness(row: ReleaseDashboardQueueRow): ReleaseQueueItem["readiness"][number] {
    return {
      label: "Targets",
      ok: row.targets && row.targets.length > 0 ? true : null,
      meta: row.targets && row.targets.length > 0
        ? row.targets.join(", ")
        : "No release targets configured",
    };
  }

  function buildReleaseDashboardReadiness(row: ReleaseDashboardQueueRow): ReleaseQueueItem["readiness"] {
    return [
      buildReleaseEvaluationReadiness(row),
      buildReleaseApprovalReadiness(row),
      buildReleaseBundleReadiness(row),
      buildReleaseTargetReadiness(row),
    ];
  }

  function buildReleaseDashboardQueueItems(
    rows: ReleaseDashboardQueueRow[],
    skillsById: ReadonlyMap<string, SkillListItem>,
  ): ReleaseQueueItem[] {
    return rows.map((row) => {
      const readiness = buildReleaseDashboardReadiness(row);
      const passedCount = readiness.filter((item) => item.ok === true).length;
      const readinessPct = readiness.length > 0 ? passedCount / readiness.length : 0;
      const skill = skillsById.get(row.skill_id);

      return {
        id: row.id,
        skill: skill?.name ?? row.skill_id,
        candidateRef: row.source_ref,
        candidateCommit: row.source_commit_sha,
        fromEnv: row.from_environment as ReleaseQueueItem["fromEnv"],
        toEnv: row.to_environment as ReleaseQueueItem["toEnv"],
        requested: row.requested_by ?? "System",
        when: formatRelativeControlPlaneTime(row.created_at),
        approvalsDone: row.approvals_done,
        approvalsRequired: row.approvals_required,
        approvalsBlocked: row.approvals_blocked,
        readinessPct,
        readiness,
        targets: row.targets ?? [],
      };
    });
  }

  export function buildReleaseHistoryItem(
    row: ReleaseHistoryRow,
    skillsById: ReadonlyMap<string, Pick<SkillListItem, "name">>,
    now = new Date(),
  ): ReleaseHistoryItem {
    return {
      ref: row.release_ref ?? row.source_ref,
      skill: skillsById.get(row.skill_id)?.name ?? row.skill_id,
      env: row.to_environment as ReleaseHistoryItem["env"],
      who: row.actor_name ?? row.requested_by ?? "System",
      when: formatRelativeControlPlaneTime(row.final_event_at ?? row.updated_at ?? row.created_at, now),
      outcome: row.status === "rolled_back" ? "rolled-back" : "released",
    };
  }

  export function buildReleaseDashboardMetrics(input: {
    activeCandidates: number;
    blockedCandidates: number;
    readyCandidates: number;
    averageTurnaroundDaysLast30d: number | null;
    averageTurnaroundDaysPrev30d: number | null;
    releasedCountLast30d: number;
    rollbackCountLast30d: number;
    latestRollback: Pick<ReleaseHistoryItem, "skill" | "when"> | null;
    pinnedInProduction: number;
    newPinsLast7d: number;
  }): ReleaseDashboardMetric[] {
    const currentTurnaround = roundScore(input.averageTurnaroundDaysLast30d);
    const previousTurnaround = roundScore(input.averageTurnaroundDaysPrev30d);

    let turnaroundTrend: ReleaseDashboardMetric["trend"] = "flat";
    let turnaroundTrendLabel = input.releasedCountLast30d > 0
      ? `${input.releasedCountLast30d} completed releases in 30d`
      : "No completed releases in 30d";

    if (currentTurnaround != null && previousTurnaround != null) {
      const delta = roundScore(currentTurnaround - previousTurnaround) ?? 0;

      if (Math.abs(delta) >= 0.1) {
        turnaroundTrend = delta < 0 ? "up" : "down";
        turnaroundTrendLabel = `${delta < 0 ? "↓" : "↑"} ${Math.abs(delta).toFixed(1)}d vs prior 30d`;
      } else {
        turnaroundTrendLabel = "No material change vs prior 30d";
      }
    }

    return [
      {
        key: "active-candidates",
        label: "Active candidates",
        value: input.activeCandidates,
        trendLabel: input.activeCandidates === 0
          ? "No active promotions"
          : input.blockedCandidates > 0
            ? `${input.blockedCandidates} blocked by approvals`
            : input.readyCandidates > 0
              ? `${input.readyCandidates} release-ready`
              : `${input.activeCandidates} in motion`,
        trend: input.blockedCandidates > 0 ? "down" : input.readyCandidates > 0 ? "up" : "flat",
      },
      {
        key: "release-turnaround",
        label: "Release turnaround",
        value: currentTurnaround,
        unit: "d",
        ...(currentTurnaround != null ? { displayDecimals: 1 } : {}),
        trendLabel: turnaroundTrendLabel,
        trend: turnaroundTrend,
      },
      {
        key: "rollbacks-30d",
        label: "Rollbacks · 30d",
        value: input.rollbackCountLast30d,
        trendLabel: input.latestRollback
          ? `${input.latestRollback.skill} · ${input.latestRollback.when}`
          : "No rollback events in 30d",
        trend: input.rollbackCountLast30d > 0 ? "down" : "flat",
      },
      {
        key: "pinned-in-production",
        label: "Pinned in production",
        value: input.pinnedInProduction,
        trendLabel: input.newPinsLast7d > 0
          ? `+${input.newPinsLast7d} this week`
          : "No new production pins this week",
        trend: input.newPinsLast7d > 0 ? "up" : "flat",
      },
    ];
  }
function buildPolicyActivityLookup(
  policyRows: PolicyRow[],
  auditRows: AuditEventRow[],
  context: Pick<TenantReadContext, "identity">,
): Map<string, PolicyActivityRecord[]> {
  const policyIdsByToken = new Map<string, Set<string>>();

  function registerPolicyToken(token: string, policyId: string) {
    const normalized = normalizeLookupToken(token);
    if (!normalized) {
      return;
    }

    const bucket = policyIdsByToken.get(normalized) ?? new Set<string>();
    bucket.add(policyId);
    policyIdsByToken.set(normalized, bucket);
  }

  for (const row of policyRows) {
    registerPolicyToken(row.id, row.id);
    registerPolicyToken(row.policy_key, row.id);
    registerPolicyToken(row.name, row.id);
  }

  const activitiesByPolicyId = new Map<string, PolicyActivityRecord[]>();

  for (const row of auditRows) {
    const matchingPolicyIds = policyIdsByToken.get(normalizeLookupToken(row.target_ref));
    if (!matchingPolicyIds) {
      continue;
    }

    for (const policyId of matchingPolicyIds) {
      const bucket = activitiesByPolicyId.get(policyId) ?? [];
      if (bucket.length >= 3) {
        continue;
      }

      bucket.push(buildPolicyActivityRecord(row, context));
      activitiesByPolicyId.set(policyId, bucket);
    }
  }

  return activitiesByPolicyId;
}

export function buildPolicySummary(
  row: PolicyRow,
  recentActivity: PolicyActivityRecord[] = [],
  now = new Date(),
): PolicySummary {
  return {
    id: row.id,
    name: row.name,
    type: normalizePolicyType(row.policy_type),
    scope: buildPolicyScopeLabel(row),
    state: row.state === "active" ? "active" : "draft",
    affects: resolvePolicyTargetCount(row),
    appliedBy: row.updated_by_name?.trim() || "System",
    updated: formatRelativeControlPlaneTime(row.updated_at, now),
    rules: buildPolicyRuleItems(row.rules),
    recentActivity,
  };
}

export function buildOverviewKpis(input: {
  indexedSkills: number;
  productionSkills: number;
  skillsWithEvaluations: number;
  completedReviews: number;
  approvedReviews: number;
  averageReleaseTurnaroundDays: number;
  releasedCount: number;
}): OverviewKpi[] {
  const evalCoverage = input.indexedSkills > 0
    ? Math.round((input.skillsWithEvaluations / input.indexedSkills) * 1000) / 10
    : 0;
  const firstPassAcceptance = input.completedReviews > 0
    ? Math.round((input.approvedReviews / input.completedReviews) * 1000) / 10
    : 0;
  const releaseTurnaround = roundScore(input.averageReleaseTurnaroundDays) ?? 0;

  return [
    {
      key: "skills-in-production",
      label: "Skills in production",
      value: input.productionSkills,
      deltaLabel: `${input.indexedSkills} indexed total`,
      trend: "flat",
    },
    {
      key: "eval-coverage",
      label: "Eval coverage",
      value: evalCoverage,
      unit: "%",
      deltaLabel: `${input.skillsWithEvaluations} with evaluations`,
      trend: "flat",
    },
    {
      key: "first-pass-acceptance",
      label: "First-pass acceptance",
      value: firstPassAcceptance,
      unit: "%",
      deltaLabel: `${input.completedReviews} completed reviews`,
      trend: "flat",
    },
    {
      key: "release-turnaround",
      label: "Release turnaround",
      value: releaseTurnaround,
      unit: "d",
      deltaLabel: `${input.releasedCount} completed releases`,
      trend: "flat",
    },
  ];
}

async function queryPolicies(organizationId: string): Promise<PolicyRow[]> {
  const sql = await loadControlPlaneDatabase();
  return sql<PolicyRow[]>`
    select
      access_policies.id,
      access_policies.policy_key,
      access_policies.name,
      access_policies.policy_type,
      access_policies.scope_type,
      access_policies.scope_ref,
      access_policies.state,
      access_policies.rules,
      coalesce(updated_by.display_name, created_by.display_name, 'System') as updated_by_name,
      access_policies.updated_at,
      coalesce(binding_counts.binding_count, 0)::int as binding_count
    from access_policies
    left join users updated_by on updated_by.id = access_policies.updated_by
    left join users created_by on created_by.id = access_policies.created_by
    left join lateral (
      select count(*)::int as binding_count
      from policy_bindings
      where policy_bindings.policy_id = access_policies.id
    ) binding_counts on true
    where access_policies.organization_id = ${organizationId}
      and access_policies.state in ('active', 'draft')
    order by access_policies.updated_at desc, access_policies.name asc
  `;
}

async function queryReleaseDashboardQueueRows(
  organizationId: string,
): Promise<ReleaseDashboardQueueRow[]> {
  const sql = await loadControlPlaneDatabase();

  return sql<ReleaseDashboardQueueRow[]>`
    select
      release_requests.id,
      release_requests.skill_id,
      release_requests.source_ref,
      release_requests.source_commit_sha,
      release_requests.from_environment,
      release_requests.to_environment,
      release_requests.status,
      release_requests.created_at,
      requester.display_name as requested_by,
      coalesce(approval_counts.approved_count, 0)::int as approvals_done,
      coalesce(approval_counts.total_count, 0)::int as approvals_required,
      approval_counts.blocked_role as approvals_blocked,
      target_list.targets,
      coalesce(target_list.bundle_locator, manifest_info.bundle_locator) as bundle_locator,
      manifest_info.manifest_path,
      eval_info.status as eval_status,
      eval_info.passed_cases::int as eval_passed_cases,
      eval_info.total_cases::int as eval_total_cases
    from release_requests
    left join users requester on requester.id = release_requests.requested_by
    left join lateral (
      select
        count(*)::int as total_count,
        count(*) filter (where status = 'approved')::int as approved_count,
        min(required_role) filter (where status <> 'approved') as blocked_role
      from release_approvals
      where release_request_id = release_requests.id
    ) approval_counts on true
    left join lateral (
      select
        array_agg(target_key order by target_key) as targets,
        min(bundle_locator) filter (where bundle_locator is not null and btrim(bundle_locator) <> '') as bundle_locator
      from release_targets
      where release_request_id = release_requests.id
    ) target_list on true
    left join lateral (
      select manifest_path, bundle_locator
      from indexed_release_manifests
      where release_request_id = release_requests.id
      order by indexed_at desc
      limit 1
    ) manifest_info on true
    left join lateral (
      select
        indexed_eval_results.status,
        indexed_eval_results.passed_cases,
        indexed_eval_results.total_cases
      from indexed_eval_results
      inner join indexed_skills on indexed_skills.id = indexed_eval_results.indexed_skill_id
      where indexed_skills.organization_id = ${organizationId}
        and indexed_skills.skill_id = release_requests.skill_id
        and indexed_eval_results.comparison_commit_sha = release_requests.source_commit_sha
      order by indexed_eval_results.executed_at desc nulls last, indexed_eval_results.indexed_at desc
      limit 1
    ) eval_info on true
    where release_requests.organization_id = ${organizationId}
      and release_requests.status in ('pending', 'approved', 'blocked')
    order by release_requests.created_at desc
    limit 25
  `;
}

async function queryReleaseHistoryRows(
  organizationId: string,
): Promise<ReleaseHistoryRow[]> {
  const sql = await loadControlPlaneDatabase();

  return sql<ReleaseHistoryRow[]>`
    select
      release_requests.skill_id,
      release_requests.source_ref,
      release_requests.to_environment,
      release_requests.status,
      release_requests.created_at,
      release_requests.updated_at,
      requester.display_name as requested_by,
      final_event.actor_name,
      final_event.created_at as final_event_at,
      manifest_info.release_ref
    from release_requests
    left join users requester on requester.id = release_requests.requested_by
    left join lateral (
      select
        actor.display_name as actor_name,
        release_events.created_at
      from release_events
      left join users actor on actor.id = release_events.actor_user_id
      where release_events.release_request_id = release_requests.id
      order by release_events.created_at desc
      limit 1
    ) final_event on true
    left join lateral (
      select release_ref
      from indexed_release_manifests
      where release_request_id = release_requests.id
      order by indexed_at desc
      limit 1
    ) manifest_info on true
    where release_requests.organization_id = ${organizationId}
      and release_requests.status in ('released', 'rolled_back')
    order by coalesce(final_event.created_at, release_requests.updated_at, release_requests.created_at) desc
    limit 12
  `;
}

async function queryReleaseDashboardMetricRow(
  organizationId: string,
  now = new Date(),
): Promise<ReleaseDashboardMetricRow> {
  const sql = await loadControlPlaneDatabase();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const rows = await sql<ReleaseDashboardMetricRow[]>`
    select
      count(*) filter (
        where release_requests.status = 'released'
          and release_requests.updated_at >= ${thirtyDaysAgo}
      )::int as released_last_30d,
      avg(extract(epoch from (release_requests.updated_at - release_requests.created_at)) / 86400) filter (
        where release_requests.status = 'released'
          and release_requests.updated_at >= ${thirtyDaysAgo}
      )::float8 as avg_turnaround_days_last_30d,
      avg(extract(epoch from (release_requests.updated_at - release_requests.created_at)) / 86400) filter (
        where release_requests.status = 'released'
          and release_requests.updated_at < ${thirtyDaysAgo}
          and release_requests.updated_at >= ${sixtyDaysAgo}
      )::float8 as avg_turnaround_days_prev_30d,
      count(*) filter (
        where release_requests.status = 'rolled_back'
          and release_requests.updated_at >= ${thirtyDaysAgo}
      )::int as rollbacks_last_30d,
      coalesce((
        select count(distinct indexed_release_manifests.skill_id)::int
        from indexed_release_manifests
        inner join repositories on repositories.id = indexed_release_manifests.repository_id
        where repositories.organization_id = ${organizationId}
          and indexed_release_manifests.target_environment = 'production'
      ), 0)::int as pinned_in_production,
      coalesce((
        select count(distinct indexed_release_manifests.skill_id)::int
        from indexed_release_manifests
        inner join repositories on repositories.id = indexed_release_manifests.repository_id
        where repositories.organization_id = ${organizationId}
          and indexed_release_manifests.target_environment = 'production'
          and indexed_release_manifests.indexed_at >= ${sevenDaysAgo}
      ), 0)::int as new_pins_last_7d
    from release_requests
    where release_requests.organization_id = ${organizationId}
  `;

  return rows[0] ?? {
    released_last_30d: 0,
    avg_turnaround_days_last_30d: null,
    avg_turnaround_days_prev_30d: null,
    rollbacks_last_30d: 0,
    pinned_in_production: 0,
    new_pins_last_7d: 0,
  };
}

async function queryConnectorDashboardRows(
  organizationId: string,
): Promise<ConnectorDashboardRow[]> {
  const sql = await loadControlPlaneDatabase();

  return sql<ConnectorDashboardRow[]>`
    select
      connector_installations.id,
      connector_installations.connector_key,
      connector_installations.category,
      connector_installations.kind,
      connector_installations.status,
      connector_installations.config,
      installer.display_name as installed_by_name,
      connector_installations.updated_at,
      coalesce(target_stats.enabled_target_count, 0)::int as enabled_target_count,
      coalesce(target_stats.total_target_count, 0)::int as total_target_count,
      target_stats.enabled_targets,
      latest_run.status as latest_run_status,
      latest_run.started_at as latest_run_started_at,
      latest_run.completed_at as latest_run_completed_at,
      coalesce(run_stats.sync_runs_24h, 0)::int as sync_runs_24h,
      coalesce(run_stats.successful_runs_24h, 0)::int as successful_runs_24h,
      coalesce(run_stats.failed_runs_24h, 0)::int as failed_runs_24h
    from connector_installations
    left join users installer on installer.id = connector_installations.installed_by
    left join lateral (
      select
        count(*) filter (where connector_targets.status = 'enabled')::int as enabled_target_count,
        count(*)::int as total_target_count,
        array_agg(target_ref order by target_ref) filter (where connector_targets.status = 'enabled') as enabled_targets
      from connector_targets
      where connector_targets.connector_installation_id = connector_installations.id
    ) target_stats on true
    left join lateral (
      select status, started_at, completed_at
      from connector_sync_runs
      where connector_sync_runs.connector_installation_id = connector_installations.id
      order by coalesce(completed_at, started_at) desc nulls last, id desc
      limit 1
    ) latest_run on true
    left join lateral (
      select
        count(*) filter (where coalesce(completed_at, started_at) >= now() - interval '24 hours')::int as sync_runs_24h,
        count(*) filter (where status = 'succeeded' and coalesce(completed_at, started_at) >= now() - interval '24 hours')::int as successful_runs_24h,
        count(*) filter (where status = 'failed' and coalesce(completed_at, started_at) >= now() - interval '24 hours')::int as failed_runs_24h
      from connector_sync_runs
      where connector_sync_runs.connector_installation_id = connector_installations.id
    ) run_stats on true
    where connector_installations.organization_id = ${organizationId}
    order by connector_installations.category asc, connector_installations.connector_key asc
  `;
}

async function queryEvaluationDashboardRows(
  organizationId: string,
): Promise<EvaluationDashboardRow[]> {
  const sql = await loadControlPlaneDatabase();

  return sql<EvaluationDashboardRow[]>`
    with latest_skills as (
      select distinct on (skill_id)
        id as indexed_skill_id,
        skill_id,
        display_name,
        tier,
        last_indexed_at
      from indexed_skills
      where organization_id = ${organizationId}
      order by skill_id, last_indexed_at desc
    )
    select
      indexed_eval_results.id as result_id,
      latest_skills.skill_id,
      latest_skills.display_name as skill_name,
      latest_skills.tier as skill_tier,
      indexed_eval_results.run_external_id,
      dataset_asset.logical_name as dataset_logical_name,
      dataset_asset.source_path as dataset_source_path,
      indexed_eval_results.total_cases,
      indexed_eval_results.passed_cases,
      indexed_eval_results.failed_cases,
      indexed_eval_results.status,
      indexed_eval_results.executed_at,
      indexed_eval_results.indexed_at,
      indexed_eval_results.score_delta::float8 as score_delta,
      indexed_eval_results.comparison_commit_sha
    from indexed_eval_results
    inner join latest_skills on latest_skills.indexed_skill_id = indexed_eval_results.indexed_skill_id
    left join indexed_eval_assets dataset_asset
      on dataset_asset.id = indexed_eval_results.dataset_asset_id
    order by coalesce(indexed_eval_results.executed_at, indexed_eval_results.indexed_at) desc nulls last,
      latest_skills.display_name asc
    limit 200
  `;
}

async function queryRepositories(organizationId: string): Promise<RepositoryRow[]> {
  const sql = await loadControlPlaneDatabase();
  return sql<RepositoryRow[]>`
    with skill_counts as (
      select
        repository_id,
        count(distinct skill_id)::int as skill_count
      from indexed_skills
      where organization_id = ${organizationId}
      group by repository_id
    )
    select
      repositories.id,
      repositories.provider_type,
      repositories.owner_name,
      repositories.repo_name,
      repositories.canonical_clone_url,
      repositories.default_branch,
      repositories.status as repo_status,
      repository_sync_state.status as sync_status,
      coalesce(skill_counts.skill_count, 0)::int as skill_count,
      repository_sync_state.last_indexed_at,
      repository_sync_state.last_successful_sync_at,
      repository_sync_state.last_webhook_at,
      coalesce(
        repository_sync_state.last_successful_sync_at,
        repository_sync_state.last_webhook_at,
        repository_sync_state.last_indexed_at,
        repositories.updated_at,
        repositories.created_at
      ) as last_activity_at
    from repositories
    left join repository_sync_state on repository_sync_state.repository_id = repositories.id
    left join skill_counts on skill_counts.repository_id = repositories.id
    where repositories.organization_id = ${organizationId}
    order by last_activity_at desc nulls last, repositories.repo_name asc
  `;
}

async function querySkills(organizationId: string): Promise<SkillRow[]> {
  const sql = await loadControlPlaneDatabase();
  return sql<SkillRow[]>`
    with latest_skills as (
      select distinct on (indexed_skills.skill_id)
        indexed_skills.id as indexed_skill_id,
        indexed_skills.repository_id,
        indexed_skills.skill_id,
        indexed_skills.display_name,
        indexed_skills.tier,
        indexed_skills.owner,
        indexed_skills.status,
        indexed_skills.source_path,
        indexed_skills.source_commit_sha,
        indexed_skills.manifest,
        indexed_skills.default_branch,
        indexed_skills.last_indexed_at,
        repositories.provider_type,
        repositories.owner_name,
        repositories.repo_name,
        repositories.default_branch as repository_default_branch
      from indexed_skills
      inner join repositories on repositories.id = indexed_skills.repository_id
      where indexed_skills.organization_id = ${organizationId}
      order by indexed_skills.skill_id, indexed_skills.last_indexed_at desc
    ),
    version_counts as (
      select
        repository_id,
        skill_id,
        count(*)::int as version_count
      from indexed_skill_versions
      group by repository_id, skill_id
    )
    select
      latest_skills.indexed_skill_id,
      latest_skills.skill_id,
      latest_skills.display_name,
      latest_skills.tier,
      latest_skills.owner,
      latest_skills.status,
      latest_skills.source_path,
      latest_skills.source_commit_sha,
      latest_skills.manifest,
      latest_skills.provider_type,
      latest_skills.owner_name,
      latest_skills.repo_name,
      coalesce(latest_skills.default_branch, latest_skills.repository_default_branch, 'main') as default_branch,
      coalesce(version_counts.version_count, 0)::int as version_count,
      prod.version_ref as prod_ref,
      prod.commit_sha as prod_commit,
      prod.branch_name as prod_branch,
      candidate.version_ref as candidate_ref,
      candidate.commit_sha as candidate_commit,
      eval.latest_score,
      eval.trend_scores,
      eval.last_executed_at,
      latest_skills.last_indexed_at
    from latest_skills
    left join version_counts
      on version_counts.repository_id = latest_skills.repository_id
      and version_counts.skill_id = latest_skills.skill_id
    left join lateral (
      select version_ref, commit_sha, branch_name
      from indexed_skill_versions
      where repository_id = latest_skills.repository_id
        and skill_id = latest_skills.skill_id
        and (is_current_baseline = true or channel = 'production')
      order by is_current_baseline desc, observed_at desc
      limit 1
    ) prod on true
    left join lateral (
      select version_ref, commit_sha, branch_name
      from indexed_skill_versions
      where repository_id = latest_skills.repository_id
        and skill_id = latest_skills.skill_id
        and (is_current_candidate = true or channel in ('staging', 'draft', 'candidate'))
      order by is_current_candidate desc, observed_at desc
      limit 1
    ) candidate on true
    left join lateral (
      select
        round((latest_result.passed_cases::numeric * 100) / greatest(latest_result.total_cases, 1), 1)::float8 as latest_score,
        (
          select array_agg(
            round((recent_result.passed_cases::numeric * 100) / greatest(recent_result.total_cases, 1), 1)::float8
            order by recent_result.executed_at asc nulls first, recent_result.indexed_at asc
          )
          from (
            select passed_cases, total_cases, executed_at, indexed_at
            from indexed_eval_results
            where indexed_skill_id = latest_skills.indexed_skill_id
            order by executed_at desc nulls last, indexed_at desc
            limit 10
          ) recent_result
        ) as trend_scores,
        latest_result.executed_at as last_executed_at
      from lateral (
        select passed_cases, total_cases, executed_at, indexed_at
        from indexed_eval_results
        where indexed_skill_id = latest_skills.indexed_skill_id
        order by executed_at desc nulls last, indexed_at desc
        limit 1
      ) latest_result
    ) eval on true
    order by latest_skills.display_name asc
  `;
}

function filterRepositories(
  repositories: RepositoryListItem[],
  filters: { provider?: string | undefined; status?: string | undefined },
): RepositoryListItem[] {
  return repositories.filter((repository) => {
    if (filters.provider && repository.provider.toLowerCase() !== filters.provider.toLowerCase()) {
      return false;
    }

    if (filters.status && repository.status.toLowerCase() !== filters.status.toLowerCase()) {
      return false;
    }

    return true;
  });
}

function filterSkills(
  skills: SkillListItem[],
  filters: {
    query?: string | undefined;
    tier?: number | undefined;
    team?: string | undefined;
    status?: string | undefined;
    channel?: string | undefined;
  },
): SkillListItem[] {
  return skills.filter((skill) => {
    if (filters.query) {
      const query = filters.query.trim().toLowerCase();
      const haystack = [skill.name, skill.description, skill.owner, skill.team, skill.repo]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (filters.tier && skill.tier !== filters.tier) {
      return false;
    }

    if (filters.team && skill.team.toLowerCase() !== filters.team.toLowerCase()) {
      return false;
    }

    if (filters.status && skill.status.toLowerCase() !== filters.status.toLowerCase()) {
      return false;
    }

    if (filters.channel && skill.channel.toLowerCase() !== filters.channel.toLowerCase()) {
      return false;
    }

    return true;
  });
}

function buildApprovalItems(
  reviewRows: ReviewRequestRow[],
  skillsById: Map<string, SkillListItem>,
): ApprovalItem[] {
  return reviewRows.map((row) => {
    const skill = skillsById.get(row.skill_id);
    const summary = isRecord(row.summary) ? row.summary : null;
    const changeSummary = typeof summary?.changeSummary === "string"
      ? summary.changeSummary
      : "Candidate update awaiting review";

    return {
      id: row.skill_id,
      skill: skill?.name ?? row.skill_id,
      tier: `t${skill?.tier ?? 2}`,
      version: row.candidate_ref,
      change: changeSummary,
      who: row.requested_by ?? "System",
      when: formatRelativeControlPlaneTime(row.updated_at),
      blocking: row.blocking ?? "Pending review",
    };
  });
}

function buildRecentChanges(
  recentSkillRows: RecentSkillRow[],
  skillsById: Map<string, SkillListItem>,
): OverviewPayload["recentChanges"] {
  return recentSkillRows.map((row) => {
    const skill = skillsById.get(row.skill_id);
    const trend = skill?.trend ?? [];

    return {
      skill: skill?.name ?? row.display_name,
      ref: row.source_commit_sha.slice(0, 7),
      who: row.owner ?? skill?.owner ?? "Indexer",
      when: formatRelativeControlPlaneTime(row.last_indexed_at),
      delta: buildDeltaLabel(trend),
      env: skill?.channel ?? "draft",
    };
  });
}

function buildRegressions(
  regressionRows: RegressionRow[],
  skillsById: Map<string, SkillListItem>,
): RegressionItem[] {
  return regressionRows.map((row) => {
    const skill = skillsById.get(row.skill_id);
    const currentScore = skill?.score ?? 0;
    const delta = row.score_delta ?? 0;
    const previousScore = roundScore(currentScore - delta) ?? 0;
    const severity = Math.abs(delta) >= 10
      ? "critical"
      : Math.abs(delta) >= 4
        ? "moderate"
        : "minor";

    return {
      skill: skill?.name ?? row.skill_id,
      metric: "Evaluation score",
      from: previousScore,
      to: roundScore(currentScore) ?? currentScore,
      severity,
      unit: "%",
    };
  });
}

const AUDIT_CATEGORY_VALUES = new Set<AuditCategory>([
  "approval",
  "release",
  "evaluation",
  "access",
  "version",
  "policy",
  "repo",
  "review",
]);

function normalizeAuditCategory(category: string): AuditCategory {
  const normalized = category.trim().toLowerCase();
  if (AUDIT_CATEGORY_VALUES.has(normalized as AuditCategory)) {
    return normalized as AuditCategory;
  }

  if (normalized.includes("approv")) {
    return "approval";
  }

  if (normalized.includes("releas")) {
    return "release";
  }

  if (normalized.includes("eval")) {
    return "evaluation";
  }

  if (normalized.includes("access") || normalized.includes("member") || normalized.includes("group")) {
    return "access";
  }

  if (normalized.includes("policy")) {
    return "policy";
  }

  if (normalized.includes("repo")) {
    return "repo";
  }

  if (normalized.includes("version") || normalized.includes("skill")) {
    return "version";
  }

  return "review";
}

function mapAuditNode(action: string): AuditHighlightItem["node"] {
  const normalized = action.toLowerCase();
  if (normalized.includes("approve") || normalized.includes("release")) {
    return "moss";
  }

  if (normalized.includes("block") || normalized.includes("hold") || normalized.includes("warn")) {
    return "brass";
  }

  if (normalized.includes("reject") || normalized.includes("fail") || normalized.includes("rollback")) {
    return "blood";
  }

  return "slate";
}

function formatAuditEventClockTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

export function resolveAuditRangeLowerBound(
  range: AuditEventRange,
  now = new Date(),
): Date | null {
  if (range === "all") {
    return null;
  }

  const result = new Date(now);
  switch (range) {
    case "24h":
      result.setHours(result.getHours() - 24);
      return result;
    case "30d":
      result.setDate(result.getDate() - 30);
      return result;
    case "90d":
      result.setDate(result.getDate() - 90);
      return result;
    case "7d":
    default:
      result.setDate(result.getDate() - 7);
      return result;
  }
}

function buildAuditSkillNameLookup(rows: AuditSkillLookupRow[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const row of rows) {
    lookup.set(row.skill_id, row.display_name);
    lookup.set(deriveSkillUuid(row), row.display_name);
  }

  return lookup;
}

function buildAuditRepositoryNameLookup(rows: AuditRepositoryLookupRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, `${row.owner_name}/${row.repo_name}`]));
}

function resolveAuditTargetLabel(
  row: Pick<AuditEventRow, "target_ref" | "target_type">,
  lookups: {
    repositoryNames?: ReadonlyMap<string, string>;
    skillNames?: ReadonlyMap<string, string>;
  },
): string {
  const targetType = row.target_type.trim().toLowerCase();

  if (targetType === "skill") {
    return lookups.skillNames?.get(row.target_ref) ?? `skill ${row.target_ref}`;
  }

  if (targetType === "repository" || targetType === "repo") {
    return lookups.repositoryNames?.get(row.target_ref) ?? `repository ${row.target_ref}`;
  }

  if (targetType === "policy") {
    return `policy ${row.target_ref}`;
  }

  if (targetType === "release_request") {
    return `release ${row.target_ref}`;
  }

  if (targetType === "review_request") {
    return `review ${row.target_ref}`;
  }

  if (targetType === "connector_installation") {
    return `connector ${row.target_ref}`;
  }

  return row.target_ref;
}

export function buildAuditEventRecord(
  row: AuditEventRow,
  context: Pick<TenantReadContext, "identity">,
  lookups: {
    repositoryNames?: ReadonlyMap<string, string>;
    skillNames?: ReadonlyMap<string, string>;
  } = {},
  now = new Date(),
): AuditEventRecord {
  const who = row.actor_ref === context.identity?.subject || row.actor_ref === context.identity?.email
    ? context.identity.displayName
    : row.actor_ref;

  return {
    occurredAt: serializeControlPlaneTimestamp(row.occurred_at) ?? new Date(0).toISOString(),
    when: formatRelativeControlPlaneTime(row.occurred_at, now),
    time: formatAuditEventClockTime(row.occurred_at),
    who,
    action: row.action,
    target: resolveAuditTargetLabel(row, lookups),
    category: normalizeAuditCategory(row.category),
    node: mapAuditNode(row.action),
  };
}

function buildAuditHighlights(
  rows: AuditEventRow[],
  context: TenantReadContext,
  skillsById: Map<string, SkillListItem>,
): AuditHighlightItem[] {
  return rows.map((row) => {
    const actorName = row.actor_ref === context.identity?.subject
      ? context.identity.displayName
      : row.actor_ref;
    const skill = skillsById.get(row.target_ref);

    return {
      when: formatRelativeControlPlaneTime(row.occurred_at),
      who: actorName,
      action: row.action,
      target: skill?.name ?? `${row.target_type} ${row.target_ref}`,
      node: mapAuditNode(row.action),
    };
  });
}

function buildReleaseReadiness(row: ReleaseQueueRow): ReleaseQueueItem["readiness"] {
  return [
    {
      label: "Approvals",
      ok: row.approvals_required > 0 ? row.approvals_done >= row.approvals_required : null,
      meta: row.approvals_required > 0
        ? `${row.approvals_done}/${row.approvals_required} approvals`
        : "No approvers assigned yet",
    },
    {
      label: "Targets",
      ok: row.targets && row.targets.length > 0 ? true : null,
      meta: row.targets && row.targets.length > 0
        ? row.targets.join(", ")
        : "No release targets configured",
    },
    {
      label: "Status",
      ok: row.status === "approved" ? true : row.status === "blocked" ? false : null,
      meta: row.status,
    },
  ];
}

function buildReleaseQueueItems(
  rows: ReleaseQueueRow[],
  skillsById: Map<string, SkillListItem>,
): ReleaseQueueItem[] {
  return rows.map((row) => {
    const skill = skillsById.get(row.skill_id);
    const readiness = buildReleaseReadiness(row);
    const readinessPct = row.approvals_required > 0
      ? Math.min(row.approvals_done / row.approvals_required, 1)
      : row.targets && row.targets.length > 0
        ? 1
        : 0;

    return {
      id: row.id,
      skill: skill?.name ?? row.skill_id,
      candidateRef: row.source_ref,
      candidateCommit: row.source_commit_sha,
      fromEnv: row.from_environment as ReleaseQueueItem["fromEnv"],
      toEnv: row.to_environment as ReleaseQueueItem["toEnv"],
      requested: row.requested_by ?? "System",
      when: formatRelativeControlPlaneTime(row.created_at),
      approvalsDone: row.approvals_done,
      approvalsRequired: row.approvals_required,
      approvalsBlocked: row.approvals_blocked,
      readinessPct,
      readiness,
      targets: row.targets ?? [],
    };
  });
}

async function queryOverviewDecorations(organizationId: string) {
  const sql = await loadControlPlaneDatabase();

  const [reviewRows, recentSkillRows, regressionRows, auditRows, releaseRows, reviewMetrics, releaseMetrics] = await Promise.all([
    sql<ReviewRequestRow[]>`
      select
        review_requests.id,
        review_requests.skill_id,
        review_requests.candidate_ref,
        review_requests.updated_at,
        requester.display_name as requested_by,
        coalesce(
          review_requests.summary->>'blocking',
          review_requests.summary->>'requiredRole',
          'Pending review'
        ) as blocking,
        review_requests.summary
      from review_requests
      left join users requester on requester.id = review_requests.requested_by
      where review_requests.organization_id = ${organizationId}
        and review_requests.status = 'open'
      order by review_requests.updated_at desc
      limit 5
    `,
    sql<RecentSkillRow[]>`
      select
        skill_id,
        display_name,
        source_commit_sha,
        owner,
        last_indexed_at
      from indexed_skills
      where organization_id = ${organizationId}
      order by last_indexed_at desc
      limit 5
    `,
    sql<RegressionRow[]>`
      with latest_regressions as (
        select distinct on (indexed_skills.skill_id)
          indexed_skills.skill_id,
          indexed_eval_results.score_delta::float8 as score_delta,
          indexed_eval_results.passed_cases,
          indexed_eval_results.total_cases,
          coalesce(indexed_eval_results.executed_at, indexed_eval_results.indexed_at) as observed_at
        from indexed_eval_results
        inner join indexed_skills on indexed_skills.id = indexed_eval_results.indexed_skill_id
        where indexed_skills.organization_id = ${organizationId}
          and indexed_eval_results.score_delta < 0
        order by indexed_skills.skill_id, observed_at desc
      )
      select skill_id, score_delta, passed_cases, total_cases
      from latest_regressions
      order by score_delta asc
      limit 3
    `,
    sql<AuditEventRow[]>`
      select actor_type, actor_ref, category, action, target_type, target_ref, occurred_at
      from audit_events
      where organization_id = ${organizationId}
      order by occurred_at desc
      limit 5
    `,
    sql<ReleaseQueueRow[]>`
      select
        release_requests.id,
        release_requests.skill_id,
        release_requests.source_ref,
        release_requests.source_commit_sha,
        release_requests.from_environment,
        release_requests.to_environment,
        release_requests.status,
        release_requests.created_at,
        requester.display_name as requested_by,
        coalesce(approval_counts.approved_count, 0)::int as approvals_done,
        coalesce(approval_counts.total_count, 0)::int as approvals_required,
        approval_counts.blocked_role as approvals_blocked,
        target_list.targets
      from release_requests
      left join users requester on requester.id = release_requests.requested_by
      left join lateral (
        select
          count(*)::int as total_count,
          count(*) filter (where status = 'approved')::int as approved_count,
          min(required_role) filter (where status <> 'approved') as blocked_role
        from release_approvals
        where release_request_id = release_requests.id
      ) approval_counts on true
      left join lateral (
        select array_agg(target_key order by target_key) as targets
        from release_targets
        where release_request_id = release_requests.id
      ) target_list on true
      where release_requests.organization_id = ${organizationId}
        and release_requests.status in ('pending', 'approved', 'blocked')
      order by release_requests.created_at desc
      limit 3
    `,
    sql<ReviewMetricRow[]>`
      select
        count(*) filter (where status in ('approved', 'rejected', 'blocked'))::int as completed_reviews,
        count(*) filter (where status = 'approved')::int as approved_reviews
      from review_requests
      where organization_id = ${organizationId}
    `,
    sql<ReleaseMetricRow[]>`
      select
        avg(extract(epoch from (updated_at - created_at)) / 86400)::float8 as avg_turnaround_days,
        count(*) filter (where status = 'released')::int as released_count
      from release_requests
      where organization_id = ${organizationId}
    `,
  ]);

  return {
    reviewRows,
    recentSkillRows,
    regressionRows,
    auditRows,
    releaseRows,
    reviewMetrics: reviewMetrics[0] ?? { completed_reviews: 0, approved_reviews: 0 },
    releaseMetrics: releaseMetrics[0] ?? { avg_turnaround_days: 0, released_count: 0 },
  };
}

async function queryAuditSkillLookup(organizationId: string): Promise<AuditSkillLookupRow[]> {
  const sql = await loadControlPlaneDatabase();
  return sql<AuditSkillLookupRow[]>`
    select distinct on (skill_id)
      id as indexed_skill_id,
      skill_id,
      display_name,
      manifest
    from indexed_skills
    where organization_id = ${organizationId}
    order by skill_id, last_indexed_at desc
  `;
}

async function queryAuditRepositoryLookup(organizationId: string): Promise<AuditRepositoryLookupRow[]> {
  const sql = await loadControlPlaneDatabase();
  return sql<AuditRepositoryLookupRow[]>`
    select id, owner_name, repo_name
    from repositories
    where organization_id = ${organizationId}
  `;
}

export async function readAuditEventsFromDatabase(
  context: TenantReadContext,
  filters: {
    range?: AuditEventRange | undefined;
  } = {},
): Promise<AuditListResponse> {
  const sql = await loadControlPlaneDatabase();
  const range = filters.range ?? "7d";
  const lowerBound = resolveAuditRangeLowerBound(range);

  const [auditRows, skillLookupRows, repositoryLookupRows] = await Promise.all([
    sql<AuditEventRow[]>`
      select actor_type, actor_ref, category, action, target_type, target_ref, occurred_at
      from audit_events
      where organization_id = ${context.tenant.organizationId}
        and (${lowerBound}::timestamptz is null or occurred_at >= ${lowerBound}::timestamptz)
      order by occurred_at desc
      limit 250
    `,
    queryAuditSkillLookup(context.tenant.organizationId),
    queryAuditRepositoryLookup(context.tenant.organizationId),
  ]);

  const skillNames = buildAuditSkillNameLookup(skillLookupRows);
  const repositoryNames = buildAuditRepositoryNameLookup(repositoryLookupRows);
  const data = auditRows.map((row) => buildAuditEventRecord(row, context, {
    repositoryNames,
    skillNames,
  }));

  return {
    data,
    meta: {
      ...createMeta("database"),
      count: data.length,
    },
  };
}

export async function readPoliciesFromDatabase(
  context: TenantReadContext,
): Promise<PolicyListResponse> {
  const sql = await loadControlPlaneDatabase();

  const [policyRows, auditRows] = await Promise.all([
    queryPolicies(context.tenant.organizationId),
    sql<AuditEventRow[]>`
      select actor_type, actor_ref, category, action, target_type, target_ref, occurred_at
      from audit_events
      where organization_id = ${context.tenant.organizationId}
        and (lower(category) = 'policy' or lower(target_type) = 'policy')
      order by occurred_at desc
      limit 250
    `,
  ]);

  const recentActivityByPolicyId = buildPolicyActivityLookup(policyRows, auditRows, context);
  const data = policyRows.map((row) => buildPolicySummary(row, recentActivityByPolicyId.get(row.id) ?? []));

  return {
    data,
    meta: {
      ...createMeta("database"),
      count: data.length,
    },
  };
}

export async function readReleasesDashboardFromDatabase(
  context: TenantReadContext,
): Promise<ReleaseDashboardResponse> {
  const skills = (await querySkills(context.tenant.organizationId)).map(buildSkillListItem);
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));

  const [queueRows, historyRows, metricRow] = await Promise.all([
    queryReleaseDashboardQueueRows(context.tenant.organizationId),
    queryReleaseHistoryRows(context.tenant.organizationId),
    queryReleaseDashboardMetricRow(context.tenant.organizationId),
  ]);

  const inMotion = buildReleaseDashboardQueueItems(queueRows, skillsById);
  const history = historyRows.map((row) => buildReleaseHistoryItem(row, skillsById));
  const latestRollback = history.find((item) => item.outcome === "rolled-back") ?? null;

  return {
    data: {
      kpis: buildReleaseDashboardMetrics({
        activeCandidates: inMotion.length,
        blockedCandidates: inMotion.filter((item) => item.approvalsBlocked != null).length,
        readyCandidates: inMotion.filter((item) => item.readiness.every((check) => check.ok === true)).length,
        averageTurnaroundDaysLast30d: metricRow.avg_turnaround_days_last_30d,
        averageTurnaroundDaysPrev30d: metricRow.avg_turnaround_days_prev_30d,
        releasedCountLast30d: metricRow.released_last_30d,
        rollbackCountLast30d: metricRow.rollbacks_last_30d,
        latestRollback,
        pinnedInProduction: metricRow.pinned_in_production,
        newPinsLast7d: metricRow.new_pins_last_7d,
      }),
      inMotion,
      history,
    },
    meta: createMeta("database"),
  };
}

export async function readConnectorsDashboardFromDatabase(
  context: TenantReadContext,
): Promise<ConnectorDashboardResponse> {
  const connectorRows = await queryConnectorDashboardRows(context.tenant.organizationId);
  const connectors = connectorRows.map((row) => buildConnectorRecord(row));

  return {
    data: {
      kpis: buildConnectorDashboardMetrics({
        activeConnectors: connectors.filter((connector) => connector.status !== "offline").length,
        totalConnectors: connectors.length,
        enabledTargets: connectorRows.reduce((sum, row) => sum + row.enabled_target_count, 0),
        localConnectors: connectors.filter((connector) => connector.category === "local").length,
        nativeConnectors: connectors.filter((connector) => connector.category === "native").length,
        notifyConnectors: connectors.filter((connector) => connector.category === "notify").length,
        bundleConnectors: connectors.filter((connector) => connector.category === "bundle").length,
        syncRuns24h: connectorRows.reduce((sum, row) => sum + row.sync_runs_24h, 0),
        successfulRuns24h: connectorRows.reduce((sum, row) => sum + row.successful_runs_24h, 0),
        failedRuns24h: connectorRows.reduce((sum, row) => sum + row.failed_runs_24h, 0),
        issues: connectors.filter((connector) => connector.status !== "healthy").length,
        degradedCount: connectors.filter((connector) => connector.status === "degraded").length,
        warningCount: connectors.filter((connector) => connector.status === "warning").length,
        offlineCount: connectors.filter((connector) => connector.status === "offline").length,
      }),
      connectors,
    },
    meta: createMeta("database"),
  };
}

export async function readEvaluationsDashboardFromDatabase(
  context: TenantReadContext,
): Promise<EvaluationDashboardResponse> {
  const [skillRows, evaluationRows] = await Promise.all([
    querySkills(context.tenant.organizationId),
    queryEvaluationDashboardRows(context.tenant.organizationId),
  ]);

  const runs = evaluationRows.map(buildEvaluationRunListItem);
  const now = new Date();
  const regressions = runs.filter((run) => run.status === "complete-with-regressions" || run.status === "failed");
  const regressionsLast24h = regressions.filter((run) => {
    const timestamp = run.startedAt ? new Date(run.startedAt) : null;
    return timestamp != null && Number.isFinite(timestamp.getTime())
      ? timestamp.getTime() >= now.getTime() - (1000 * 60 * 60 * 24)
      : false;
  }).length;

  return {
    data: {
      kpis: buildEvaluationDashboardMetrics({
        totalSkills: skillRows.length,
        evaluatedSkills: new Set(runs.map((run) => run.skillId)).size,
        averageCasesPerRun: runs.length > 0
          ? runs.reduce((sum, run) => sum + run.cases, 0) / runs.length
          : null,
        totalRuns: runs.length,
        regressionsLast24h,
        latestRegressionSkill: regressions[0]?.skill ?? null,
        medianPassRate: median(runs.map((run) => run.passRate)),
        runningRuns: runs.filter((run) => run.status === "running").length,
        regressionRuns: regressions.length,
      }),
      runs,
      coverageByTier: buildEvaluationTierCoverage(skillRows, runs),
    },
    meta: createMeta("derived-index"),
  };
}

export async function readRepositoriesFromDatabase(
  context: TenantReadContext,
  filters: { provider?: string | undefined; status?: string | undefined } = {},
): Promise<RepositoryListResponse> {
  const repositories = filterRepositories(
    (await queryRepositories(context.tenant.organizationId)).map(buildRepositoryListItem),
    filters,
  );

  return {
    data: repositories,
    meta: {
      ...createMeta("mixed"),
      count: repositories.length,
    },
  };
}

export async function readRepositoryDetailFromDatabase(
  context: TenantReadContext,
  id: string,
): Promise<RepositoryDetailResponse | null> {
  const sql = await loadControlPlaneDatabase();

  const [repositoryRows, tierCounts, permissionRows, commitRows] = await Promise.all([
    sql<RepositoryDetailRow[]>`
      select
        repositories.id,
        repositories.provider_type,
        repositories.owner_name,
        repositories.repo_name,
        repositories.canonical_clone_url,
        repositories.default_branch,
        repositories.status as repo_status,
        repositories.visibility,
        repository_sync_state.status as sync_status,
        repository_sync_state.sync_mode,
        repository_sync_state.last_indexed_at,
        repository_sync_state.last_successful_sync_at,
        repository_sync_state.last_webhook_at,
        repository_webhooks.status as webhook_status,
        repository_webhooks.last_delivery_at as webhook_last_delivery_at,
        (
          select count(distinct skill_id)::int
          from indexed_skills
          where repository_id = repositories.id
        ) as skill_count,
        coalesce(
          repository_sync_state.last_successful_sync_at,
          repository_sync_state.last_webhook_at,
          repository_sync_state.last_indexed_at,
          repositories.updated_at,
          repositories.created_at
        ) as last_activity_at
      from repositories
      left join repository_sync_state on repository_sync_state.repository_id = repositories.id
      left join repository_webhooks on repository_webhooks.repository_id = repositories.id
      where repositories.organization_id = ${context.tenant.organizationId}
        and repositories.id = ${id}
      limit 1
    `,
    sql<RepositoryTierCountRow[]>`
      with latest_repository_skills as (
        select distinct on (skill_id)
          skill_id,
          tier
        from indexed_skills
        where organization_id = ${context.tenant.organizationId}
          and repository_id = ${id}
        order by skill_id, last_indexed_at desc
      )
      select tier, count(*)::int as skill_count
      from latest_repository_skills
      group by tier
    `,
    sql<RepositoryPermissionRow[]>`
      select granted_to_ref
      from repository_permissions
      where repository_id = ${id}
      order by created_at asc
      limit 8
    `,
    sql<RepositoryCommitRow[]>`
      select
        source_commit_sha as commit,
        max(last_indexed_at) as last_indexed_at,
        min(display_name) as display_name
      from indexed_skills
      where organization_id = ${context.tenant.organizationId}
        and repository_id = ${id}
      group by source_commit_sha
      order by max(last_indexed_at) desc
      limit 5
    `,
  ]);

  const repositoryRow = repositoryRows[0];
  if (!repositoryRow) {
    return null;
  }

  const repository = buildRepositoryListItem(repositoryRow);
  const skillsByTier: RepositoryDetailRecord["skillsByTier"] = { 1: 0, 2: 0, 3: 0 };
  for (const row of tierCounts) {
    skillsByTier[mapTier(row.tier)] = row.skill_count;
  }

  const details: RepositoryDetailRecord = {
    description: `Tenant-owned ${repository.provider} repository connected to Savant for ${context.tenant.workspaceName}.`,
    visibility: repositoryRow.visibility,
    syncMode: repositoryRow.sync_mode ?? "manual",
    webhookHealth: repositoryRow.webhook_status === "active"
      ? repositoryRow.webhook_last_delivery_at
        ? "ok"
        : "pending"
      : repositoryRow.webhook_status ?? "pending",
    defaultBranch: repositoryRow.default_branch,
    protectedBranches: [repositoryRow.default_branch],
    tierPolicy: "Inherited from workspace policy",
    members: permissionRows.map((row) => row.granted_to_ref),
    skillsByTier,
    recentCommits: commitRows.map((row) => ({
      commit: row.commit.slice(0, 7),
      who: "indexer",
      when: formatRelativeControlPlaneTime(row.last_indexed_at),
      msg: `Indexed ${row.display_name}`,
    } satisfies RepositoryCommitSummary)),
  };

  return {
    data: {
      repository,
      details,
    },
    meta: createMeta("mixed"),
  };
}

export async function readSkillsFromDatabase(
  context: TenantReadContext,
  filters: {
    query?: string | undefined;
    tier?: number | undefined;
    team?: string | undefined;
    status?: string | undefined;
    channel?: string | undefined;
  } = {},
): Promise<SkillListResponse> {
  const skills = filterSkills(
    (await querySkills(context.tenant.organizationId)).map(buildSkillListItem),
    filters,
  );

  return {
    data: skills,
    meta: {
      ...createMeta("derived-index"),
      count: skills.length,
    },
  };
}

export async function readSkillDetailFromDatabase(
  context: TenantReadContext,
  id: string,
): Promise<SkillDetailResponse | null> {
  const sql = await loadControlPlaneDatabase();
  const skills = (await querySkills(context.tenant.organizationId)).map(buildSkillListItem);
  const skill = findSkillByIdentifier(skills, id);

  if (!skill) {
    return null;
  }

  const skillKey = skill.id;

  const [evaluationRows, commentRows, versionRows, accessGrantRows, accessPolicyRows, activityRows, activeReleaseRows, auditRows] = await Promise.all([
    sql<EvaluationRow[]>`
      select
        indexed_eval_results.id as result_id,
        run_external_id,
        dataset_asset.logical_name as dataset_logical_name,
        dataset_asset.source_path as dataset_source_path,
        total_cases,
        passed_cases,
        failed_cases,
        status,
        executed_at,
        indexed_at,
        score_delta::float8 as score_delta,
        comparison_commit_sha
      from indexed_eval_results
      left join indexed_eval_assets dataset_asset
        on dataset_asset.id = indexed_eval_results.dataset_asset_id
      where indexed_skill_id in (
        select id
        from indexed_skills
        where organization_id = ${context.tenant.organizationId}
          and skill_id = ${skillKey}
      )
      order by executed_at desc nulls last, indexed_at desc
      limit 10
    `,
    sql<ReviewCommentRow[]>`
      select
        author.display_name as author_name,
        review_comments.body,
        review_comments.created_at
      from review_comments
      inner join review_requests on review_requests.id = review_comments.review_request_id
      left join users author on author.id = review_comments.author_user_id
      where review_requests.organization_id = ${context.tenant.organizationId}
        and review_requests.skill_id = ${skillKey}
      order by review_comments.created_at desc
      limit 10
    `,
    sql<VersionHistoryRow[]>`
      select
        indexed_skill_versions.version_ref,
        indexed_skill_versions.commit_sha,
        indexed_skill_versions.channel,
        indexed_skill_versions.observed_at,
        indexed_skill_versions.branch_name,
        latest_scores.score_pct
      from indexed_skill_versions
      left join lateral (
        select
          round((indexed_eval_results.passed_cases::numeric * 100) / greatest(indexed_eval_results.total_cases, 1), 1)::float8 as score_pct
        from indexed_eval_results
        inner join indexed_skills on indexed_skills.id = indexed_eval_results.indexed_skill_id
        where indexed_skills.organization_id = ${context.tenant.organizationId}
          and indexed_skills.skill_id = ${skillKey}
          and indexed_eval_results.comparison_commit_sha = indexed_skill_versions.commit_sha
        order by indexed_eval_results.executed_at desc nulls last, indexed_eval_results.indexed_at desc
        limit 1
      ) latest_scores on true
      where indexed_skill_versions.skill_id = ${skillKey}
        and indexed_skill_versions.repository_id in (
          select repository_id
          from indexed_skills
          where organization_id = ${context.tenant.organizationId}
            and skill_id = ${skillKey}
        )
      order by indexed_skill_versions.observed_at desc
      limit 10
    `,
    sql<AccessGrantRow[]>`
      select
        groups.name,
        count(group_memberships.user_id)::int as member_count,
        min(repository_permissions.permission_key) as permission_key,
        'idp-sync' as source,
        max(groups.updated_at) as updated_at
      from groups
      left join group_memberships on group_memberships.group_id = groups.id
      left join repository_permissions on repository_permissions.granted_to_ref = groups.name
      where groups.organization_id = ${context.tenant.organizationId}
      group by groups.id, groups.name
      order by groups.name asc
      limit 8
    `,
    sql<AccessPolicyRow[]>`
      select name, policy_type, scope_type, scope_ref
      from access_policies
      where organization_id = ${context.tenant.organizationId}
        and state = 'active'
      order by updated_at desc
      limit 6
    `,
    sql<ActivityLogRow[]>`
      select actor_ref, action, target_ref, occurred_at
      from audit_events
      where organization_id = ${context.tenant.organizationId}
        and (target_ref = ${skillKey} or target_ref = ${skill.skillUuid})
      order by occurred_at desc
      limit 10
    `,
    sql<ActiveReleaseRow[]>`
      select
        release_requests.id,
        release_requests.source_ref,
        release_requests.source_commit_sha,
        release_requests.from_environment,
        release_requests.to_environment,
        release_requests.status,
        release_requests.created_at,
        requester.display_name as requested_by,
        coalesce(approval_counts.approved_count, 0)::int as approvals_done,
        coalesce(approval_counts.total_count, 0)::int as approvals_required,
        approval_counts.blocked_role as approvals_blocked,
        target_list.targets
      from release_requests
      left join users requester on requester.id = release_requests.requested_by
      left join lateral (
        select
          count(*)::int as total_count,
          count(*) filter (where status = 'approved')::int as approved_count,
          min(required_role) filter (where status <> 'approved') as blocked_role
        from release_approvals
        where release_request_id = release_requests.id
      ) approval_counts on true
      left join lateral (
        select array_agg(target_key order by target_key) as targets
        from release_targets
        where release_request_id = release_requests.id
      ) target_list on true
      where release_requests.organization_id = ${context.tenant.organizationId}
        and release_requests.skill_id = ${skillKey}
        and release_requests.status in ('pending', 'approved', 'blocked')
      order by release_requests.created_at desc
      limit 1
    `,
    sql<AuditEventRow[]>`
      select actor_type, actor_ref, category, action, target_type, target_ref, occurred_at
      from audit_events
      where organization_id = ${context.tenant.organizationId}
        and (target_ref = ${skillKey} or target_ref = ${skill.skillUuid})
      order by occurred_at desc
      limit 5
    `,
  ]);

  const evaluations: EvalRunSummary[] = evaluationRows.map((row, index) => ({
    id: row.result_id ?? row.run_external_id ?? `${skill.id}-eval-${index + 1}`,
    skill: skill.name,
    ref: row.comparison_commit_sha?.slice(0, 7) ?? skill.candidateRef !== "—" ? skill.candidateRef : skill.ref,
    dataset: resolveIndexedEvalDatasetLabel(row),
    cases: row.total_cases,
    passed: row.passed_cases,
    failed: row.failed_cases,
    started: formatRelativeControlPlaneTime(row.executed_at ?? row.indexed_at),
    duration: "—",
    delta: roundScore(row.score_delta),
    status: row.status === "complete_with_regressions"
      ? "complete-with-regressions"
      : row.status === "complete_baseline"
        ? "complete-baseline"
        : row.status === "running"
          ? "running"
          : row.status === "failed"
            ? "failed"
            : "complete",
  }));

  const approvalTimeline: ApprovalTimelineItem[] = activeReleaseRows[0]
    ? [
        {
          who: activeReleaseRows[0].requested_by ?? "System",
          role: "Requester",
          action: activeReleaseRows[0].status,
          when: formatRelativeControlPlaneTime(activeReleaseRows[0].created_at),
          node: activeReleaseRows[0].status === "blocked" ? "brass" : "slate",
        },
      ]
    : [];

  const requiredApprovals: RequiredApprovalItem[] = activeReleaseRows[0]?.approvals_required
    ? [
        {
          role: activeReleaseRows[0].approvals_blocked ?? "Approver",
          assignee: null,
          status: activeReleaseRows[0].approvals_done >= activeReleaseRows[0].approvals_required
            ? "approved"
            : "pending",
          when: null,
        },
      ]
    : [];

  const reviewerComments: ReviewerComment[] = commentRows.map((row) => ({
    who: row.author_name ?? "Reviewer",
    when: formatRelativeControlPlaneTime(row.created_at),
    text: row.body,
  }));

  const versionHistory: VersionHistoryItem[] = versionRows.map((row, index, rows) => ({
    ref: row.version_ref,
    commit: row.commit_sha.slice(0, 7),
    who: skill.owner,
    when: formatRelativeControlPlaneTime(row.observed_at),
    channel: row.channel === "production"
      ? "production"
      : row.channel === "candidate" || row.channel === "staging" || row.channel === "draft"
        ? "candidate"
        : "archived",
    score: roundScore(row.score_pct) ?? skill.score ?? 0,
    delta: index < rows.length - 1
      ? roundScore((row.score_pct ?? 0) - (rows[index + 1]?.score_pct ?? 0)) ?? 0
      : 0,
  }));

  const accessGrants: AccessGrantItem[] = accessGrantRows.map((row) => ({
    name: row.name,
    members: row.member_count,
    permission: row.permission_key ?? "view + use",
    source: row.source,
    lastSync: formatRelativeControlPlaneTime(row.updated_at),
  }));

  const accessPolicyRules: AccessPolicyRuleItem[] = accessPolicyRows.map((row) => ({
    rule: row.name,
    value: `${row.policy_type} · ${row.scope_type}:${row.scope_ref}`,
  }));

  const activityLog: ActivityEventItem[] = activityRows.map((row) => ({
    when: formatRelativeControlPlaneTime(row.occurred_at),
    who: row.actor_ref === context.identity?.subject ? context.identity.displayName : row.actor_ref,
    action: row.action,
    target: row.target_ref,
    node: mapAuditNode(row.action),
  }));

  const activeRelease = activeReleaseRows[0]
    ? buildReleaseQueueItems([
        {
          id: activeReleaseRows[0].id,
          skill_id: skill.id,
          source_ref: activeReleaseRows[0].source_ref,
          source_commit_sha: activeReleaseRows[0].source_commit_sha,
          from_environment: activeReleaseRows[0].from_environment,
          to_environment: activeReleaseRows[0].to_environment,
          status: activeReleaseRows[0].status,
          created_at: activeReleaseRows[0].created_at,
          requested_by: activeReleaseRows[0].requested_by,
          approvals_done: activeReleaseRows[0].approvals_done,
          approvals_required: activeReleaseRows[0].approvals_required,
          approvals_blocked: activeReleaseRows[0].approvals_blocked,
          targets: activeReleaseRows[0].targets,
        },
      ], new Map([[skill.id, skill]]))[0] ?? null
    : null;

  const auditHighlights = buildAuditHighlights(auditRows, context, new Map([[skill.id, skill]]));

  const payload: SkillDetailPayload = {
    skill,
    evaluations,
    rubricBaseline: [] satisfies RubricComparisonRow[],
    approvalTimeline,
    requiredApprovals,
    reviewerComments,
    flaggedCases: [] satisfies FlaggedCaseItem[],
    versionHistory,
    accessGrants,
    accessPolicyRules,
    activityLog,
    activeRelease,
    auditHighlights,
  };

  return {
    data: payload,
    meta: createMeta("mixed"),
  };
}

export async function readOverviewFromDatabase(
  context: ResolvedTenantContext,
): Promise<OverviewResponse> {
  const [repositoriesResponse, skillsResponse, decorations] = await Promise.all([
    readRepositoriesFromDatabase(context),
    readSkillsFromDatabase(context),
    queryOverviewDecorations(context.tenant.organizationId),
  ]);

  const skillsById = new Map(skillsResponse.data.map((skill) => [skill.id, skill]));
  const approvals = buildApprovalItems(decorations.reviewRows, skillsById);
  const recentChanges = buildRecentChanges(decorations.recentSkillRows, skillsById);
  const regressions = buildRegressions(decorations.regressionRows, skillsById);
  const auditHighlights = buildAuditHighlights(decorations.auditRows, context, skillsById);
  const releaseQueue = buildReleaseQueueItems(decorations.releaseRows, skillsById);

  const payload: OverviewPayload = {
    organization: buildOrganizationSummary(context),
    counts: {
      skillsUnderGovernance: skillsResponse.data.length,
      pendingApprovals: approvals.length,
      activeRegressionAlerts: regressions.length,
      connectedRepositories: repositoriesResponse.data.length,
    },
    kpis: buildOverviewKpis({
      indexedSkills: skillsResponse.data.length,
      productionSkills: skillsResponse.data.filter((skill) => skill.channel === "production").length,
      skillsWithEvaluations: skillsResponse.data.filter((skill) => skill.score != null).length,
      completedReviews: decorations.reviewMetrics.completed_reviews,
      approvedReviews: decorations.reviewMetrics.approved_reviews,
      averageReleaseTurnaroundDays: decorations.releaseMetrics.avg_turnaround_days ?? 0,
      releasedCount: decorations.releaseMetrics.released_count,
    }),
    approvals,
    recentChanges,
    regressions,
    repositories: repositoriesResponse.data,
    auditHighlights,
    releaseQueue,
  };

  return {
    data: payload,
    meta: createMeta("mixed"),
  };
}
