import type Stripe from "stripe";

export type BillingCycle = "monthly" | "annual";
export type PaymentEnvironment = "test" | "live";
export type OnboardingStatus =
  | "draft"
  | "checkout_pending"
  | "provisioning"
  | "ready"
  | "failed"
  | "canceled";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export type OnboardingIdentity = {
  subject: string;
  email: string;
  displayName: string;
};

export type OnboardingDraftSnapshot = {
  workspaceName: string;
  workspaceSlug: string;
  cycle: BillingCycle;
  seats: number;
};

export type OnboardingSessionSummary = OnboardingDraftSnapshot & {
  id: string;
  status: OnboardingStatus;
  stripeCheckoutSessionId: string | null;
  organizationId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

export type OnboardingSessionRecord = OnboardingSessionSummary & {
  auth0Subject: string;
  auth0Email: string;
  auth0DisplayName: string | null;
  paymentEnvironment: PaymentEnvironment;
  checkoutIdempotencyKey: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export type OnboardingStatusView = OnboardingSessionSummary & {
  heading: string;
  body: string;
  canEnterDashboard: boolean;
  isTerminal: boolean;
};

export type ProvisionTenantInput = {
  onboardingSessionId: string | null;
  checkoutSessionId: string;
  auth0Subject: string;
  auth0Email: string;
  auth0DisplayName: string | null;
  workspaceName: string;
  workspaceSlug: string;
  cycle: BillingCycle;
  seats: number;
  paymentEnvironment: PaymentEnvironment;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

const WORKSPACE_NAME_MAX_LENGTH = 80;
const WORKSPACE_SLUG_MAX_LENGTH = 48;
const WORKSPACE_SLUG_MIN_LENGTH = 3;
const DEFAULT_SEATS = 5;
const MAX_SEATS = 500;
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readNormalizedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function normalizeBillingCycle(value: unknown): BillingCycle {
  return value === "monthly" ? "monthly" : "annual";
}

export function normalizeSeatCount(value: unknown, fallback = DEFAULT_SEATS): number {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(MAX_SEATS, Math.floor(parsed));
}

export function normalizeWorkspaceName(value: unknown): string | null {
  const normalized = readNormalizedString(value);

  if (!normalized || normalized.length > WORKSPACE_NAME_MAX_LENGTH) {
    return null;
  }

  return normalized;
}

export function normalizeWorkspaceSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSPACE_SLUG_MAX_LENGTH);

  if (
    normalized.length < WORKSPACE_SLUG_MIN_LENGTH
    || !WORKSPACE_SLUG_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function validateOnboardingDraftInput(input: {
  workspaceName?: unknown;
  workspaceSlug?: unknown;
  cycle?: unknown;
  seats?: unknown;
}): ValidationResult<OnboardingDraftSnapshot> {
  const workspaceName = normalizeWorkspaceName(input.workspaceName);
  if (!workspaceName) {
    return {
      ok: false,
      code: "workspace_name_invalid",
      message: "Enter a workspace name up to 80 characters.",
    };
  }

  const workspaceSlug = normalizeWorkspaceSlug(input.workspaceSlug);
  if (!workspaceSlug) {
    return {
      ok: false,
      code: "workspace_slug_invalid",
      message: "Use 3-48 lowercase letters, numbers, or hyphens for the workspace URL.",
    };
  }

  return {
    ok: true,
    value: {
      workspaceName,
      workspaceSlug,
      cycle: normalizeBillingCycle(input.cycle),
      seats: normalizeSeatCount(input.seats),
    },
  };
}

export function createCheckoutIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function shouldResumeOnboardingCheckout(status: OnboardingStatus): boolean {
  return status === "checkout_pending" || status === "provisioning";
}

export function buildOnboardingStatusView(
  session: OnboardingSessionSummary,
): OnboardingStatusView {
  switch (session.status) {
    case "ready":
      return {
        ...session,
        heading: "Workspace ready.",
        body:
          "Your workspace is provisioned, your trial is active, and you can head straight into Savant.",
        canEnterDashboard: true,
        isTerminal: true,
      };
    case "failed":
      return {
        ...session,
        heading: "We hit a snag finishing setup.",
        body:
          session.errorMessage
          ?? "We saved your onboarding details, but final provisioning needs another attempt.",
        canEnterDashboard: false,
        isTerminal: true,
      };
    case "canceled":
      return {
        ...session,
        heading: "Checkout canceled.",
        body: "Your onboarding details are still saved when you're ready to try again.",
        canEnterDashboard: false,
        isTerminal: true,
      };
    case "provisioning":
      return {
        ...session,
        heading: "Finalizing your workspace.",
        body:
          "Checkout is confirmed. We're now provisioning your tenant and syncing billing details.",
        canEnterDashboard: false,
        isTerminal: false,
      };
    case "checkout_pending":
      return {
        ...session,
        heading: "Waiting for checkout confirmation.",
        body:
          "We're waiting for checkout confirmation before provisioning the workspace.",
        canEnterDashboard: false,
        isTerminal: false,
      };
    case "draft":
    default:
      return {
        ...session,
        heading: "Complete onboarding.",
        body: "Finish the billing step so we can provision your workspace.",
        canEnterDashboard: false,
        isTerminal: false,
      };
  }
}

export function buildStripeTenantMetadata(input: {
  organizationId: string;
  workspaceSlug: string;
  workspaceUrl: string;
  auth0Subject: string;
}): Record<string, string> {
  return {
    tenantId: input.organizationId,
    workspaceSlug: input.workspaceSlug,
    workspaceUrl: input.workspaceUrl,
    auth0Sub: input.auth0Subject,
  };
}

export function extractProvisionTenantInput(
  session: Stripe.Checkout.Session,
): ValidationResult<ProvisionTenantInput> {
  const workspaceName = normalizeWorkspaceName(session.metadata?.workspaceName);
  if (!workspaceName) {
    return {
      ok: false,
      code: "stripe_session_workspace_name_missing",
      message: "Stripe checkout session is missing a valid workspace name.",
    };
  }

  const workspaceSlug = normalizeWorkspaceSlug(session.metadata?.workspaceSlug);
  if (!workspaceSlug) {
    return {
      ok: false,
      code: "stripe_session_workspace_slug_missing",
      message: "Stripe checkout session is missing a valid workspace slug.",
    };
  }

  const auth0Subject = readNormalizedString(session.metadata?.authSub)
    ?? readNormalizedString(session.client_reference_id)
    ?? null;
  if (!auth0Subject) {
    return {
      ok: false,
      code: "stripe_session_auth_subject_missing",
      message: "Stripe checkout session is missing an Auth0 subject correlation id.",
    };
  }

  const auth0Email = readNormalizedString(session.customer_email)
    ?? readNormalizedString(session.customer_details?.email)
    ?? null;
  if (!auth0Email) {
    return {
      ok: false,
      code: "stripe_session_email_missing",
      message: "Stripe checkout session is missing a customer email.",
    };
  }

  const seats = normalizeSeatCount(session.metadata?.seats, 0);
  if (seats < 1) {
    return {
      ok: false,
      code: "stripe_session_seats_missing",
      message: "Stripe checkout session is missing a valid seat count.",
    };
  }

  return {
    ok: true,
    value: {
      onboardingSessionId: readNormalizedString(session.metadata?.onboardingSessionId),
      checkoutSessionId: session.id,
      auth0Subject,
      auth0Email,
      auth0DisplayName:
        readNormalizedString(session.customer_details?.name)
        ?? readNormalizedString(session.customer_details?.email),
      workspaceName,
      workspaceSlug,
      cycle: normalizeBillingCycle(session.metadata?.cycle),
      seats,
      paymentEnvironment: session.livemode ? "live" : "test",
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      stripeSubscriptionId:
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
    },
  };
}
