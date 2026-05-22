import type {
  AIConnectionSummary,
  MemberRecord,
  PublicAuthProviderSettings,
  WorkspaceSettingsPayload,
  WorkspaceSettingsResponse,
} from "@savant/types";

import {
  hasAuth0EnvConfig,
  isConfiguredAuth0Value,
  resolveAuth0AppBaseUrl,
  resolveAuth0Domain,
  type Auth0Env,
} from "../../lib/auth0-config.ts";
import { buildWorkspaceUrl } from "../../lib/workspace-url.ts";
import { MEMBERS, ORG } from "../../lib/savant-data.ts";

import { formatRelativeControlPlaneTime } from "./read-model-db.ts";

type TenantWorkspaceSettingsInput = {
  organizationId: string;
  workspaceName: string;
  workspaceSlug: string;
};

type WorkspaceSettingsRow = {
  settings: unknown;
};

type WorkspaceMemberRow = {
  email: string;
  display_name: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  groups: string[] | null;
  is_first_member: boolean;
};

type WorkspaceBillingRow = {
  billing_cycle: string;
  seat_count: number;
  status: string;
  updated_at: Date | string;
};

type WorkspaceSkillCountRow = {
  active_skill_count: number;
};

type TenantWorkspaceSettingsSnapshot = {
  general: Partial<WorkspaceSettingsPayload["general"]>;
  members: MemberRecord[];
  billing: Partial<WorkspaceSettingsPayload["billing"]>;
};

function isConfiguredDatabaseValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("<") || trimmed.includes("REPLACE") || trimmed.startsWith("placeholder-")) {
    return false;
  }

  return true;
}

function isControlPlaneDatabaseConfiguredForEnv(env: Auth0Env = process.env): boolean {
  const value = env.DATABASE_URL;
  return typeof value === "string" && isConfiguredDatabaseValue(value);
}

async function loadControlPlaneDatabase() {
  const { getControlPlaneDatabase } = await import("./database.ts");
  return getControlPlaneDatabase();
}

function slugifyWorkspaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
}

