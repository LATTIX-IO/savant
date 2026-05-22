export const AUTH0_ENV_KEYS = [
  "APP_BASE_URL",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
] as const;

const AUTH0_REQUIRED_DIRECT_KEYS = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
] as const;

const AUTH0_APP_BASE_URL_FALLBACK_KEYS = [
  "APP_BASE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

export type Auth0EnvKey = (typeof AUTH0_ENV_KEYS)[number];
export type Auth0Env = Record<string, string | undefined>;
export type DashboardAuthAction = "allow" | "redirect-to-login" | "require-auth0-config";

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const RETURN_TO_SANITIZE_BASE = "https://savant.local";
const PROTECTED_DASHBOARD_PREFIXES = [
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

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("<") || trimmed.includes("REPLACE") || trimmed.startsWith("placeholder-")) {
    return false;
  }

  return true;
}

export function hasAuth0EnvConfig(env: Auth0Env): boolean {
  return Boolean(resolveAuth0AppBaseUrl(env))
    && AUTH0_REQUIRED_DIRECT_KEYS.every((key) => isConfiguredAuth0Value(env[key]));
}

function normalizeAuth0AppBaseUrlCandidate(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function resolveAuth0AppBaseUrl(env: Auth0Env): string | null {
  for (const key of AUTH0_APP_BASE_URL_FALLBACK_KEYS) {
    const value = env[key];

    if (typeof value !== "string") {
      continue;
    }

    if (!isConfiguredAuth0Value(value)) {
      continue;
    }

    return normalizeAuth0AppBaseUrlCandidate(value);
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
