import assert from "node:assert/strict";
import test from "node:test";

import {
  getDashboardAuthAction,
  getAuthReturnTo,
  hasAuth0EnvConfig,
  isAuthRoute,
  isConfiguredAuth0Value,
  isLocalDevAuthBypass,
  isLocalDevHostname,
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

test("hasAuth0EnvConfig requires every Auth0 variable to be configured", () => {
  assert.equal(
    hasAuth0EnvConfig({
      APP_BASE_URL: "http://localhost:3000",
      AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_SECRET: "session-secret",
    }),
    true,
  );

  assert.equal(
    hasAuth0EnvConfig({
      APP_BASE_URL: "http://localhost:3000",
      AUTH0_DOMAIN: "<AUTH0_DOMAIN>",
      AUTH0_CLIENT_ID: "client-id",
      AUTH0_CLIENT_SECRET: "client-secret",
      AUTH0_SECRET: "session-secret",
    }),
    false,
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

test("getAuthReturnTo preserves the relative dashboard path and query string", () => {
  assert.equal(
    getAuthReturnTo("https://savantrepo.com/repositories?tab=all&sort=recent"),
    "/repositories?tab=all&sort=recent",
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