function readConfiguredEnvValue(env: Auth0Env, key: string): string | null {
  const value = env[key];
  if (typeof value !== "string") {
    return null;
  }

  if (!isConfiguredAuth0Value(value)) {
    return null;
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringOverride(settings: unknown, key: string): string | undefined {
  if (!isRecord(settings)) {
    return undefined;
  }

  const value = settings[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumberOverride(settings: unknown, key: string): number | undefined {
  if (!isRecord(settings)) {
    return undefined;
  }

  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBooleanOverride(settings: unknown, key: string): boolean | undefined {
  if (!isRecord(settings)) {
    return undefined;
  }

  const value = settings[key];
  return typeof value === "boolean" ? value : undefined;
}

function resolveGeneralSettingsOverrides(settings: unknown): Partial<WorkspaceSettingsPayload["general"]> {
  const general = isRecord(settings) && isRecord(settings.general) ? settings.general : settings;
  const overrides: Partial<WorkspaceSettingsPayload["general"]> = {};

  const timeZone = readStringOverride(general, "timeZone");
  if (timeZone !== undefined) {
    overrides.timeZone = timeZone;
  }

  const defaultTier = readNumberOverride(general, "defaultTier") as WorkspaceSettingsPayload["general"]["defaultTier"] | undefined;
  if (defaultTier !== undefined) {
    overrides.defaultTier = defaultTier;
  }

  const approvalRequirement = readNumberOverride(general, "approvalRequirement");
  if (approvalRequirement !== undefined) {
    overrides.approvalRequirement = approvalRequirement;
  }

  const stagingBurnInHours = readNumberOverride(general, "stagingBurnInHours");
  if (stagingBurnInHours !== undefined) {
    overrides.stagingBurnInHours = stagingBurnInHours;
  }

  const requireEvalSuite = readBooleanOverride(general, "requireEvalSuite");
  if (requireEvalSuite !== undefined) {
    overrides.requireEvalSuite = requireEvalSuite;
  }

  return overrides;
}

function buildMemberRole(row: WorkspaceMemberRow): string {
  const groups = row.groups ?? [];

  if (row.is_first_member) {
    return "Owner";
  }

  if (groups.some((group) => group.toLowerCase() === "platform-admins")) {
    return "Admin";
  }

  return "Member";
}

function mapWorkspaceMember(row: WorkspaceMemberRow): MemberRecord {
  return {
    name: row.display_name,
    email: row.email,
    role: buildMemberRole(row),
    groups: [...(row.groups ?? [])],
    status: row.status === "active" ? "active" : "off-boarded",
    last: formatRelativeControlPlaneTime(row.updated_at ?? row.created_at),
  };
}

export function mergeTenantWorkspaceSettings(
  base: WorkspaceSettingsPayload,
  snapshot: TenantWorkspaceSettingsSnapshot,
): WorkspaceSettingsPayload {
  return {
    ...base,
    general: {
      ...base.general,
      ...snapshot.general,
    },
    members: snapshot.members.length > 0 ? snapshot.members : base.members,
    billing: {
      ...base.billing,
      ...snapshot.billing,
    },
  };
}

export function buildPublicAuthSettings(env: Auth0Env = process.env): PublicAuthProviderSettings {
  const appBaseUrl = resolveAuth0AppBaseUrl(env);
  const tenantDomain = resolveAuth0Domain(env);
  const clientId = readConfiguredEnvValue(env, "AUTH0_CLIENT_ID");

  const hasPublicConfig = Boolean(appBaseUrl || tenantDomain || clientId);
  const status = hasAuth0EnvConfig(env)
    ? "configured"
    : hasPublicConfig
      ? "development-bypass"
      : "unconfigured";

  return {
    provider: "auth0",
    status,
    tenantDomain,
    clientId,
    appBaseUrl,
    callbackUrl: appBaseUrl ? `${appBaseUrl}/auth/callback` : null,
    logoutUrl: appBaseUrl ? `${appBaseUrl}/` : null,
    applicationType: "regular_web",
    tokenEndpointAuthMethod: "client_secret_post",
    sessionMode: "server-side session",
  };
}

function buildAiConnections(): AIConnectionSummary[] {
  return [
    {
      aiConnectionUuid: "9f1bbfb0-7610-4c6b-a38d-92b2d5fbc101",
      provider: "openai",
      label: "OpenAI production evals",
      defaultModel: "gpt-5.1",
      purpose: "Primary execution provider for candidate and baseline eval runs.",
      status: "active",
      lastUsed: "12m ago",
      lastRotated: "18d ago",
      secretStore: "HashiCorp Vault · kv/team-savant/openai-prod",
      usageScope: "Tier 2 and Tier 3 execution",
      supportsExecution: true,
      supportsJudging: false,
      isDefaultExecution: true,
      isDefaultJudge: false,
    },
    {
      aiConnectionUuid: "d02d6300-8fd9-4055-8d66-11c5589a9f4f",
      provider: "anthropic",
      label: "Anthropic rubric judge",
      defaultModel: "claude-sonnet-4-5",
      purpose: "Secondary judge model for rubric scoring and recommendation generation.",
      status: "active",
      lastUsed: "31m ago",
      lastRotated: "24d ago",
      secretStore: "HashiCorp Vault · kv/team-savant/anthropic-judge",
      usageScope: "Judging only · all tiers",
      supportsExecution: false,
      supportsJudging: true,
      isDefaultExecution: false,
      isDefaultJudge: true,
    },
    {
      aiConnectionUuid: "d86e0c43-1d11-4ae9-a4e0-23f14f4b2f91",
      provider: "azure-openai",
      label: "Azure OpenAI regulated workloads",
      defaultModel: "gpt-4.1",
      purpose: "Reserved provider for regulated Tier 1 evaluations and customer-isolated workloads.",
      status: "needs-rotation",
      lastUsed: "2d ago",
      lastRotated: "89d ago",
      secretStore: "Azure Key Vault · savant-prod-tier1",
      usageScope: "Tier 1 execution and judging",
      supportsExecution: true,
      supportsJudging: true,
      isDefaultExecution: false,
      isDefaultJudge: false,
    },
  ];
}

function buildMembers(): MemberRecord[] {
  return MEMBERS.map((member) => ({
    ...member,
    groups: [...member.groups],
  }));
}

export function buildWorkspaceSettingsPayload(
  env: Auth0Env = process.env,
  options?: { workspaceName?: string; workspaceSlug?: string },
): WorkspaceSettingsPayload {
  const workspaceName = options?.workspaceName?.trim() || ORG.name;
  const workspaceSlug = options?.workspaceSlug?.trim() || slugifyWorkspaceName(workspaceName);
  const workspaceUrl = buildWorkspaceUrl(workspaceSlug, env);

  return {
    general: {
      workspaceName,
      workspaceSlug,
      workspaceUrl,
      subdomain: workspaceSlug,
      defaultTier: 2,
      timeZone: "America / New York",
      approvalRequirement: 2,
      stagingBurnInHours: 24,
      requireEvalSuite: true,
    },
    authentication: buildPublicAuthSettings(env),
    aiConnections: buildAiConnections(),
    members: buildMembers(),
    security: {
      bundleSigningKeyRef: "ed25519-44a0…1cf2",
      bundleSigningKeyLastRotated: "31d ago",
      customerManagedKey: false,
      keyVaultProvider: "HashiCorp Vault",
      auditRetentionYears: 7,
      evalRetentionDays: 365,
      streamToSiem: true,
    },
    notifications: {
      approvalRequestedChannels: ["Slack", "Email"],
      regressionDetectedChannels: ["Slack", "Linear"],
      rollbackExecutedChannels: ["PagerDuty", "Slack"],
      policyViolationChannels: ["Slack"],
      weeklySummaryEnabled: false,
      weeklySummaryChannels: ["Email"],
    },
    billing: {
      planName: "Savant Seat",
      renewalDate: "14 Mar 2027",
      skillsIncluded: 500,
      activeSkills: 218,
      includedSeats: 50,
      usedSeats: 38,
      evalRunCapMonthly: 4000,
      evalRunsUsedMonthly: 2841,
      distributionsMonthly: 38000,
      storageGbUsed: 12,
      storageGbCap: 200,
      apiCallsMonthly: 412000,
      apiCallsDeltaPct: 18,
    },
  };
}

export function getWorkspaceSettingsResponse(
  env: Auth0Env = process.env,
  options?: { workspaceName?: string; workspaceSlug?: string },
): WorkspaceSettingsResponse {
  return {
    data: buildWorkspaceSettingsPayload(env, options),
    meta: {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      sourceOfTruth: "mixed",
    },
  };
}

async function loadTenantWorkspaceSettingsSnapshot(
  tenant: TenantWorkspaceSettingsInput,
): Promise<TenantWorkspaceSettingsSnapshot> {
  const sql = await loadControlPlaneDatabase();

  const [settingsRows, memberRows, billingRows, skillCountRows] = await Promise.all([
    sql<WorkspaceSettingsRow[]>`
      select settings
      from workspace_settings
      where organization_id = ${tenant.organizationId}
      limit 1
    `,
    sql<WorkspaceMemberRow[]>`
      with ordered_users as (
        select
          users.id,
          users.email,
          users.display_name,
          users.status,
          users.created_at,
          users.updated_at,
          row_number() over (order by users.created_at asc, users.email asc) = 1 as is_first_member
        from users
        where users.organization_id = ${tenant.organizationId}
      )
      select
        ordered_users.email,
        ordered_users.display_name,
        ordered_users.status,
        ordered_users.created_at,
        ordered_users.updated_at,
        ordered_users.is_first_member,
        coalesce(
          array_agg(distinct groups.name) filter (where groups.name is not null),
          array[]::text[]
        ) as groups
      from ordered_users
      left join group_memberships on group_memberships.user_id = ordered_users.id
      left join groups on groups.id = group_memberships.group_id
      group by
        ordered_users.id,
        ordered_users.email,
        ordered_users.display_name,
        ordered_users.status,
        ordered_users.created_at,
        ordered_users.updated_at,
        ordered_users.is_first_member
      order by ordered_users.created_at asc, ordered_users.email asc
    `,
    sql<WorkspaceBillingRow[]>`
      select billing_cycle, seat_count, status, updated_at
      from billing_subscriptions
      where organization_id = ${tenant.organizationId}
      limit 1
    `,
    sql<WorkspaceSkillCountRow[]>`
      select count(distinct skill_id)::int as active_skill_count
      from indexed_skills
      where organization_id = ${tenant.organizationId}
    `,
  ]);

  const settings = settingsRows[0]?.settings;
  const activeMembers = memberRows.filter((row) => row.status === "active").length;
  const billing = billingRows[0] ?? null;
  const activeSkills = skillCountRows[0]?.active_skill_count ?? 0;

  return {
    general: resolveGeneralSettingsOverrides(settings),
    members: memberRows.map(mapWorkspaceMember),
    billing: {
      activeSkills,
      includedSeats: billing?.seat_count ?? activeMembers,
      usedSeats: activeMembers,
      renewalDate: billing
        ? `Stripe sync ${formatRelativeControlPlaneTime(billing.updated_at)}`
        : "Awaiting Stripe sync",
      planName: "Savant Seat",
    },
  };
}

export async function buildWorkspaceSettingsPayloadForTenant(
  tenant: TenantWorkspaceSettingsInput,
  env: Auth0Env = process.env,
): Promise<WorkspaceSettingsPayload> {
  const base = buildWorkspaceSettingsPayload(env, {
    workspaceName: tenant.workspaceName,
    workspaceSlug: tenant.workspaceSlug,
  });

  if (!isControlPlaneDatabaseConfiguredForEnv(env)) {
    return base;
  }

  return mergeTenantWorkspaceSettings(
    base,
    await loadTenantWorkspaceSettingsSnapshot(tenant),
  );
}

export async function getWorkspaceSettingsResponseForTenant(
  tenant: TenantWorkspaceSettingsInput,
  env: Auth0Env = process.env,
): Promise<WorkspaceSettingsResponse> {
  const hasDatabase = isControlPlaneDatabaseConfiguredForEnv(env);

  return {
    data: await buildWorkspaceSettingsPayloadForTenant(tenant, env),
    meta: {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      sourceOfTruth: hasDatabase ? "database" : "mixed",
    },
  };
}
