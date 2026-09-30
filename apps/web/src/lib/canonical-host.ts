import { resolveAuth0AppBaseUrl, type Auth0Env } from "./auth0-config.ts";

/**
 * Page requests on an alias host (the previous domain, or `www`) are sent to
 * the canonical origin with a 308. The canonical origin is APP_BASE_URL — the
 * origin sign-in is configured for — so the redirect can never send users to
 * a host where their session cookie doesn't exist.
 *
 * APIs, auth callbacks and well-known files keep working on every host: Git
 * provider webhooks and OAuth callbacks, MCP router URLs already handed to AI
 * tools, and the public catalog API may still point at the old domain.
 */

const DEFAULT_ALIAS_HOSTS = ["savantrepo.com", "www.savantrepo.com", "www.savantskills.app", "savantskills.app"];

export function canonicalHostRedirect(url: URL, forwardedHost: string | null, env: Auth0Env & { SAVANT_REDIRECT_HOSTS?: string | undefined } = process.env): string | null {
  const base = resolveAuth0AppBaseUrl(env);
  if (!base) return null;
  let canonical: URL;
  try {
    canonical = new URL(base);
  } catch {
    return null;
  }
  const requestHost = (forwardedHost ?? url.host).split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
  if (!requestHost || requestHost === canonical.hostname.toLowerCase()) return null;

  const aliases = (env.SAVANT_REDIRECT_HOSTS?.trim() ? env.SAVANT_REDIRECT_HOSTS.split(",") : DEFAULT_ALIAS_HOSTS).map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!aliases.includes(requestHost)) return null;

  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/.well-known/")) return null;
  return `${canonical.origin}${path}${url.search}`;
}
