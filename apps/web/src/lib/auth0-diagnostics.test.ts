import assert from "node:assert/strict";
import test from "node:test";

import { buildAuth0Diagnostics, loadAuth0Discovery } from "./auth0-diagnostics.ts";

test("buildAuth0Diagnostics summarizes hosted Auth0 and onboarding readiness without exposing secrets", () => {
  const result = buildAuth0Diagnostics({
    AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
    AUTH0_CLIENT_ID: "client-id",
    AUTH0_CLIENT_SECRET: "<AUTH0_CLIENT_SECRET>",
    AUTH0_SECRET: "<AUTH0_SECRET>",
    APP_BASE_URL: "https://savantrepo.com",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    DATABASE_URL: "<DATABASE_URL>",
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: "<STRIPE_WEBHOOK_SECRET>",
  });

  assert.equal(result.overallStatus, "development-bypass");
  assert.equal(result.usesUniversalLogin, true);
  assert.equal(result.loginRoute, "/auth/login");
  assert.equal(result.signupRoute, "/auth/login?screen_hint=signup");
  assert.equal(result.tenantDomain, "dev-tenant.us.auth0.com");
  assert.equal(result.clientId, "client-id");
  assert.equal(result.clientSecretStatus, "placeholder");
  assert.equal(result.sessionSecretStatus, "placeholder");
  assert.equal(result.appBaseUrl, "https://savantrepo.com");
  assert.equal(result.publicAppUrl, "http://localhost:3000");
  assert.equal(result.appBaseUrlMatchesPublicAppUrl, false);
  assert.equal(result.databaseStatus, "placeholder");
  assert.equal(result.stripeSecretStatus, "configured");
  assert.equal(result.stripeWebhookStatus, "placeholder");
});

test("loadAuth0Discovery reports reachable tenant metadata when discovery succeeds", async () => {
  const fetchMock = (async () => new Response(JSON.stringify({
    issuer: "https://tenant.example.com/",
    authorization_endpoint: "https://tenant.example.com/authorize",
    token_endpoint: "https://tenant.example.com/oauth/token",
  }), { status: 200 })) as typeof fetch;

  const result = await loadAuth0Discovery("tenant.example.com", fetchMock);

  assert.equal(result.status, "reachable");
  assert.equal(result.issuer, "https://tenant.example.com/");
  assert.equal(result.authorizationEndpoint, "https://tenant.example.com/authorize");
  assert.equal(result.tokenEndpoint, "https://tenant.example.com/oauth/token");
  assert.equal(result.errorMessage, null);
});

test("loadAuth0Discovery reports unreachable when discovery fails", async () => {
  const fetchMock = (async () => {
    throw new Error("getaddrinfo ENOTFOUND tenant.example.com");
  }) as typeof fetch;

  const result = await loadAuth0Discovery("tenant.example.com", fetchMock);

  assert.equal(result.status, "unreachable");
  assert.equal(result.issuer, null);
  assert.equal(result.authorizationEndpoint, null);
  assert.equal(result.tokenEndpoint, null);
  assert.match(result.errorMessage ?? "", /ENOTFOUND/);
});
