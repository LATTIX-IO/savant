import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthStatusHref,
  getDashboardAuthAction,
  getAuthReturnTo,
  getLegacyAuthRedirectPath,
  hasAuth0EnvConfig,
  isAuthRoute,
  isConfiguredAuth0Value,
  isLegacyAuthApiRoute,
  isLocalDevAuthBypass,
  isLocalDevHostname,
  isProtectedDashboardPath,
  normalizeReturnToPath,
  readConfiguredEnvValue,
  resolveAuth0AppBaseUrl,
  resolveAuth0ClientId,
  resolveAuth0Domain,
} from "./auth0-config.ts";

test("isConfiguredAuth0Value rejects empty and placeholder values", () => {
  assert.equal(isConfiguredAuth0Value(undefined), false);
  assert.equal(isConfiguredAuth0Value(""), false);
  assert.equal(isConfiguredAuth0Value("   "), false);
  assert.equal(isConfiguredAuth0Value("<AUTH0_DOMAIN>"), false);
  assert.equal(isConfiguredAuth0Value("placeholder-local-secret"), false);
  assert.equal(isConfiguredAuth0Value("REPLACE_ME"), false);
  assert.equal(isConfiguredAuth0Value("dev-tenant.us.auth0.com"), true);
});

test("readConfiguredEnvValue trims surrounding whitespace from configured values", () => {
  assert.equal(readConfiguredEnvValue("  client-secret\n"), "client-secret");
  assert.equal(readConfiguredEnvValue("   <AUTH0_CLIENT_SECRET>   "), null);
});

test("hasAuth0EnvConfig requires every Auth0 variable to be configured", () => {
  assert.equal(
    hasAuth0EnvConfig({
      AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_SECRET: "session-secret",
    }),
    true,
  );

  assert.equal(
    hasAuth0EnvConfig({
      AUTH0_DOMAIN: "<AUTH0_DOMAIN>",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_SECRET: "session-secret",
    }),
    false,
  );
});

test("resolveAuth0AppBaseUrl falls back to Vercel deployment metadata when APP_BASE_URL is missing", () => {
  assert.equal(
    resolveAuth0AppBaseUrl({
      AUTH0_BASE_URL: "https://legacy.savantrepo.com/",
    }),
    "https://legacy.savantrepo.com",
  );

  assert.equal(
    resolveAuth0AppBaseUrl({
      NEXT_PUBLIC_APP_URL: "https://preview.savantrepo.com/",
    }),
    "https://preview.savantrepo.com",
  );

  assert.equal(
    resolveAuth0AppBaseUrl({
      APP_BASE_URL: "<APP_BASE_URL>",
      VERCEL_PROJECT_PRODUCTION_URL: "savantrepo.com",
    }),
    "https://savantrepo.com",
  );

  assert.equal(
    hasAuth0EnvConfig({
      VERCEL_PROJECT_PRODUCTION_URL: "savantrepo.com",
      AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_SECRET: "session-secret",
    }),
    true,
  );

  assert.equal(
    hasAuth0EnvConfig({
      AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_SECRET: "session-secret",
    }),
    true,
  );
});

test("resolveAuth0Domain accepts both AUTH0_DOMAIN and AUTH0_ISSUER_BASE_URL", () => {
  assert.equal(
    resolveAuth0Domain({ AUTH0_DOMAIN: "dev-tenant.us.auth0.com" }),
    "dev-tenant.us.auth0.com",
  );

  assert.equal(
    resolveAuth0Domain({ AUTH0_ISSUER_BASE_URL: "https://login.savantrepo.com/" }),
    "login.savantrepo.com",
  );
});

test("resolveAuth0ClientId accepts both server and public aliases", () => {
  assert.equal(resolveAuth0ClientId({ AUTH0_CLIENT_ID: "server-client-id" }), "server-client-id");
  assert.equal(
    resolveAuth0ClientId({ NEXT_PUBLIC_AUTH0_CLIENT_ID: "public-client-id" }),
    "public-client-id",
  );
});

test("hasAuth0EnvConfig accepts legacy Auth0 issuer/base-url environment aliases", () => {
  assert.equal(
    hasAuth0EnvConfig({
      AUTH0_ISSUER_BASE_URL: "https://dev-tenant.us.auth0.com/",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_SECRET: "session-secret",
    }),
    true,
  );

  assert.equal(
    hasAuth0EnvConfig({
      NEXT_PUBLIC_AUTH0_DOMAIN: "https://dev-tenant.us.auth0.com/",
      NEXT_PUBLIC_AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_SECRET: "session-secret",
    }),
    true,
  );
});

test("isLocalDevHostname only allows loopback-style hosts", () => {
  assert.equal(isLocalDevHostname("localhost"), true);
  assert.equal(isLocalDevHostname("app.localhost"), true);
  assert.equal(isLocalDevHostname("127.0.0.1"), true);
  assert.equal(isLocalDevHostname("[::1]"), true);
  assert.equal(isLocalDevHostname("savantrepo.com"), false);
});

