import {
  isConfiguredAuth0Value,
  isLocalDevHostname,
  resolveAuth0AppBaseUrl,
  type Auth0Env,
} from "./auth0-config.ts";

export type WorkspaceUrlEnv = Auth0Env;

export const CANONICAL_WORKSPACE_ORIGIN = "https://savantrepo.com";

function normalizeOriginCandidate(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (
    trimmed.startsWith("localhost")
    || trimmed.startsWith("127.")
    || trimmed.startsWith("0.0.0.0")
    || trimmed.startsWith("[::1]")
  ) {
    return `http://${trimmed}`;
  }

  return `https://${trimmed}`;
}

function readConfiguredEnvValue(env: WorkspaceUrlEnv, key: string): string | null {
  const value = env[key];

  if (typeof value !== "string") {
    return null;
  }

  if (!isConfiguredAuth0Value(value)) {
    return null;
  }

  return value.trim();
}

function isNonLocalOrigin(candidate: string): boolean {
  try {
    return !isLocalDevHostname(new URL(candidate).hostname);
  } catch {
    return true;
  }
}

export function resolveCanonicalWorkspaceOrigin(env: WorkspaceUrlEnv = process.env): string {
  const productionUrl = readConfiguredEnvValue(env, "VERCEL_PROJECT_PRODUCTION_URL");
  if (productionUrl) {
    return normalizeOriginCandidate(productionUrl);
  }

  const publicUrl = readConfiguredEnvValue(env, "NEXT_PUBLIC_APP_URL")
    ?? readConfiguredEnvValue(env, "NEXT_PUBLIC_SITE_URL");
  if (publicUrl) {
    const normalizedPublicUrl = normalizeOriginCandidate(publicUrl);
    if (isNonLocalOrigin(normalizedPublicUrl)) {
      return normalizedPublicUrl;
    }
  }

  const appBaseUrl = resolveAuth0AppBaseUrl(env);
  if (appBaseUrl && isNonLocalOrigin(appBaseUrl)) {
    return appBaseUrl;
  }

  return CANONICAL_WORKSPACE_ORIGIN;
}

export function buildWorkspacePath(workspaceSlug: string): string {
  return `/o/${encodeURIComponent(workspaceSlug.trim())}`;
}

export function buildWorkspaceUrl(
  workspaceSlug: string,
  env: WorkspaceUrlEnv = process.env,
): string {
  return `${resolveCanonicalWorkspaceOrigin(env)}${buildWorkspacePath(workspaceSlug)}`;
}

export function formatWorkspaceUrlForDisplay(
  workspaceSlug: string,
  env: WorkspaceUrlEnv = process.env,
): string {
  return buildWorkspaceUrl(workspaceSlug, env).replace(/^https?:\/\//i, "");
}

export function formatWorkspaceUrlPrefixForDisplay(env: WorkspaceUrlEnv = process.env): string {
  return `${resolveCanonicalWorkspaceOrigin(env).replace(/^https?:\/\//i, "")}/o/`;
}
