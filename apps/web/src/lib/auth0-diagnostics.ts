import { hasAuth0EnvConfig, isConfiguredAuth0Value, resolveAuth0AppBaseUrl, resolveAuth0Domain } from "./auth0-config.ts";

export type AuthDiagnosticsEnv = Record<string, string | undefined>;
export type DiagnosticEnvStatus = "configured" | "missing" | "placeholder";
export type Auth0DiscoveryStatus = "reachable" | "unreachable" | "not-configured";

export type Auth0DiscoveryDiagnostics = {
  status: Auth0DiscoveryStatus;
  issuer: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  errorMessage: string | null;
};

export type Auth0Diagnostics = {
  overallStatus: "configured" | "development-bypass" | "unconfigured";
  provider: "auth0";
  usesUniversalLogin: true;
  loginRoute: "/auth/login";
  signupRoute: "/auth/login?screen_hint=signup";
  tenantDomain: string | null;
  tenantDomainStatus: DiagnosticEnvStatus;
  clientId: string | null;
  clientIdStatus: DiagnosticEnvStatus;
  clientSecretStatus: DiagnosticEnvStatus;
  sessionSecretStatus: DiagnosticEnvStatus;
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

function classifyEnvValue(value: string | undefined): DiagnosticEnvStatus {
  if (typeof value !== "string" || !value.trim()) {
    return "missing";
  }

  return isConfiguredAuth0Value(value) ? "configured" : "placeholder";
}

function readConfiguredValue(env: AuthDiagnosticsEnv, key: string): string | null {
  const value = env[key];
  return typeof value === "string" && isConfiguredAuth0Value(value) ? value.trim() : null;
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
  const clientId = readConfiguredValue(env, "AUTH0_CLIENT_ID");
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

export function buildAuth0Diagnostics(env: AuthDiagnosticsEnv = process.env): Omit<Auth0Diagnostics, "discovery"> {
  const tenantDomain = resolveAuth0Domain(env);
  const appBaseUrl = resolveAuth0AppBaseUrl(env);
  const publicAppUrl = readConfiguredValue(env, "NEXT_PUBLIC_APP_URL");
  const normalizedAppBaseUrl = appBaseUrl ? normalizeOrigin(appBaseUrl) : null;
  const normalizedPublicAppUrl = publicAppUrl ? normalizeOrigin(publicAppUrl) : null;
  const rawSessionSecret = readConfiguredValue(env, "AUTH0_SECRET");

  return {
    overallStatus: readAuthOverallStatus(env),
    provider: "auth0",
    usesUniversalLogin: true,
    loginRoute: "/auth/login",
    signupRoute: "/auth/login?screen_hint=signup",
    tenantDomain,
    tenantDomainStatus:
      classifyEnvValue(env.AUTH0_DOMAIN) === "configured" || classifyEnvValue(env.AUTH0_ISSUER_BASE_URL) === "configured"
        ? "configured"
        : classifyEnvValue(env.AUTH0_DOMAIN) === "placeholder" || classifyEnvValue(env.AUTH0_ISSUER_BASE_URL) === "placeholder"
          ? "placeholder"
          : "missing",
    clientId: readConfiguredValue(env, "AUTH0_CLIENT_ID"),
    clientIdStatus: classifyEnvValue(env.AUTH0_CLIENT_ID),
    clientSecretStatus: classifyEnvValue(env.AUTH0_CLIENT_SECRET),
    sessionSecretStatus: classifyEnvValue(env.AUTH0_SECRET),
    sessionSecretMatchesRecommendedHex64: rawSessionSecret ? /^[0-9a-f]{64}$/i.test(rawSessionSecret) : null,
    appBaseUrl,
    appBaseUrlStatus: appBaseUrl
      ? "configured"
      : classifyEnvValue(env.APP_BASE_URL) === "placeholder" || classifyEnvValue(env.AUTH0_BASE_URL) === "placeholder"
        ? "placeholder"
        : "missing",
    publicAppUrl,
    publicAppUrlStatus: classifyEnvValue(env.NEXT_PUBLIC_APP_URL),
    appBaseUrlMatchesPublicAppUrl:
      normalizedAppBaseUrl && normalizedPublicAppUrl
        ? normalizedAppBaseUrl === normalizedPublicAppUrl
        : null,
    callbackUrl: appBaseUrl ? `${appBaseUrl}/auth/callback` : null,
    logoutUrl: appBaseUrl ? `${appBaseUrl}/` : null,
    databaseStatus: classifyEnvValue(env.DATABASE_URL),
    stripeSecretStatus: classifyEnvValue(env.STRIPE_SECRET_KEY),
    stripeWebhookStatus: classifyEnvValue(env.STRIPE_WEBHOOK_SECRET),
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

  return {
    ...diagnostics,
    discovery: await loadAuth0Discovery(diagnostics.tenantDomain, fetchImpl),
  };
}
