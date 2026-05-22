import {
  buildAuthenticatedIdentity,
  buildAuthViewer,
  type AuthSessionUser,
  type AuthenticatedIdentity,
  type AuthViewer,
} from "./auth0-session.ts";

export type OnboardingRuntimeEnv = Record<string, string | undefined>;
export type OnboardingAuthSource = "anonymous" | "auth0" | "sandbox";
export type SandboxCheckoutOutcome = "success" | "cancel" | "fail";
export type OnboardingEntryParams = {
  cycle?: string | undefined;
  seats?: string | undefined;
  cancelled?: string | undefined;
};

export type OnboardingRuntimeAccess = {
  viewer: AuthViewer;
  identity: AuthenticatedIdentity | null;
  authSource: OnboardingAuthSource;
  isSandbox: boolean;
};

const SANDBOX_ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DEFAULT_SANDBOX_SUBJECT = "dev-sandbox|local-user";
const DEFAULT_SANDBOX_EMAIL = "local@savant.dev";
const DEFAULT_SANDBOX_NAME = "Local Sandbox User";

function readNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isEnabledFlag(value: string | undefined): boolean {
  const normalized = readNonEmpty(value)?.toLowerCase();
  return normalized ? SANDBOX_ENABLED_VALUES.has(normalized) : false;
}

export function isOnboardingSandboxEnabled(
  env: OnboardingRuntimeEnv = process.env,
): boolean {
  return env.NODE_ENV === "development" && isEnabledFlag(env.ONBOARDING_DEV_SANDBOX);
}

export function buildSandboxAuthSessionUser(
  env: OnboardingRuntimeEnv = process.env,
): AuthSessionUser {
  return {
    sub: readNonEmpty(env.ONBOARDING_SANDBOX_SUBJECT) ?? DEFAULT_SANDBOX_SUBJECT,
    email: readNonEmpty(env.ONBOARDING_SANDBOX_EMAIL) ?? DEFAULT_SANDBOX_EMAIL,
    name: readNonEmpty(env.ONBOARDING_SANDBOX_NAME) ?? DEFAULT_SANDBOX_NAME,
  };
}

export function resolveOnboardingRuntimeAccess(
  user?: AuthSessionUser | null,
  env: OnboardingRuntimeEnv = process.env,
): OnboardingRuntimeAccess {
  const identity = buildAuthenticatedIdentity(user);
  if (identity) {
    return {
      viewer: buildAuthViewer(user),
      identity,
      authSource: "auth0",
      isSandbox: false,
    };
  }

  if (isOnboardingSandboxEnabled(env)) {
    const sandboxUser = buildSandboxAuthSessionUser(env);
    return {
      viewer: buildAuthViewer(sandboxUser),
      identity: buildAuthenticatedIdentity(sandboxUser),
      authSource: "sandbox",
      isSandbox: true,
    };
  }

  return {
    viewer: buildAuthViewer(user),
    identity: null,
    authSource: "anonymous",
    isSandbox: false,
  };
}

export function sandboxCheckoutOutcome(
  env: OnboardingRuntimeEnv = process.env,
): SandboxCheckoutOutcome {
  const normalized = readNonEmpty(env.ONBOARDING_DEV_SANDBOX_OUTCOME)?.toLowerCase();

  if (normalized === "cancel" || normalized === "fail") {
    return normalized;
  }

  return "success";
}

export function createSandboxCheckoutSessionId(): string {
  return `sandbox_cs_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function buildOnboardingReturnToPath(
  params: OnboardingEntryParams,
): string {
  const search = new URLSearchParams();

  const cycle = readNonEmpty(params.cycle);
  if (cycle) {
    search.set("cycle", cycle);
  }

  const seats = readNonEmpty(params.seats);
  if (seats) {
    search.set("seats", seats);
  }

  if (params.cancelled === "1") {
    search.set("cancelled", "1");
  }

  const query = search.toString();
  return query ? `/onboarding?${query}` : "/onboarding";
}

export function buildSignupHrefForOnboarding(
  params: OnboardingEntryParams,
): string {
  const search = new URLSearchParams({
    returnTo: buildOnboardingReturnToPath(params),
  });

  return `/signup?${search.toString()}`;
}

export function shouldRedirectOnboardingToSignup(input: {
  hasIdentity: boolean;
  isSandbox: boolean;
  isAuth0Configured: boolean;
}): boolean {
  return !input.hasIdentity && !input.isSandbox && input.isAuth0Configured;
}

export function shouldRedirectOnboardingToAuthStatus(input: {
  hasIdentity: boolean;
  isSandbox: boolean;
  isAuth0Configured: boolean;
}): boolean {
  return !input.hasIdentity && !input.isSandbox && !input.isAuth0Configured;
}