import {
  hasAuth0EnvConfig,
  isConfiguredAuth0Value,
  isQuotedConfiguredEnvValue,
  isLocalDevHostname,
  readConfiguredEnvValue,
  resolveAuth0AppBaseUrl,
  resolveAuth0ClientId,
  resolveAuth0Domain,
} from "./auth0-config.ts";

export type AuthDiagnosticsEnv = Record<string, string | undefined>;
export type DiagnosticEnvStatus = "configured" | "missing" | "placeholder";
export type Auth0DiscoveryStatus = "reachable" | "unreachable" | "not-configured";
export type FlowReadiness = "ready" | "blocked";

export type Auth0DiscoveryDiagnostics = {
  status: Auth0DiscoveryStatus;
  issuer: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  errorMessage: string | null;
};

export type Auth0Diagnostics = {
  overallStatus: "configured" | "development-bypass" | "unconfigured";
  authFlowStatus: FlowReadiness;
  onboardingFlowStatus: FlowReadiness;
  provider: "auth0";
  usesUniversalLogin: true;
  loginRoute: "/auth/login";
  signupRoute: "/auth/login?screen_hint=signup";
  tenantDomain: string | null;
  tenantDomainStatus: DiagnosticEnvStatus;
  clientId: string | null;
  clientIdStatus: DiagnosticEnvStatus;
  clientSecretStatus: DiagnosticEnvStatus;
  clientSecretWrappedInQuotes: boolean | null;
  sessionSecretStatus: DiagnosticEnvStatus;
  sessionSecretWrappedInQuotes: boolean | null;
  sessionSecretMatchesRecommendedHex64: boolean | null;
  appBaseUrl: string | null;
  appBaseUrlStatus: DiagnosticEnvStatus;
  publicAppUrl: string | null;
  publicAppUrlStatus: DiagnosticEnvStatus;
  appBaseUrlMatchesPublicAppUrl: boolean | null;
  callbackUrl: string | null;
  logoutUrl: string | null;
  databaseStatus: DiagnosticEnvStatus;
  stripeSecretStatus: DiagnosticEnvStatus;
  stripeWebhookStatus: DiagnosticEnvStatus;
  discovery: Auth0DiscoveryDiagnostics;
};

export type RequestOriginInput = {
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  nodeEnv?: string | undefined;
};

function classifyEnvValue(value: string | undefined): DiagnosticEnvStatus {
  if (typeof value !== "string" || !value.trim()) {
    return "missing";
  }

  return isConfiguredAuth0Value(value) ? "configured" : "placeholder";
}

function readConfiguredValue(env: AuthDiagnosticsEnv, key: string): string | null {
  return readConfiguredEnvValue(env[key]);
}

function readQuotedEnvValueStatus(value: string | undefined): boolean | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return isQuotedConfiguredEnvValue(value);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readAuthOverallStatus(env: AuthDiagnosticsEnv): Auth0Diagnostics["overallStatus"] {
  const appBaseUrl = resolveAuth0AppBaseUrl(env);
  const tenantDomain = resolveAuth0Domain(env);
  const clientId = resolveAuth0ClientId(env);
  const hasPublicConfig = Boolean(appBaseUrl || tenantDomain || clientId);

  return hasAuth0EnvConfig(env)
    ? "configured"
    : hasPublicConfig
      ? "development-bypass"
      : "unconfigured";
}

function readString(record: unknown, key: string): string | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return null;
  }

  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstForwardedValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.split(",")[0]?.trim();
  return normalized || null;
}

export function resolveRequestOrigin(input: RequestOriginInput): string | null {
  const host = firstForwardedValue(input.forwardedHost) ?? firstForwardedValue(input.host);

  if (!host) {
    return null;
  }

  const hostname = host.split(":")[0]?.replace(/^\[/, "").replace(/\]$/, "") ?? "";
  const proto = firstForwardedValue(input.forwardedProto)
    ?? ((input.nodeEnv === "development" || isLocalDevHostname(hostname)) ? "http" : "https");

  return `${proto}://${host}`;
}

