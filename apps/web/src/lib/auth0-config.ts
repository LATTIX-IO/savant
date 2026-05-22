export const AUTH0_ENV_KEYS = [
  "APP_BASE_URL",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
] as const;

export type Auth0EnvKey = (typeof AUTH0_ENV_KEYS)[number];
export type Auth0Env = Record<string, string | undefined>;
export type DashboardAuthAction = "allow" | "redirect-to-login" | "require-auth0-config";

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

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
  return AUTH0_ENV_KEYS.every((key) => isConfiguredAuth0Value(env[key]));
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

export function getAuthReturnTo(url: string | URL): string {
  const resolvedUrl = typeof url === "string" ? new URL(url) : url;
  const returnTo = `${resolvedUrl.pathname}${resolvedUrl.search}`;

  return returnTo || "/";
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
  if (!isConfigured) {
    return isLocalDevBypass ? "allow" : "require-auth0-config";
  }

  if (isLocalDevBypass || isAuthRoute(pathname) || hasSession) {
    return "allow";
  }

  return "redirect-to-login";
}
