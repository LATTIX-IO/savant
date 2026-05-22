import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicAuthSettings,
  buildWorkspaceSettingsPayload,
  mergeTenantWorkspaceSettings,
} from "./workspace-settings.ts";

test("buildPublicAuthSettings marks partial local Auth0 setup as development bypass without exposing secrets", () => {
  const result = buildPublicAuthSettings({
    APP_BASE_URL: "https://savantrepo.com",
    AUTH0_DOMAIN: "dev-uzaxp03ophsygo6g.us.auth0.com",
    AUTH0_CLIENT_ID: "client-id",
    AUTH0_CLIENT_SECRET: "<AUTH0_CLIENT_SECRET>",
    AUTH0_SECRET: "<AUTH0_SECRET>",
  });

  assert.deepEqual(result, {
    provider: "auth0",
    status: "development-bypass",
    tenantDomain: "dev-uzaxp03ophsygo6g.us.auth0.com",
    clientId: "client-id",
    appBaseUrl: "https://savantrepo.com",
    callbackUrl: "https://savantrepo.com/auth/callback",
    logoutUrl: "https://savantrepo.com/",
    applicationType: "regular_web",
    tokenEndpointAuthMethod: "client_secret_post",
    sessionMode: "server-side session",
  });
});

test("buildWorkspaceSettingsPayload returns stable AI connection summaries and cloned member groups", () => {
  const result = buildWorkspaceSettingsPayload({});

  assert.equal(result.aiConnections.length, 3);
  assert.equal(result.aiConnections[0]?.aiConnectionUuid, "9f1bbfb0-7610-4c6b-a38d-92b2d5fbc101");
  assert.equal(result.aiConnections[0]?.isDefaultExecution, true);
  assert.equal(result.aiConnections[1]?.isDefaultJudge, true);
  assert.equal(result.general.workspaceSlug, "wexler-hahn");
  assert.equal(result.general.workspaceUrl, "https://savantrepo.com/o/wexler-hahn");
  assert.equal(result.members[0]?.groups === result.members[1]?.groups, false);
});

test("buildWorkspaceSettingsPayload accepts tenant overrides for the current workspace", () => {
  const result = buildWorkspaceSettingsPayload({}, {
    workspaceName: "Finance Ops",
    workspaceSlug: "finance-ops",
  });

  assert.equal(result.general.workspaceName, "Finance Ops");
  assert.equal(result.general.workspaceSlug, "finance-ops");
  assert.equal(result.general.workspaceUrl, "https://savantrepo.com/o/finance-ops");
});

test("buildPublicAuthSettings derives the base URL from Vercel production metadata when APP_BASE_URL is absent", () => {
  const result = buildPublicAuthSettings({
    VERCEL_PROJECT_PRODUCTION_URL: "savantrepo.com",
    AUTH0_DOMAIN: "dev-uzaxp03ophsygo6g.us.auth0.com",
    AUTH0_CLIENT_ID: "client-id",
    AUTH0_CLIENT_SECRET: "<AUTH0_CLIENT_SECRET>",
    AUTH0_SECRET: "<AUTH0_SECRET>",
  });

  assert.equal(result.appBaseUrl, "https://savantrepo.com");
  assert.equal(result.callbackUrl, "https://savantrepo.com/auth/callback");
  assert.equal(result.logoutUrl, "https://savantrepo.com/");
  assert.equal(result.status, "development-bypass");
});

test("mergeTenantWorkspaceSettings applies tenant-specific general, member, and billing overrides", () => {
  const base = buildWorkspaceSettingsPayload({}, {
    workspaceName: "Finance Ops",
    workspaceSlug: "finance-ops",
  });

  const result = mergeTenantWorkspaceSettings(base, {
    general: {
      timeZone: "UTC",
      approvalRequirement: 3,
    },
    members: [
      {
        name: "Ari Chen",
        email: "ari@example.com",
        role: "Owner",
        groups: ["platform-admins"],
        status: "active",
        last: "just now",
      },
    ],
    billing: {
      activeSkills: 7,
      includedSeats: 5,
      usedSeats: 2,
      renewalDate: "Awaiting Stripe sync",
    },
  });

  assert.equal(result.general.timeZone, "UTC");
  assert.equal(result.general.approvalRequirement, 3);
  assert.equal(result.members.length, 1);
  assert.equal(result.members[0]?.role, "Owner");
  assert.equal(result.billing.activeSkills, 7);
  assert.equal(result.billing.includedSeats, 5);
  assert.equal(result.billing.usedSeats, 2);
  assert.equal(result.billing.renewalDate, "Awaiting Stripe sync");
});
