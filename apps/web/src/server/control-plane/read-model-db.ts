import type {
  AccessGrantItem,
  AccessPolicyRuleItem,
  ActivityEventItem,
  ApiErrorResponse,
  ApprovalItem,
  ApprovalTimelineItem,
  AuditHighlightItem,
  ControlPlaneResponseMeta,
  EvalRunSummary,
  FlaggedCaseItem,
  OverviewKpi,
  OverviewPayload,
  OverviewResponse,
  RegressionItem,
  ReleaseQueueItem,
  RepositoryCommitSummary,
  RepositoryDetailRecord,
  RepositoryDetailResponse,
  RepositoryListItem,
  RepositoryListResponse,
  RepositorySyncStatus,
  RequiredApprovalItem,
  ReviewerComment,
  RubricComparisonRow,
  SkillDetailPayload,
  SkillDetailResponse,
  SkillListItem,
  SkillListResponse,
  VersionHistoryItem,
} from "@savant/types";

import { getInitials } from "../../lib/auth0-session.ts";
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
  default_branch: string;
  repo_status: string;
  sync_status: string | null;
  skill_count: number;
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
  action: string;
  target_type: string;
  target_ref: string;
  occurred_at: Date | string;
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

type ReviewMetricRow = {
  completed_reviews: number;
  approved_reviews: number;
};

type ReleaseMetricRow = {
  avg_turnaround_days: number | null;
  released_count: number;
};

type EvaluationRow = {
  run_external_id: string | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  status: string;
  executed_at: Date | string | null;
  indexed_at: Date | string;
  score_delta: number | null;
  comparison_commit_sha: string | null;
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

function mapTier(tier: string): 1 | 2 | 3 {
  if (tier === "tier1") {
    return 1;
  }

  if (tier === "tier3") {
    return 3;
  }

  return 2;
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

function buildSkillListItem(skill: SkillRow): SkillListItem {
  const trend = normalizeTrendScores(skill.trend_scores);
  const score = roundScore(skill.latest_score);

  return {
    id: skill.skill_id,
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
  };
}

function buildRepositoryListItem(row: RepositoryRow): RepositoryListItem {
  return {
    id: row.id,
    provider: row.provider_type,
    name: `${row.owner_name}/${row.repo_name}`,
    branch: row.default_branch,
    skills: row.skill_count,
    lastSync: formatRelativeControlPlaneTime(row.last_activity_at),
    status: mapRepositorySyncStatus(row.repo_status, row.sync_status),
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
      repositories.default_branch,
      repositories.status as repo_status,
      repository_sync_state.status as sync_status,
      coalesce(skill_counts.skill_count, 0)::int as skill_count,
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
      ? Math.round((row.approvals_done / row.approvals_required) * 100)
      : row.targets && row.targets.length > 0
        ? 100
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
      select actor_type, actor_ref, action, target_type, target_ref, occurred_at
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
      ...createMeta("database"),
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
        repositories.default_branch,
        repositories.status as repo_status,
        repositories.visibility,
        repository_sync_state.status as sync_status,
        repository_sync_state.sync_mode,
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
  const skill = skills.find((entry) => entry.id === id);

  if (!skill) {
    return null;
  }

  const [evaluationRows, commentRows, versionRows, accessGrantRows, accessPolicyRows, activityRows, activeReleaseRows, auditRows] = await Promise.all([
    sql<EvaluationRow[]>`
      select
        run_external_id,
        total_cases,
        passed_cases,
        failed_cases,
        status,
        executed_at,
        indexed_at,
        score_delta::float8 as score_delta,
        comparison_commit_sha
      from indexed_eval_results
      where indexed_skill_id in (
        select id
        from indexed_skills
        where organization_id = ${context.tenant.organizationId}
          and skill_id = ${id}
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
        and review_requests.skill_id = ${id}
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
          and indexed_skills.skill_id = ${id}
          and indexed_eval_results.comparison_commit_sha = indexed_skill_versions.commit_sha
        order by indexed_eval_results.executed_at desc nulls last, indexed_eval_results.indexed_at desc
        limit 1
      ) latest_scores on true
      where indexed_skill_versions.skill_id = ${id}
        and indexed_skill_versions.repository_id in (
          select repository_id
          from indexed_skills
          where organization_id = ${context.tenant.organizationId}
            and skill_id = ${id}
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
        and target_ref = ${id}
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
        and release_requests.skill_id = ${id}
        and release_requests.status in ('pending', 'approved', 'blocked')
      order by release_requests.created_at desc
      limit 1
    `,
    sql<AuditEventRow[]>`
      select actor_type, actor_ref, action, target_type, target_ref, occurred_at
      from audit_events
      where organization_id = ${context.tenant.organizationId}
        and target_ref = ${id}
      order by occurred_at desc
      limit 5
    `,
  ]);

  const evaluations: EvalRunSummary[] = evaluationRows.map((row, index) => ({
    id: row.run_external_id ?? `${skill.id}-eval-${index + 1}`,
    skill: skill.name,
    ref: row.comparison_commit_sha?.slice(0, 7) ?? skill.candidateRef !== "—" ? skill.candidateRef : skill.ref,
    dataset: "Indexed dataset",
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