export function doOriginsMatch(left: string | null, right: string | null): boolean | null {
  if (!left || !right) {
    return null;
  }

  const normalizedLeft = normalizeOrigin(left);
  const normalizedRight = normalizeOrigin(right);

  return normalizedLeft && normalizedRight ? normalizedLeft === normalizedRight : null;
}

export function getAuthFlowStatus(input: {
  tenantDomainStatus: DiagnosticEnvStatus;
  clientIdStatus: DiagnosticEnvStatus;
  clientSecretStatus: DiagnosticEnvStatus;
  sessionSecretStatus: DiagnosticEnvStatus;
  appBaseUrlStatus: DiagnosticEnvStatus;
  discoveryStatus: Auth0DiscoveryStatus;
  requestOriginMatchesAppBaseUrl?: boolean | null;
}): FlowReadiness {
  if (
    input.tenantDomainStatus !== "configured"
    || input.clientIdStatus !== "configured"
    || input.clientSecretStatus !== "configured"
    || input.sessionSecretStatus !== "configured"
    || input.appBaseUrlStatus !== "configured"
    || input.discoveryStatus !== "reachable"
    || input.requestOriginMatchesAppBaseUrl === false
  ) {
    return "blocked";
  }

  return "ready";
}

export function getOnboardingFlowStatus(input: {
  authFlowStatus: FlowReadiness;
  databaseStatus: DiagnosticEnvStatus;
  stripeSecretStatus: DiagnosticEnvStatus;
  stripeWebhookStatus: DiagnosticEnvStatus;
}): FlowReadiness {
  if (
    input.authFlowStatus !== "ready"
    || input.databaseStatus !== "configured"
    || input.stripeSecretStatus !== "configured"
    || input.stripeWebhookStatus !== "configured"
  ) {
    return "blocked";
  }

  return "ready";
}

export function getAuthBlockingIssues(
  diagnostics: Auth0Diagnostics,
  requestOrigin?: string | null,
): string[] {
  const actions: string[] = [];

  if (diagnostics.tenantDomainStatus !== "configured") {
    actions.push("Set AUTH0_DOMAIN or AUTH0_ISSUER_BASE_URL for the Auth0 tenant that owns this deployment.");
  }

  if (diagnostics.clientIdStatus !== "configured") {
    actions.push("Set AUTH0_CLIENT_ID (or NEXT_PUBLIC_AUTH0_CLIENT_ID as a fallback) for the Auth0 regular web application.");
  }

  if (diagnostics.clientSecretStatus !== "configured") {
    actions.push("Set a real AUTH0_CLIENT_SECRET in the deployment environment.");
  }

  if (diagnostics.sessionSecretStatus !== "configured") {
    actions.push("Set a real AUTH0_SECRET for encrypted server-side session cookies.");
  } else if (diagnostics.sessionSecretMatchesRecommendedHex64 === false) {
    actions.push("Rotate AUTH0_SECRET to a 64-character hex value so the SDK cookie encryption matches the documented production format.");
  }

  if (diagnostics.appBaseUrlStatus !== "configured") {
    actions.push("Set APP_BASE_URL to the exact deployed origin, or provide NEXT_PUBLIC_APP_URL / VERCEL_PROJECT_PRODUCTION_URL so callback and logout URLs resolve cleanly.");
  }

  if (requestOrigin && diagnostics.appBaseUrl && doOriginsMatch(requestOrigin, diagnostics.appBaseUrl) === false) {
    actions.push(`Update APP_BASE_URL to match the current deployed origin (${requestOrigin}) or register both origins in Auth0 before retrying login.`);
  }

  if (diagnostics.discovery.status === "unreachable") {
    actions.push("Verify the Auth0 tenant domain or custom domain and ensure the deployment can reach the discovery endpoint.");
  }

  return actions;
}

export function getOnboardingBlockingIssues(diagnostics: Auth0Diagnostics): string[] {
  const actions: string[] = [];

  if (diagnostics.databaseStatus !== "configured") {
    actions.push("Set DATABASE_URL and apply the onboarding + multitenancy schema before expecting production onboarding persistence to work.");
  }

  if (diagnostics.stripeSecretStatus !== "configured") {
    actions.push("Set STRIPE_SECRET_KEY so the server can create hosted Stripe Checkout sessions.");
  }

  if (diagnostics.stripeWebhookStatus !== "configured") {
    actions.push("Set STRIPE_WEBHOOK_SECRET before expecting the hosted onboarding flow to provision tenants end to end.");
  }

  return actions;
}

