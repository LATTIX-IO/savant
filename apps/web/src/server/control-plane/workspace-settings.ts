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
  type Auth0Env,
} from "../../lib/auth0-config.ts";
import { MEMBERS, ORG } from "../../lib/savant-data.ts";

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

export function buildPublicAuthSettings(env: Auth0Env = process.env): PublicAuthProviderSettings {
  const appBaseUrl = readConfiguredEnvValue(env, "APP_BASE_URL");
  const tenantDomain = readConfiguredEnvValue(env, "AUTH0_DOMAIN");
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

export function buildWorkspaceSettingsPayload(env: Auth0Env = process.env): WorkspaceSettingsPayload {
  const workspaceSlug = slugifyWorkspaceName(ORG.name);

  return {
    general: {
      workspaceName: ORG.name,
      workspaceSlug,
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
      planName: "Enterprise",
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

export function getWorkspaceSettingsResponse(env: Auth0Env = process.env): WorkspaceSettingsResponse {
  return {
    data: buildWorkspaceSettingsPayload(env),
    meta: {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      sourceOfTruth: "mixed",
    },
  };
}
