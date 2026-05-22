import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicAuthSettings,
  buildWorkspaceSettingsPayload,
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
  assert.equal(result.members[0]?.groups === result.members[1]?.groups, false);
});