test("isLocalDevAuthBypass requires both development mode and a local host", () => {
  assert.equal(isLocalDevAuthBypass("http://localhost:3000/settings", "development"), true);
  assert.equal(isLocalDevAuthBypass("http://127.0.0.1:3000/settings", "development"), true);
  assert.equal(isLocalDevAuthBypass("https://savantrepo.com/settings", "development"), false);
  assert.equal(isLocalDevAuthBypass("http://localhost:3000/settings", "production"), false);
});

test("isAuthRoute only bypasses the Auth0 SDK route namespace", () => {
  assert.equal(isAuthRoute("/auth/login"), true);
  assert.equal(isAuthRoute("/auth/logout"), true);
  assert.equal(isAuthRoute("/settings"), false);
  assert.equal(isAuthRoute("/api/overview"), false);
});

test("isLegacyAuthApiRoute only matches the old Auth0 API namespace", () => {
  assert.equal(isLegacyAuthApiRoute("/api/auth/login"), true);
  assert.equal(isLegacyAuthApiRoute("/api/auth/logout"), true);
  assert.equal(isLegacyAuthApiRoute("/auth/login"), false);
});

test("normalizeReturnToPath keeps safe relative paths and rejects external targets", () => {
  assert.equal(normalizeReturnToPath("/dashboard?tab=overview", "/"), "/dashboard?tab=overview");
  assert.equal(normalizeReturnToPath("https://evil.example/phish", "/dashboard"), "/dashboard");
  assert.equal(normalizeReturnToPath(undefined, "/dashboard"), "/dashboard");
});

test("getAuthReturnTo preserves the relative dashboard path and query string", () => {
  assert.equal(
    getAuthReturnTo("https://savantrepo.com/repositories?tab=all&sort=recent"),
    "/repositories?tab=all&sort=recent",
  );
});

test("buildAuthStatusHref preserves the requested source and safe return target", () => {
  assert.equal(
    buildAuthStatusHref({
      source: "signup",
      returnTo: "/onboarding?cycle=annual&seats=5",
    }),
    "/auth-status?source=signup&returnTo=%2Fonboarding%3Fcycle%3Dannual%26seats%3D5",
  );

  assert.equal(
    buildAuthStatusHref({
      source: "signin",
      returnTo: "https://evil.example/phish",
    }),
    "/auth-status?source=signin&returnTo=%2Fdashboard",
  );
});

test("isProtectedDashboardPath only gates dashboard and API routes", () => {
  assert.equal(isProtectedDashboardPath("/"), false);
  assert.equal(isProtectedDashboardPath("/signup"), false);
  assert.equal(isProtectedDashboardPath("/signin"), false);
  assert.equal(isProtectedDashboardPath("/onboarding"), false);
  assert.equal(isProtectedDashboardPath("/o/acme/dashboard"), true);
  assert.equal(isProtectedDashboardPath("/dashboard"), true);
  assert.equal(isProtectedDashboardPath("/settings"), true);
  assert.equal(isProtectedDashboardPath("/api/settings/workspace"), true);
  assert.equal(isProtectedDashboardPath("/api/auth/login"), false);
});

test("getLegacyAuthRedirectPath upgrades legacy login URLs to the current sign-in and sign-up pages", () => {
  assert.equal(getLegacyAuthRedirectPath("https://savantrepo.com/api/auth/login"), "/signin");
  assert.equal(
    getLegacyAuthRedirectPath("https://savantrepo.com/api/auth/login?screen_hint=signup&returnTo=%2Fonboarding"),
    "/signup?returnTo=%2Fonboarding",
  );
  assert.equal(
    getLegacyAuthRedirectPath("https://savantrepo.com/api/auth/logout?returnTo=%2F"),
    "/auth/logout?returnTo=%2F",
  );
});

test("getDashboardAuthAction redirects unauthenticated non-local dashboard requests to login", () => {
  assert.equal(
    getDashboardAuthAction({
      isConfigured: true,
      isLocalDevBypass: false,
      pathname: "/settings",
      hasSession: false,
    }),
    "redirect-to-login",
  );

  assert.equal(
    getDashboardAuthAction({
      isConfigured: true,
      isLocalDevBypass: false,
      pathname: "/signup",
      hasSession: false,
    }),
    "allow",
  );

  assert.equal(
    getDashboardAuthAction({
      isConfigured: true,
      isLocalDevBypass: false,
      pathname: "/auth/login",
      hasSession: false,
    }),
    "allow",
  );

  assert.equal(
    getDashboardAuthAction({
      isConfigured: false,
      isLocalDevBypass: true,
      pathname: "/settings",
      hasSession: false,
    }),
    "allow",
  );

  assert.equal(
    getDashboardAuthAction({
      isConfigured: false,
      isLocalDevBypass: false,
      pathname: "/settings",
      hasSession: false,
    }),
    "require-auth0-config",
  );
});
