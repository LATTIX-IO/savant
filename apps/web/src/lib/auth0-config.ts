export const AUTH0_ENV_KEYS = [
  "APP_BASE_URL",
  "AUTH0_BASE_URL",
  "AUTH0_DOMAIN",
  "AUTH0_ISSUER_BASE_URL",
  "AUTH0_CLIENT_ID",
  "NEXT_PUBLIC_AUTH0_DOMAIN",
  "NEXT_PUBLIC_AUTH0_ISSUER_BASE_URL",
  "NEXT_PUBLIC_AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
] as const;

const AUTH0_REQUIRED_SECRET_KEYS = [
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
] as const;
const AUTH0_CLIENT_ID_FALLBACK_KEYS = [
  "AUTH0_CLIENT_ID",
  "NEXT_PUBLIC_AUTH0_CLIENT_ID",
] as const;

const AUTH0_APP_BASE_URL_FALLBACK_KEYS = [
  "APP_BASE_URL",
  "AUTH0_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

const AUTH0_DOMAIN_FALLBACK_KEYS = [
  "AUTH0_DOMAIN",
  "AUTH0_ISSUER_BASE_URL",
  "NEXT_PUBLIC_AUTH0_DOMAIN",
  "NEXT_PUBLIC_AUTH0_ISSUER_BASE_URL",
] as const;

export type Auth0EnvKey = (typeof AUTH0_ENV_KEYS)[number];
export type Auth0Env = Record<string, string | undefined>;
export type DashboardAuthAction = "allow" | "redirect-to-login" | "require-auth0-config";
export type AuthStatusSource = "signin" | "signup" | "onboarding" | "unavailable";

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function normalizeConfiguredAuth0Value(value: string): {
  normalized: string;
  hadWrappingQuotes: boolean;
} {
  const trimmed = value.trim();

  if (trimmed.length >= 2) {
    const firstChar = trimmed[0];
    const lastChar = trimmed.at(-1);

    if ((firstChar === '"' || firstChar === "'") && lastChar === firstChar) {
      return {
        normalized: trimmed.slice(1, -1).trim(),
        hadWrappingQuotes: true,
      };
    }
  }

  return {
    normalized: trimmed,
    hadWrappingQuotes: false,
  };
}

export function isQuotedConfiguredEnvValue(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return normalizeConfiguredAuth0Value(value).hadWrappingQuotes;
}

export function readConfiguredEnvValue(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const { normalized } = normalizeConfiguredAuth0Value(value);

  return isConfiguredAuth0Value(normalized) ? normalized : null;
}

export function resolveAuth0ClientId(env: Auth0Env): string | null {
  for (const key of AUTH0_CLIENT_ID_FALLBACK_KEYS) {
    const configuredValue = readConfiguredEnvValue(env[key]);

    if (configuredValue) {
      return configuredValue;
    }
  }

  return null;
}
const RETURN_TO_SANITIZE_BASE = "https://savant.local";
const PROTECTED_DASHBOARD_PREFIXES = [
  "/o",
  "/dashboard",
  "/skills",
  "/repositories",
  "/evaluations",
  "/releases",
  "/policies",
  "/audit",
  "/connectors",
  "/settings",
] as const;

export function isConfiguredAuth0Value(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const { normalized: trimmed } = normalizeConfiguredAuth0Value(value);

  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("<") || trimmed.includes("REPLACE") || trimmed.startsWith("placeholder-")) {
    return false;
  }

  return true;
}

export function hasAuth0EnvConfig(env: Auth0Env): boolean {
  return Boolean(resolveAuth0Domain(env))
    && Boolean(resolveAuth0ClientId(env))
    && AUTH0_REQUIRED_SECRET_KEYS.every((key) => isConfiguredAuth0Value(env[key]));
}

function normalizeAuth0AppBaseUrlCandidate(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function normalizeAuth0DomainCandidate(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (!trimmed) {
    return null;
  }

  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);

    return parsed.hostname || null;
  } catch {
    return null;
  }
}

