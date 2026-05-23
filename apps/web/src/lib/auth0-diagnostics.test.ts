import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuth0Diagnostics,
  doOriginsMatch,
  getAuthBlockingIssues,
  getOnboardingBlockingIssues,
  loadAuth0Discovery,
  resolveRequestOrigin,
} from "./auth0-diagnostics.ts";

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
  assert.equal(result.authFlowStatus, "blocked");
  assert.equal(result.onboardingFlowStatus, "blocked");
});

test("buildAuth0Diagnostics accepts public Auth0 aliases used in some deployments", () => {
  const result = buildAuth0Diagnostics({
    NEXT_PUBLIC_AUTH0_DOMAIN: "https://tenant.example.com/",
    NEXT_PUBLIC_AUTH0_CLIENT_ID: "public-client-id",
    AUTH0_CLIENT_SECRET: "client-secret",
    AUTH0_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    APP_BASE_URL: "https://savantrepo.com",
    DATABASE_URL: "postgres://db.example.com/savant",
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
  });

  assert.equal(result.tenantDomain, "tenant.example.com");
  assert.equal(result.clientId, "public-client-id");
  assert.equal(result.authFlowStatus, "ready");
  assert.equal(result.onboardingFlowStatus, "ready");
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

test("resolveRequestOrigin derives the deployed origin from forwarded headers", () => {
  assert.equal(
    resolveRequestOrigin({
      forwardedProto: "https",
      forwardedHost: "savantrepo.com",
      nodeEnv: "production",
    }),
    "https://savantrepo.com",
  );

  assert.equal(
    resolveRequestOrigin({
      host: "localhost:3000",
      nodeEnv: "development",
    }),
    "http://localhost:3000",
  );

  assert.equal(doOriginsMatch("https://savantrepo.com", "https://savantrepo.com/auth/callback"), true);
  assert.equal(doOriginsMatch("https://preview.savantrepo.com", "https://savantrepo.com"), false);
});

test("auth and onboarding blockers are reported separately", () => {
  const diagnostics = {
    ...buildAuth0Diagnostics({
      APP_BASE_URL: "https://savantrepo.com",
      STRIPE_SECRET_KEY: "sk_test_123",
    }),
    discovery: {
      status: "not-configured" as const,
      issuer: null,
      authorizationEndpoint: null,
      tokenEndpoint: null,
      errorMessage: null,
    },
  };

  const authIssues = getAuthBlockingIssues(diagnostics, "https://savantrepo.com");
  const onboardingIssues = getOnboardingBlockingIssues(diagnostics);

  assert.equal(authIssues.some((issue) => issue.includes("AUTH0_CLIENT_SECRET")), true);
  assert.equal(authIssues.some((issue) => issue.includes("DATABASE_URL")), false);
  assert.equal(onboardingIssues.some((issue) => issue.includes("DATABASE_URL")), true);
  assert.equal(onboardingIssues.some((issue) => issue.includes("AUTH0_CLIENT_SECRET")), false);
});