function tenantDomainEnvStatus(env: AuthDiagnosticsEnv): DiagnosticEnvStatus {
  return classifyEnvValue(env.AUTH0_DOMAIN) === "configured"
    || classifyEnvValue(env.AUTH0_ISSUER_BASE_URL) === "configured"
    || classifyEnvValue(env.NEXT_PUBLIC_AUTH0_DOMAIN) === "configured"
    || classifyEnvValue(env.NEXT_PUBLIC_AUTH0_ISSUER_BASE_URL) === "configured"
    ? "configured"
    : classifyEnvValue(env.AUTH0_DOMAIN) === "placeholder"
      || classifyEnvValue(env.AUTH0_ISSUER_BASE_URL) === "placeholder"
      || classifyEnvValue(env.NEXT_PUBLIC_AUTH0_DOMAIN) === "placeholder"
      || classifyEnvValue(env.NEXT_PUBLIC_AUTH0_ISSUER_BASE_URL) === "placeholder"
      ? "placeholder"
      : "missing";
}

function clientIdEnvStatus(env: AuthDiagnosticsEnv): DiagnosticEnvStatus {
  return classifyEnvValue(env.AUTH0_CLIENT_ID) === "configured"
    || classifyEnvValue(env.NEXT_PUBLIC_AUTH0_CLIENT_ID) === "configured"
    ? "configured"
    : classifyEnvValue(env.AUTH0_CLIENT_ID) === "placeholder"
      || classifyEnvValue(env.NEXT_PUBLIC_AUTH0_CLIENT_ID) === "placeholder"
      ? "placeholder"
      : "missing";
}

function appBaseUrlEnvStatus(env: AuthDiagnosticsEnv, appBaseUrl: string | null): DiagnosticEnvStatus {
  if (appBaseUrl) {
    return "configured";
  }

  return classifyEnvValue(env.APP_BASE_URL) === "placeholder"
    || classifyEnvValue(env.AUTH0_BASE_URL) === "placeholder"
    || classifyEnvValue(env.NEXT_PUBLIC_APP_URL) === "placeholder"
    || classifyEnvValue(env.NEXT_PUBLIC_SITE_URL) === "placeholder"
    || classifyEnvValue(env.VERCEL_PROJECT_PRODUCTION_URL) === "placeholder"
    || classifyEnvValue(env.VERCEL_URL) === "placeholder"
    ? "placeholder"
    : "missing";
}

