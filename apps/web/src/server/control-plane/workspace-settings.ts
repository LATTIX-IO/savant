import type {
  AIConnectionSummary,
  MemberRecord,
  PublicAuthProviderSettings,
  WorkspaceSettingsPayload,
  WorkspaceSettingsResponse,
} from "@savant/types";

import {
  hasAuth0EnvConfig,
  resolveAuth0AppBaseUrl,
  resolveAuth0ClientId,
  resolveAuth0Domain,
  type Auth0Env,
} from "../../lib/auth0-config.ts";
import { buildWorkspaceUrl } from "../../lib/workspace-url.ts";

import { listAIConnectionSummariesForOrganization } from "./ai-connections.ts";

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
  aiConnections: AIConnectionSummary[];
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

export function resolveDefaultWorkspaceName(env: Auth0Env = process.env): string {
  const value = env.DEVELOPMENT_WORKSPACE_NAME;
  return typeof value === "string" && value.trim() ? value.trim() : "Local Workspace";
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

function resolveBillingSettingsOverrides(settings: unknown): Partial<WorkspaceSettingsPayload["billing"]> {
  const billing = isRecord(settings) && isRecord(settings.billing) ? settings.billing : null;
  if (!billing) {
    return {};
  }

  const overrides: Partial<WorkspaceSettingsPayload["billing"]> = {};

  const planName = readStringOverride(billing, "planName");
  if (planName !== undefined) {
    overrides.planName = planName;
  }

  const billingCycle = readStringOverride(billing, "billingCycle");
  if (billingCycle !== undefined) {
    overrides.billingCycle = billingCycle;
  }

  const renewalDate = readStringOverride(billing, "renewalDate");
  if (renewalDate !== undefined) {
    overrides.renewalDate = renewalDate;
  }

  const numericOverrideKeys = [
    "skillsIncluded",
    "activeSkills",
    "includedSeats",
    "usedSeats",
    "evalRunCapMonthly",
    "evalRunsUsedMonthly",
    "distributionsMonthly",
    "storageGbUsed",
    "storageGbCap",
    "apiCallsMonthly",
    "apiCallsDeltaPct",
  ] as const;

  for (const key of numericOverrideKeys) {
    const value = readNumberOverride(billing, key);
    if (value !== undefined) {
      overrides[key] = value;
    }
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
    aiConnections: snapshot.aiConnections,
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
  const clientId = resolveAuth0ClientId(env);

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
  return [];
}

function buildMembers(): MemberRecord[] {
  return [];
}

export function buildWorkspaceSettingsPayload(
  env: Auth0Env = process.env,
  options?: { workspaceName?: string; workspaceSlug?: string },
): WorkspaceSettingsPayload {
  const workspaceName = options?.workspaceName?.trim() || resolveDefaultWorkspaceName(env);
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
      billingCycle: null,
      renewalDate: "Awaiting billing data",
      skillsIncluded: null,
      activeSkills: 0,
      includedSeats: 0,
      usedSeats: 0,
      evalRunCapMonthly: null,
      evalRunsUsedMonthly: null,
      distributionsMonthly: null,
      storageGbUsed: null,
      storageGbCap: null,
      apiCallsMonthly: null,
      apiCallsDeltaPct: null,
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

  const [settingsRows, memberRows, billingRows, skillCountRows, aiConnections] = await Promise.all([
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
    listAIConnectionSummariesForOrganization(tenant.organizationId),
  ]);

  const settings = settingsRows[0]?.settings;
  const activeMembers = memberRows.filter((row) => row.status === "active").length;
  const billing = billingRows[0] ?? null;
  const activeSkills = skillCountRows[0]?.active_skill_count ?? 0;

  return {
    general: resolveGeneralSettingsOverrides(settings),
    aiConnections,
    members: memberRows.map(mapWorkspaceMember),
    billing: {
      ...resolveBillingSettingsOverrides(settings),
      activeSkills,
      includedSeats: billing?.seat_count ?? activeMembers,
      usedSeats: activeMembers,
      billingCycle: billing?.billing_cycle ?? null,
      renewalDate: billing
        ? `Stripe sync ${formatRelativeControlPlaneTime(billing.updated_at)}`
        : "Awaiting billing sync",
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
