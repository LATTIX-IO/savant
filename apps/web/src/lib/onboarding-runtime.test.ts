import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOnboardingReturnToPath,
  buildSandboxAuthSessionUser,
  buildSignupHrefForOnboarding,
  createSandboxCheckoutSessionId,
  isOnboardingSandboxEnabled,
  resolveOnboardingRuntimeAccess,
  sandboxCheckoutOutcome,
  shouldRedirectOnboardingToAuthStatus,
  shouldRedirectOnboardingToSignup,
} from "./onboarding-runtime.ts";

test("isOnboardingSandboxEnabled requires development plus an explicit flag", () => {
  assert.equal(isOnboardingSandboxEnabled({ NODE_ENV: "development" }), false);
  assert.equal(
    isOnboardingSandboxEnabled({ NODE_ENV: "production", ONBOARDING_DEV_SANDBOX: "1" }),
    false,
  );
  assert.equal(
    isOnboardingSandboxEnabled({ NODE_ENV: "development", ONBOARDING_DEV_SANDBOX: "true" }),
    true,
  );
});

test("buildSandboxAuthSessionUser uses deterministic local defaults", () => {
  assert.deepEqual(buildSandboxAuthSessionUser({}), {
    sub: "dev-sandbox|local-user",
    email: "local@savant.dev",
    name: "Local Sandbox User",
  });
});

test("resolveOnboardingRuntimeAccess prefers a real Auth0 session over sandbox mode", () => {
  const result = resolveOnboardingRuntimeAccess(
    {
      email: "owner@savant.app",
      name: "Owner",
      sub: "auth0|owner_123",
    },
    { NODE_ENV: "development", ONBOARDING_DEV_SANDBOX: "1" },
  );

  assert.equal(result.isSandbox, false);
  assert.equal(result.authSource, "auth0");
  assert.equal(result.identity?.subject, "auth0|owner_123");
  assert.equal(result.viewer.displayName, "Owner");
});

test("resolveOnboardingRuntimeAccess falls back to sandbox identity in local development", () => {
  const result = resolveOnboardingRuntimeAccess(undefined, {
    NODE_ENV: "development",
    ONBOARDING_DEV_SANDBOX: "1",
    ONBOARDING_SANDBOX_EMAIL: "sandbox@savant.dev",
    ONBOARDING_SANDBOX_NAME: "Sandbox Operator",
    ONBOARDING_SANDBOX_SUBJECT: "dev-sandbox|operator",
  });

  assert.equal(result.isSandbox, true);
  assert.equal(result.authSource, "sandbox");
  assert.deepEqual(result.identity, {
    subject: "dev-sandbox|operator",
    email: "sandbox@savant.dev",
    displayName: "Sandbox Operator",
  });
  assert.equal(result.viewer.displayName, "Sandbox Operator");
});

test("sandboxCheckoutOutcome defaults to success and normalizes cancel and fail", () => {
  assert.equal(sandboxCheckoutOutcome({}), "success");
  assert.equal(sandboxCheckoutOutcome({ ONBOARDING_DEV_SANDBOX_OUTCOME: "cancel" }), "cancel");
  assert.equal(sandboxCheckoutOutcome({ ONBOARDING_DEV_SANDBOX_OUTCOME: "fail" }), "fail");
  assert.equal(sandboxCheckoutOutcome({ ONBOARDING_DEV_SANDBOX_OUTCOME: "unexpected" }), "success");
});

test("createSandboxCheckoutSessionId returns a stable local prefix", () => {
  const id = createSandboxCheckoutSessionId();

  assert.match(id, /^sandbox_cs_[a-f0-9]{32}$/i);
});

test("buildOnboardingReturnToPath preserves onboarding query hints", () => {
  assert.equal(
    buildOnboardingReturnToPath({ cycle: "monthly", seats: "12", cancelled: "1" }),
    "/onboarding?cycle=monthly&seats=12&cancelled=1",
  );
  assert.equal(buildOnboardingReturnToPath({}), "/onboarding");
});

test("buildSignupHrefForOnboarding routes through signup before workspace config", () => {
  assert.equal(
    buildSignupHrefForOnboarding({ cycle: "annual", seats: "5" }),
    "/signup?returnTo=%2Fonboarding%3Fcycle%3Dannual%26seats%3D5",
  );
});

test("shouldRedirectOnboardingToSignup only gates real unauthenticated onboarding", () => {
  assert.equal(
    shouldRedirectOnboardingToSignup({ hasIdentity: false, isSandbox: false, isAuth0Configured: true }),
    true,
  );
  assert.equal(
    shouldRedirectOnboardingToSignup({ hasIdentity: true, isSandbox: false, isAuth0Configured: true }),
    false,
  );
  assert.equal(
    shouldRedirectOnboardingToSignup({ hasIdentity: false, isSandbox: true, isAuth0Configured: true }),
    false,
  );
  assert.equal(
    shouldRedirectOnboardingToSignup({ hasIdentity: false, isSandbox: false, isAuth0Configured: false }),
    false,
  );
});

test("shouldRedirectOnboardingToAuthStatus blocks anonymous onboarding when Auth0 is unavailable", () => {
  assert.equal(
    shouldRedirectOnboardingToAuthStatus({ hasIdentity: false, isSandbox: false, isAuth0Configured: false }),
    true,
  );
  assert.equal(
    shouldRedirectOnboardingToAuthStatus({ hasIdentity: false, isSandbox: false, isAuth0Configured: true }),
    false,
  );
  assert.equal(
    shouldRedirectOnboardingToAuthStatus({ hasIdentity: true, isSandbox: false, isAuth0Configured: false }),
    false,
  );
  assert.equal(
    shouldRedirectOnboardingToAuthStatus({ hasIdentity: false, isSandbox: true, isAuth0Configured: false }),
    false,
  );
});