export function buildAuth0Diagnostics(env: AuthDiagnosticsEnv = process.env): Omit<Auth0Diagnostics, "discovery"> {
  const tenantDomain = resolveAuth0Domain(env);
  const appBaseUrl = resolveAuth0AppBaseUrl(env);
  const publicAppUrl = readConfiguredValue(env, "NEXT_PUBLIC_APP_URL");
  const normalizedAppBaseUrl = appBaseUrl ? normalizeOrigin(appBaseUrl) : null;
  const normalizedPublicAppUrl = publicAppUrl ? normalizeOrigin(publicAppUrl) : null;
  const rawSessionSecret = readConfiguredValue(env, "AUTH0_SECRET");
  const tenantDomainStatus = tenantDomainEnvStatus(env);
  const clientId = resolveAuth0ClientId(env);
  const clientIdStatus = clientIdEnvStatus(env);
  const clientSecretStatus = classifyEnvValue(env.AUTH0_CLIENT_SECRET);
  const clientSecretWrappedInQuotes = readQuotedEnvValueStatus(env.AUTH0_CLIENT_SECRET);
  const sessionSecretStatus = classifyEnvValue(env.AUTH0_SECRET);
  const sessionSecretWrappedInQuotes = readQuotedEnvValueStatus(env.AUTH0_SECRET);
  const appBaseUrlStatus = appBaseUrlEnvStatus(env, appBaseUrl);
  const databaseStatus = classifyEnvValue(env.DATABASE_URL);
  const stripeSecretStatus = classifyEnvValue(env.STRIPE_SECRET_KEY);
  const stripeWebhookStatus = classifyEnvValue(env.STRIPE_WEBHOOK_SECRET);
  const authFlowStatus = getAuthFlowStatus({
    tenantDomainStatus,
    clientIdStatus,
    clientSecretStatus,
    sessionSecretStatus,
    appBaseUrlStatus,
    discoveryStatus: tenantDomain ? "reachable" : "not-configured",
  });

  return {
    overallStatus: readAuthOverallStatus(env),
    authFlowStatus,
    onboardingFlowStatus: getOnboardingFlowStatus({
      authFlowStatus,
      databaseStatus,
      stripeSecretStatus,
      stripeWebhookStatus,
    }),
    provider: "auth0",
    usesUniversalLogin: true,
    loginRoute: "/auth/login",
    signupRoute: "/auth/login?screen_hint=signup",
    tenantDomain,
    tenantDomainStatus,
    clientId,
    clientIdStatus,
    clientSecretStatus,
    clientSecretWrappedInQuotes,
    sessionSecretStatus,
    sessionSecretWrappedInQuotes,
    sessionSecretMatchesRecommendedHex64: rawSessionSecret ? /^[0-9a-f]{64}$/i.test(rawSessionSecret) : null,
    appBaseUrl,
    appBaseUrlStatus,
    publicAppUrl,
    publicAppUrlStatus: classifyEnvValue(env.NEXT_PUBLIC_APP_URL),
    appBaseUrlMatchesPublicAppUrl:
      normalizedAppBaseUrl && normalizedPublicAppUrl
        ? normalizedAppBaseUrl === normalizedPublicAppUrl
        : null,
    callbackUrl: appBaseUrl ? `${appBaseUrl}/auth/callback` : null,
    logoutUrl: appBaseUrl ? `${appBaseUrl}/` : null,
    databaseStatus,
    stripeSecretStatus,
    stripeWebhookStatus,
  };
}

export async function loadAuth0Discovery(
  tenantDomain: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Auth0DiscoveryDiagnostics> {
  if (!tenantDomain) {
    return {
      status: "not-configured",
      issuer: null,
      authorizationEndpoint: null,
      tokenEndpoint: null,
      errorMessage: null,
    };
  }

  try {
    const response = await fetchImpl(`https://${tenantDomain}/.well-known/openid-configuration`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return {
        status: "unreachable",
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        errorMessage: `Discovery endpoint returned HTTP ${response.status}.`,
      };
    }

    const payload = await response.json();

    return {
      status: "reachable",
      issuer: readString(payload, "issuer"),
      authorizationEndpoint: readString(payload, "authorization_endpoint"),
      tokenEndpoint: readString(payload, "token_endpoint"),
      errorMessage: null,
    };
  } catch (error) {
    return {
      status: "unreachable",
      issuer: null,
      authorizationEndpoint: null,
      tokenEndpoint: null,
      errorMessage: error instanceof Error ? error.message : "Unable to reach the Auth0 discovery endpoint.",
    };
  }
}

export async function getAuth0Diagnostics(
  env: AuthDiagnosticsEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Auth0Diagnostics> {
  const diagnostics = buildAuth0Diagnostics(env);
  const discovery = await loadAuth0Discovery(diagnostics.tenantDomain, fetchImpl);
  const authFlowStatus = getAuthFlowStatus({
    tenantDomainStatus: diagnostics.tenantDomainStatus,
    clientIdStatus: diagnostics.clientIdStatus,
    clientSecretStatus: diagnostics.clientSecretStatus,
    sessionSecretStatus: diagnostics.sessionSecretStatus,
    appBaseUrlStatus: diagnostics.appBaseUrlStatus,
    discoveryStatus: discovery.status,
  });

  return {
    ...diagnostics,
    authFlowStatus,
    onboardingFlowStatus: getOnboardingFlowStatus({
      authFlowStatus,
      databaseStatus: diagnostics.databaseStatus,
      stripeSecretStatus: diagnostics.stripeSecretStatus,
      stripeWebhookStatus: diagnostics.stripeWebhookStatus,
    }),
    discovery,
  };
}
