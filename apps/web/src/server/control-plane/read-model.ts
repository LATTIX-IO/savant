import "server-only";

import { tenantSkillRepoContract } from "@savant/schemas/tenant-skill-repo-contract";
import type {
  AccessGrantItem,
  AccessPolicyRuleItem,
  ActivityEventItem,
  ApprovalTimelineItem,
  ApiErrorResponse,
  FlaggedCaseItem,
  OverviewKpi,
  OverviewResponse,
  RepositoryDetailRecord,
  RepositoryDetailResponse,
  RepositoryListResponse,
  RequiredApprovalItem,
  RubricComparisonRow,
  SkillDetailResponse,
  SkillListItem,
  SkillListResponse,
  TenantSkillRepoContractResponse,
  TimelineNodeColor,
  VersionHistoryItem,
} from "@savant/types";

import {
  APPROVALS,
  APPROVAL_TIMELINE,
  AUDIT,
  COMMENTS,
  EVAL_RUNS,
  ORG,
  RECENT_CHANGES,
  REGRESSIONS,
  RELEASES,
  REPO_DETAILS,
  REPOS,
  RUBRIC_BASELINE,
  SKILLS,
} from "@/lib/savant-data";

import { isControlPlaneDatabaseConfigured } from "./database.ts";
import {
  readOverviewFromDatabase,
  readRepositoryDetailFromDatabase,
  readRepositoriesFromDatabase,
  readSkillDetailFromDatabase,
  readSkillsFromDatabase,
} from "./read-model-db.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";

type RepositoryFilters = {
  provider?: string | undefined;
  status?: string | undefined;
};

type SkillFilters = {
  query?: string | undefined;
  tier?: number | undefined;
  team?: string | undefined;
  status?: string | undefined;
  channel?: string | undefined;
};

