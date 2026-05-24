import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCheckoutClientReferenceId,
  buildOnboardingStatusPath,
  buildOnboardingStatusView,
  buildOnboardingSuccessPath,
  buildStripeTenantMetadata,
  extractProvisionTenantInput,
  normalizeWorkspaceSlug,
  shouldResumeOnboardingCheckout,
  validateOnboardingDraftInput,
} from "./onboarding.ts";

test("validateOnboardingDraftInput trims and normalizes a valid draft", () => {
  const result = validateOnboardingDraftInput({
    workspaceName: "  Savant Ops  ",
    workspaceSlug: "Savant Ops!!!",
    cycle: "monthly",
    seats: "9",
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    assert.fail("expected a valid onboarding draft");
  }

  assert.deepEqual(result.value, {
    workspaceName: "Savant Ops",
    workspaceSlug: "savant-ops",
    cycle: "monthly",
    seats: 9,
  });
});

test("validateOnboardingDraftInput rejects an invalid slug", () => {
  const result = validateOnboardingDraftInput({
    workspaceName: "Savant",
    workspaceSlug: "$$",
    cycle: "annual",
    seats: 5,
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("expected invalid slug validation to fail");
  }

  assert.equal(result.code, "workspace_slug_invalid");
});

test("normalizeWorkspaceSlug preserves a clean production slug", () => {
  assert.equal(normalizeWorkspaceSlug("finance-ops"), "finance-ops");
  assert.equal(normalizeWorkspaceSlug("Finance Ops"), "finance-ops");
});

test("shouldResumeOnboardingCheckout only resumes active payment states", () => {
  assert.equal(shouldResumeOnboardingCheckout("checkout_pending"), true);
  assert.equal(shouldResumeOnboardingCheckout("provisioning"), true);
  assert.equal(shouldResumeOnboardingCheckout("draft"), false);
  assert.equal(shouldResumeOnboardingCheckout("ready"), false);
});

test("buildOnboardingStatusView marks a ready session as terminal and dashboard-safe", () => {
  const result = buildOnboardingStatusView({
    id: "onb_123",
    workspaceName: "Savant",
    workspaceSlug: "savant",
    cycle: "annual",
    seats: 5,
    status: "ready",
    stripeCheckoutSessionId: "cs_test_123",
    organizationId: "org_123",
    errorCode: null,
    errorMessage: null,
    updatedAt: new Date("2026-05-21T18:00:00Z").toISOString(),
  });

  assert.equal(result.isTerminal, true);
  assert.equal(result.canEnterDashboard, true);
  assert.match(result.heading, /workspace ready/i);
});

test("buildOnboardingSuccessPath preserves Stripe placeholders and fallback lookup ids", () => {
  assert.equal(
    buildOnboardingSuccessPath({
      sessionId: "{CHECKOUT_SESSION_ID}",
      onboardingSessionId: "onb_123",
      sandbox: true,
      workspaceName: "Savant Ops",
      workspaceSlug: "savant-ops",
    }),
    "/onboarding/success?session_id={CHECKOUT_SESSION_ID}&onboarding_session_id=onb_123&sandbox=1&workspace_name=Savant%20Ops&workspace_slug=savant-ops",
  );
});

test("buildOnboardingStatusPath can recover with only an onboarding session id", () => {
  assert.equal(
    buildOnboardingStatusPath({ onboardingSessionId: "onb_123" }),
    "/api/onboarding/status?onboarding_session_id=onb_123",
  );
});

test("buildCheckoutClientReferenceId keeps short auth subjects intact", () => {
  assert.equal(
    buildCheckoutClientReferenceId({ authSubject: "auth0|abc123", onboardingSessionId: "onb_123" }),
    "auth0|abc123",
  );
});

test("buildCheckoutClientReferenceId falls back to onboarding session id for long subjects", () => {
  assert.equal(
    buildCheckoutClientReferenceId({
      authSubject: `auth0|${"x".repeat(260)}`,
      onboardingSessionId: "onb_123",
    }),
    "onb_123",
  );
});

test("buildCheckoutClientReferenceId omits the field when no safe fallback exists", () => {
  assert.equal(
    buildCheckoutClientReferenceId({ authSubject: `auth0|${"x".repeat(260)}` }),
    undefined,
  );
});

test("buildStripeTenantMetadata creates a stable Auth0-Stripe correlation payload", () => {
  assert.deepEqual(
    buildStripeTenantMetadata({
      organizationId: "org_123",
      workspaceSlug: "savant-ops",
      workspaceUrl: "https://savantrepo.com/o/savant-ops",
      auth0Subject: "auth0|abc123",
    }),
    {
      tenantId: "org_123",
      workspaceSlug: "savant-ops",
      workspaceUrl: "https://savantrepo.com/o/savant-ops",
      auth0Sub: "auth0|abc123",
    },
  );
});

test("extractProvisionTenantInput reads the Stripe checkout correlation metadata", () => {
  const result = extractProvisionTenantInput({
    id: "cs_test_123",
    client_reference_id: "auth0|abc123",
    customer: "cus_123",
    customer_details: {
      email: "owner@savant.app",
      name: "Savant Owner",
    },
    customer_email: "owner@savant.app",
    livemode: false,
    metadata: {
      authSub: "auth0|abc123",
      cycle: "monthly",
      onboardingSessionId: "onb_123",
      seats: "12",
      workspaceName: "Savant Ops",
      workspaceSlug: "savant-ops",
    },
    subscription: "sub_123",
  } as unknown as import("stripe").Stripe.Checkout.Session);

  assert.equal(result.ok, true);
  if (!result.ok) {
    assert.fail("expected checkout extraction to succeed");
  }

  assert.deepEqual(result.value, {
    onboardingSessionId: "onb_123",
    checkoutSessionId: "cs_test_123",
    auth0Subject: "auth0|abc123",
    auth0Email: "owner@savant.app",
    auth0DisplayName: "Savant Owner",
    workspaceName: "Savant Ops",
    workspaceSlug: "savant-ops",
    cycle: "monthly",
    seats: 12,
    paymentEnvironment: "test",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  });
});
