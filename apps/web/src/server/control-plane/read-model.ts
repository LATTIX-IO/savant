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

import { findSkillByIdentifier } from "../../lib/skill-paths.ts";

import { isControlPlaneDatabaseConfigured } from "./database.ts";
import {
  readOverviewFromDatabase,
  readRepositoryDetailFromDatabase,
  readRepositoriesFromDatabase,
  readSkillDetailFromDatabase,
  readSkillsFromDatabase,
} from "./read-model-db.ts";
import {
  canUseTenantDatabaseReadModel,
  isDevelopmentReadModelFallbackAllowed,
} from "./read-model-policy.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";

type SavantDataModule = typeof import("../../lib/savant-data.ts");
type ReadModelFallbackModule = typeof import("./read-model-fallback.ts");

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

export class ReadModelUnavailableError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 503) {
    super(message);
    this.name = "ReadModelUnavailableError";
    this.code = code;
    this.status = status;
  }
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

async function loadFallbackReadModelDependencies(): Promise<{
  fixtures: SavantDataModule;
  fallback: ReadModelFallbackModule;
}> {
  const [fixtures, fallback] = await Promise.all([
    import("../../lib/savant-data.ts"),
    import("./read-model-fallback.ts"),
  ]);

  return { fixtures, fallback };
}

function createLiveDataRequiredError(
  code:
    | "overview_live_data_required"
    | "repository_list_live_data_required"
    | "repository_detail_live_data_required"
    | "skill_list_live_data_required"
    | "skill_detail_live_data_required",
  message: string,
): ReadModelUnavailableError {
  return new ReadModelUnavailableError(code, message, 503);
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

async function getFallbackOverviewResponse(): Promise<OverviewResponse> {
  const {
    fixtures: { APPROVALS, AUDIT, ORG, RECENT_CHANGES, REGRESSIONS, RELEASES, REPOS },
    fallback: { FALLBACK_OVERVIEW_SOURCE_OF_TRUTH, mapFallbackRepository },
  } = await loadFallbackReadModelDependencies();

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
      repositories: REPOS.map(mapFallbackRepository),
      auditHighlights: AUDIT,
      releaseQueue: RELEASES.slice(0, 3),
    },
    meta: createMeta(FALLBACK_OVERVIEW_SOURCE_OF_TRUTH),
  };
}

async function getFallbackRepositoriesResponse(filters: RepositoryFilters = {}): Promise<RepositoryListResponse> {
  const {
    fixtures: { REPOS },
    fallback: { FALLBACK_REPOSITORY_LIST_SOURCE_OF_TRUTH, mapFallbackRepository },
  } = await loadFallbackReadModelDependencies();

  const repositories = REPOS.map(mapFallbackRepository).filter((repository) => {
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
      ...createMeta(FALLBACK_REPOSITORY_LIST_SOURCE_OF_TRUTH),
      count: repositories.length,
    },
  };
}

async function getFallbackRepositoryDetailResponse(id: string): Promise<RepositoryDetailResponse | null> {
  const {
    fixtures: { REPO_DETAILS, REPOS },
    fallback: { FALLBACK_REPOSITORY_DETAIL_SOURCE_OF_TRUTH, mapFallbackRepository },
  } = await loadFallbackReadModelDependencies();

  const repository = REPOS.map(mapFallbackRepository).find((entry) => entry.id === id);

  if (!repository) {
    return null;
  }

  const details = REPO_DETAILS[id] ?? fallbackRepositoryDetails(repository.skills, repository.branch);

  return {
    data: {
      repository,
      details,
    },
    meta: createMeta(FALLBACK_REPOSITORY_DETAIL_SOURCE_OF_TRUTH),
  };
}

async function getFallbackSkillsResponse(filters: SkillFilters = {}): Promise<SkillListResponse> {
  const {
    fixtures: { SKILLS },
    fallback: { FALLBACK_SKILL_LIST_SOURCE_OF_TRUTH, mapFallbackSkill },
  } = await loadFallbackReadModelDependencies();

  const skills = SKILLS.map(mapFallbackSkill).filter((skill) => {
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
      ...createMeta(FALLBACK_SKILL_LIST_SOURCE_OF_TRUTH),
      count: skills.length,
    },
  };
}