function createMeta(sourceOfTruth: OverviewResponse["meta"]["sourceOfTruth"]) {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1 as const,
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

const OVERVIEW_KPIS: OverviewKpi[] = [
  {
    key: "skills-in-production",
    label: "Skills in production",
    value: 147,
    deltaLabel: "▲ 6 this week",
    trend: "up",
  },
  {
    key: "eval-coverage",
    label: "Eval coverage",
    value: 94,
    unit: "%",
    deltaLabel: "▲ 2.1 pts",
    trend: "up",
  },
  {
    key: "first-pass-acceptance",
    label: "First-pass acceptance",
    value: 81,
    unit: "%",
    deltaLabel: "▲ 0.4 pts",
    trend: "up",
  },
  {
    key: "release-turnaround",
    label: "Release turnaround",
    value: 2.4,
    unit: "d",
    deltaLabel: "▼ 0.6d",
    trend: "down",
  },
];

const DEFAULT_REQUIRED_APPROVALS: RequiredApprovalItem[] = [
  { role: "Skill owner", assignee: "ari.chen", status: "approved", when: "1h ago" },
  { role: "Security", assignee: "sasha.gw", status: "approved", when: "30m ago" },
  { role: "Compliance", assignee: null, status: "pending", when: null },
];

const DEFAULT_FLAGGED_CASES: FlaggedCaseItem[] = [
  {
    caseId: "0117",
    description: "Mutual NDA with non-standard indemnity",
    rubric: "Clause extraction precision",
    baseline: 1,
    candidate: 0.55,
    delta: -0.45,
  },
  {
    caseId: "0142",
    description: "MSA with custom termination clause",
    rubric: "Clause extraction precision",
    baseline: 0.94,
    candidate: 0.71,
    delta: -0.23,
  },
  {
    caseId: "0089",
    description: "Vendor agreement with auto-renewal language",
    rubric: "Tone compliance",
    baseline: 0.97,
    candidate: 0.88,
    delta: -0.09,
  },
  {
    caseId: "0203",
    description: "Procurement DPA — schedule 3 omitted",
    rubric: "Risk flag recall",
    baseline: 0.81,
    candidate: 0.74,
    delta: -0.07,
  },
  {
    caseId: "0226",
    description: "Non-standard governing law",
    rubric: "Clause extraction precision",
    baseline: 0.9,
    candidate: 0.79,
    delta: -0.11,
  },
  {
    caseId: "0234",
    description: "Indemnity carve-out for IP infringement",
    rubric: "Tone compliance",
    baseline: 0.96,
    candidate: 0.91,
    delta: -0.05,
  },
];

const DEFAULT_ACCESS_GRANTS: AccessGrantItem[] = [
  {
    name: "legal-readers",
    members: 24,
    permission: "view + use",
    source: "Okta · synced",
    lastSync: "12m ago",
  },
  {
    name: "legal-owners",
    members: 6,
    permission: "edit + review",
    source: "Okta · synced",
    lastSync: "1h ago",
  },
  {
    name: "platform-admins",
    members: 3,
    permission: "approve + release",
    source: "manual",
    lastSync: "2d ago",
  },
  {
    name: "all-employees",
    members: 412,
    permission: "request access",
    source: "Okta · synced",
    lastSync: "12m ago",
  },
];

const DEFAULT_ACCESS_POLICY_RULES: AccessPolicyRuleItem[] = [
  { rule: "Cannot be used outside", value: "Production environment" },
  { rule: "Distribution blocked for", value: "Local sync agent (Tier 1 restriction)" },
  { rule: "Required at runtime", value: "User must be member of legal-readers" },
  { rule: "Customer-managed key", value: "Disabled · org-managed key in use" },
];

const DEFAULT_VERSION_HISTORY: VersionHistoryItem[] = [
  {
    ref: "v2.4.0-rc.2",
    commit: "8a31cf2",
    who: "ari.chen",
    when: "1h ago",
    channel: "candidate",
    score: 92,
    delta: 0.6,
  },
  {
    ref: "v2.3.7",
    commit: "a13f9c2",
    who: "ari.chen",
    when: "6d ago",
    channel: "production",
    score: 91.4,
    delta: 0.4,
  },
  {
    ref: "v2.3.6",
    commit: "44dd1ab",
    who: "ari.chen",
    when: "11d ago",
    channel: "production",
    score: 91,
    delta: 0.7,
  },
  {
    ref: "v2.3.5",
    commit: "c0918dd",
    who: "kalia.b",
    when: "18d ago",
    channel: "archived",
    score: 90.3,
    delta: 1.2,
  },
  {
    ref: "v2.3.4",
    commit: "1bea90e",
    who: "kalia.b",
    when: "26d ago",
    channel: "archived",
    score: 89.1,
    delta: -0.4,
  },
  {
    ref: "v2.3.3",
    commit: "5fa12bb",
    who: "ari.chen",
    when: "32d ago",
    channel: "archived",
    score: 89.5,
    delta: 0.9,
  },
];

const DEFAULT_ACTIVITY_LOG: ActivityEventItem[] = [
  { when: "8m ago", who: "compliance", action: "Held approval", target: "candidate v2.4.0-rc.2", node: "brass" },
  { when: "30m ago", who: "sasha.gw", action: "Approved", target: "security review", node: "moss" },
  { when: "58m ago", who: "eval-runner", action: "Completed eval", target: "248 cases · 24s", node: "slate" },
  { when: "1h ago", who: "ari.chen", action: "Submitted candidate", target: "v2.4.0-rc.2", node: "slate" },
  { when: "6d ago", who: "ari.chen", action: "Released", target: "v2.3.7 → production", node: "moss" },
  { when: "6d ago", who: "compliance", action: "Approved", target: "v2.3.7", node: "moss" },
  { when: "7d ago", who: "sasha.gw", action: "Approved", target: "v2.3.7", node: "moss" },
  { when: "8d ago", who: "eval-runner", action: "Completed eval", target: "v2.3.7-rc.1 · 246 cases", node: "slate" },
  { when: "11d ago", who: "ari.chen", action: "Released", target: "v2.3.6 → production", node: "moss" },
];

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function mapRubricBaseline(): RubricComparisonRow[] {
  return RUBRIC_BASELINE.map((row) => ({
    baseline: row.baseline,
    candidate: row.candidate,
    direction: row.dir,
    label: row.label,
  }));
}

function mapApprovalTimeline(): ApprovalTimelineItem[] {
  return APPROVAL_TIMELINE.map((event) => ({
    ...event,
    node: event.node as TimelineNodeColor,
  }));
}

function fallbackRepositoryDetails(skillCount: number, branch: string): RepositoryDetailRecord {
  return {
    description: "Connected tenant skill repository indexed by Savant.",
    visibility: "private",
    syncMode: "poll",
    webhookHealth: "pending",
    defaultBranch: branch,
    protectedBranches: [branch],
    tierPolicy: "Inherited from workspace policy",
    members: [],
    skillsByTier: { 1: 0, 2: skillCount, 3: 0 },
    recentCommits: [],
  };
}

function getFallbackOverviewResponse(): OverviewResponse {
  return {
    data: {
      organization: ORG,
      counts: {
        skillsUnderGovernance: 218,
        pendingApprovals: APPROVALS.length,
        activeRegressionAlerts: REGRESSIONS.length,
        connectedRepositories: REPOS.length,
      },
      kpis: OVERVIEW_KPIS,
      approvals: APPROVALS,
      recentChanges: RECENT_CHANGES,
      regressions: REGRESSIONS,
      repositories: REPOS,
      auditHighlights: AUDIT,
      releaseQueue: RELEASES.slice(0, 3),
    },
    meta: createMeta("mixed"),
  };
}

function getFallbackRepositoriesResponse(filters: RepositoryFilters = {}): RepositoryListResponse {
  const repositories = REPOS.filter((repository) => {
    if (filters.provider && normalizeText(repository.provider) !== normalizeText(filters.provider)) {
      return false;
    }

    if (filters.status && normalizeText(repository.status) !== normalizeText(filters.status)) {
      return false;
    }

    return true;
  });

  return {
    data: repositories,
    meta: {
      ...createMeta("database"),
      count: repositories.length,
    },
  };
}

function getFallbackRepositoryDetailResponse(id: string): RepositoryDetailResponse | null {
  const repository = REPOS.find((entry) => entry.id === id);

  if (!repository) {
    return null;
  }

  const details = REPO_DETAILS[id] ?? fallbackRepositoryDetails(repository.skills, repository.branch);

  return {
    data: {
      repository,
      details,
    },
    meta: createMeta("mixed"),
  };
}

function getFallbackSkillsResponse(filters: SkillFilters = {}): SkillListResponse {
  const skills = SKILLS.filter((skill) => {
    if (filters.query) {
      const query = normalizeText(filters.query);
      const haystack = [skill.name, skill.description, skill.owner, skill.team, skill.repo].join(" ").toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (filters.tier && skill.tier !== filters.tier) {
      return false;
    }

    if (filters.team && normalizeText(skill.team) !== normalizeText(filters.team)) {
      return false;
    }

    if (filters.status && normalizeText(skill.status) !== normalizeText(filters.status)) {
      return false;
    }

    if (filters.channel && normalizeText(skill.channel) !== normalizeText(filters.channel)) {
      return false;
    }

    return true;
  });

  return {
    data: skills as SkillListItem[],
    meta: {
      ...createMeta("derived-index"),
      count: skills.length,
    },
  };
}

function getFallbackSkillDetailResponse(id: string): SkillDetailResponse | null {
  const skill = SKILLS.find((entry) => entry.id === id);

  if (!skill) {
    return null;
  }

  return {
    data: {
      skill,
      evaluations: EVAL_RUNS.filter((run) => run.skill === skill.name),
      rubricBaseline: mapRubricBaseline(),
      approvalTimeline: mapApprovalTimeline(),
      requiredApprovals: DEFAULT_REQUIRED_APPROVALS,
      reviewerComments: COMMENTS,
      flaggedCases: DEFAULT_FLAGGED_CASES,
      versionHistory: DEFAULT_VERSION_HISTORY,
      accessGrants: DEFAULT_ACCESS_GRANTS,
      accessPolicyRules: DEFAULT_ACCESS_POLICY_RULES,
      activityLog: DEFAULT_ACTIVITY_LOG,
      activeRelease: RELEASES.find((release) => release.skill === skill.name) ?? null,
      auditHighlights: AUDIT,
    },
    meta: createMeta("mixed"),
  };
}

export function getTenantSkillRepoContractResponse(): TenantSkillRepoContractResponse {
  return {
    data: tenantSkillRepoContract,
    meta: createMeta("git"),
  };
}

function canUseDatabase(context?: ResolvedTenantContext): context is ResolvedTenantContext {
  return Boolean(
    context &&
    isControlPlaneDatabaseConfigured &&
    !context.isDevelopmentFallback,
  );
}

export async function getOverviewResponse(
  context?: ResolvedTenantContext,
): Promise<OverviewResponse> {
  if (!canUseDatabase(context)) {
    return getFallbackOverviewResponse();
  }

  return readOverviewFromDatabase(context);
}

export async function listRepositoriesResponse(
  filters: RepositoryFilters = {},
  context?: ResolvedTenantContext,
): Promise<RepositoryListResponse> {
  if (!canUseDatabase(context)) {
    return getFallbackRepositoriesResponse(filters);
  }

  return readRepositoriesFromDatabase(context, filters);
}

export async function getRepositoryDetailResponse(
  id: string,
  context?: ResolvedTenantContext,
): Promise<RepositoryDetailResponse | null> {
  if (!canUseDatabase(context)) {
    return getFallbackRepositoryDetailResponse(id);
  }

  return readRepositoryDetailFromDatabase(context, id);
}

export async function listSkillsResponse(
  filters: SkillFilters = {},
  context?: ResolvedTenantContext,
): Promise<SkillListResponse> {
  if (!canUseDatabase(context)) {
    return getFallbackSkillsResponse(filters);
  }

  return readSkillsFromDatabase(context, filters);
}

export async function getSkillDetailResponse(
  id: string,
  context?: ResolvedTenantContext,
): Promise<SkillDetailResponse | null> {
  if (!canUseDatabase(context)) {
    return getFallbackSkillDetailResponse(id);
  }

  return readSkillDetailFromDatabase(context, id);
}