export function resolveAuth0AppBaseUrl(env: Auth0Env): string | null {
  for (const key of AUTH0_APP_BASE_URL_FALLBACK_KEYS) {
    const value = readConfiguredEnvValue(env[key]);

    if (!value) {
      continue;
    }

    return normalizeAuth0AppBaseUrlCandidate(value);
  }

  return null;
}

export function resolveAuth0Domain(env: Auth0Env): string | null {
  for (const key of AUTH0_DOMAIN_FALLBACK_KEYS) {
    const value = readConfiguredEnvValue(env[key]);

    if (!value) {
      continue;
    }

    const normalized = normalizeAuth0DomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function isLocalDevHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();

  if (!normalizedHostname) {
    return false;
  }

  return LOCAL_DEV_HOSTS.has(normalizedHostname) || normalizedHostname.endsWith(".localhost");
}

export function isLocalDevAuthBypass(url: string | URL, nodeEnv = process.env.NODE_ENV): boolean {
  if (nodeEnv !== "development") {
    return false;
  }

  const resolvedUrl = typeof url === "string" ? new URL(url) : url;

  return isLocalDevHostname(resolvedUrl.hostname);
}

export function isAuthRoute(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

export function isLegacyAuthApiRoute(pathname: string): boolean {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

export function normalizeReturnToPath(value: string | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, RETURN_TO_SANITIZE_BASE);

    if (parsed.origin !== RETURN_TO_SANITIZE_BASE) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
  } catch {
    return fallback;
  }
}

export function getAuthReturnTo(url: string | URL): string {
  const resolvedUrl = typeof url === "string" ? new URL(url) : url;
  const returnTo = `${resolvedUrl.pathname}${resolvedUrl.search}`;

  return returnTo || "/";
}

export function buildAuthStatusHref({
  source,
  returnTo,
}: {
  source: AuthStatusSource;
  returnTo?: string | undefined;
}): string {
  const search = new URLSearchParams({ source });
  const normalizedReturnTo = normalizeReturnToPath(returnTo, "/dashboard");

  if (normalizedReturnTo) {
    search.set("returnTo", normalizedReturnTo);
  }

  return `/auth-status?${search.toString()}`;
}

export function isProtectedDashboardPath(pathname: string): boolean {
  if (isAuthRoute(pathname) || isLegacyAuthApiRoute(pathname)) {
    return false;
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return true;
  }

  return PROTECTED_DASHBOARD_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function getLegacyAuthRedirectPath(url: string | URL): string | null {
  const resolvedUrl = typeof url === "string" ? new URL(url) : url;

  if (!isLegacyAuthApiRoute(resolvedUrl.pathname)) {
    return null;
  }

  if (resolvedUrl.pathname === "/api/auth/login") {
    const nextSearch = new URLSearchParams(resolvedUrl.searchParams);
    const screenHint = nextSearch.get("screen_hint");

    if (screenHint === "signup") {
      nextSearch.delete("screen_hint");
      const search = nextSearch.toString();
      return `/signup${search ? `?${search}` : ""}`;
    }

    const search = nextSearch.toString();
    return `/signin${search ? `?${search}` : ""}`;
  }

  const canonicalPath = resolvedUrl.pathname.replace(/^\/api\/auth(?=\/|$)/, "/auth");
  const search = resolvedUrl.searchParams.toString();

  return `${canonicalPath}${search ? `?${search}` : ""}`;
}

export function getDashboardAuthAction({
  isConfigured,
  isLocalDevBypass,
  pathname,
  hasSession,
}: {
  isConfigured: boolean;
  isLocalDevBypass: boolean;
  pathname: string;
  hasSession: boolean;
}): DashboardAuthAction {
  if (!isProtectedDashboardPath(pathname)) {
    return "allow";
  }

  if (!isConfigured) {
    return isLocalDevBypass ? "allow" : "require-auth0-config";
  }

  if (isLocalDevBypass || isAuthRoute(pathname) || hasSession) {
    return "allow";
  }

  return "redirect-to-login";
}