async function getFallbackSkillDetailResponse(id: string): Promise<SkillDetailResponse | null> {
  const {
    fixtures: {
      APPROVAL_TIMELINE,
      AUDIT,
      COMMENTS,
      EVAL_RUNS,
      RELEASES,
      RUBRIC_BASELINE,
      SKILLS,
    },
    fallback: { FALLBACK_SKILL_DETAIL_SOURCE_OF_TRUTH, mapFallbackSkill },
  } = await loadFallbackReadModelDependencies();

  const skill = findSkillByIdentifier(SKILLS.map(mapFallbackSkill), id);

  if (!skill) {
    return null;
  }

  return {
    data: {
      skill,
      evaluations: EVAL_RUNS.filter((run) => run.skill === skill.name),
      rubricBaseline: RUBRIC_BASELINE.map((row) => ({
        baseline: row.baseline,
        candidate: row.candidate,
        direction: row.dir,
        label: row.label,
      } satisfies RubricComparisonRow)),
      approvalTimeline: APPROVAL_TIMELINE.map((event) => ({
        ...event,
        node: event.node as TimelineNodeColor,
      } satisfies ApprovalTimelineItem)),
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
    meta: createMeta(FALLBACK_SKILL_DETAIL_SOURCE_OF_TRUTH),
  };
}

export function getTenantSkillRepoContractResponse(): TenantSkillRepoContractResponse {
  return {
    data: tenantSkillRepoContract,
    meta: createMeta("git"),
  };
}

function canUseDatabase(context?: ResolvedTenantContext): context is ResolvedTenantContext {
  return canUseTenantDatabaseReadModel({
    context,
    isDatabaseConfigured: isControlPlaneDatabaseConfigured,
  });
}

function canUseDevelopmentFallback(context?: ResolvedTenantContext): boolean {
  return isDevelopmentReadModelFallbackAllowed({
    context,
    nodeEnv: process.env.NODE_ENV,
  });
}

export async function getOverviewResponse(
  context?: ResolvedTenantContext,
): Promise<OverviewResponse> {
  if (canUseDatabase(context)) {
    return readOverviewFromDatabase(context);
  }

  if (canUseDevelopmentFallback(context)) {
    return getFallbackOverviewResponse();
  }

  throw createLiveDataRequiredError(
    "overview_live_data_required",
    "Live overview data is unavailable outside local development when no tenant-backed control-plane context exists.",
  );
}

export async function listRepositoriesResponse(
  filters: RepositoryFilters = {},
  context?: ResolvedTenantContext,
): Promise<RepositoryListResponse> {
  if (canUseDatabase(context)) {
    return readRepositoriesFromDatabase(context, filters);
  }

  if (canUseDevelopmentFallback(context)) {
    return getFallbackRepositoriesResponse(filters);
  }

  throw createLiveDataRequiredError(
    "repository_list_live_data_required",
    "Live repository data is unavailable outside local development when no tenant-backed control-plane context exists.",
  );
}

export async function getRepositoryDetailResponse(
  id: string,
  context?: ResolvedTenantContext,
): Promise<RepositoryDetailResponse | null> {
  if (canUseDatabase(context)) {
    return readRepositoryDetailFromDatabase(context, id);
  }

  if (canUseDevelopmentFallback(context)) {
    return getFallbackRepositoryDetailResponse(id);
  }

  throw createLiveDataRequiredError(
    "repository_detail_live_data_required",
    "Live repository detail is unavailable outside local development when no tenant-backed control-plane context exists.",
  );
}

export async function listSkillsResponse(
  filters: SkillFilters = {},
  context?: ResolvedTenantContext,
): Promise<SkillListResponse> {
  if (canUseDatabase(context)) {
    return readSkillsFromDatabase(context, filters);
  }

  if (canUseDevelopmentFallback(context)) {
    return getFallbackSkillsResponse(filters);
  }

  throw createLiveDataRequiredError(
    "skill_list_live_data_required",
    "Live skill data is unavailable outside local development when no tenant-backed control-plane context exists.",
  );
}

export async function getSkillDetailResponse(
  id: string,
  context?: ResolvedTenantContext,
): Promise<SkillDetailResponse | null> {
  if (canUseDatabase(context)) {
    return readSkillDetailFromDatabase(context, id);
  }

  if (canUseDevelopmentFallback(context)) {
    return getFallbackSkillDetailResponse(id);
  }

  throw createLiveDataRequiredError(
    "skill_detail_live_data_required",
    "Live skill detail is unavailable outside local development when no tenant-backed control-plane context exists.",
  );
}