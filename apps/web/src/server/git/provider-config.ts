import { GitProviderError } from "./errors.ts";
import type { Env } from "./secret-vault.ts";
import type { GitProviderType } from "./types.ts";

/**
 * Platform-level provider configuration. These are infrastructure secrets
 * (GitHub App private key, OAuth client secrets), not tenant data; they come
 * from the deployment secret store, never the database.
 */

function readValue(env: Env, key: string): string | null {
  const value = env[key]?.trim();

  if (!value || value.startsWith("<") || value.includes("REPLACE") || value.startsWith("placeholder-")) {
    return null;
  }

  return value;
}

export type GitHubAppConfig = {
  appId: string | null;
  appSlug: string | null;
  privateKey: string | null;
  clientId: string | null;
  clientSecret: string | null;
  webBaseUrl: string;
  apiBaseUrl: string;
};

export type OAuthClientConfig = {
  clientId: string | null;
  clientSecret: string | null;
  scopes: string[];
};

export type AzureEntraConfig = OAuthClientConfig & {
  tenant: string;
};

export function readGitHubAppConfig(env: Env = process.env): GitHubAppConfig {
  const privateKey = readValue(env, "GITHUB_APP_PRIVATE_KEY");

  return {
    appId: readValue(env, "GITHUB_APP_ID"),
    appSlug: readValue(env, "GITHUB_APP_SLUG"),
    // Deployment env stores often flatten PEM newlines into literal "\n".
    privateKey: privateKey ? privateKey.replace(/\\n/g, "\n") : null,
    clientId: readValue(env, "GITHUB_APP_CLIENT_ID"),
    clientSecret: readValue(env, "GITHUB_APP_CLIENT_SECRET"),
    webBaseUrl: (readValue(env, "GITHUB_WEB_BASE_URL") ?? "https://github.com").replace(/\/+$/, ""),
    apiBaseUrl: (readValue(env, "GITHUB_API_BASE_URL") ?? "https://api.github.com").replace(/\/+$/, ""),
  };
}

function readScopes(env: Env, key: string, fallback: string[]): string[] {
  const configured = readValue(env, key);
  return configured ? configured.split(/[\s,]+/).filter(Boolean) : fallback;
}

/**
 * GitLab: `read_repository` covers repository content; project discovery needs
 * the read-only `read_api` scope, and `read_user` identifies the account. No
 * write scope (`api`, `write_repository`) is ever requested.
 */
export function readGitLabOAuthConfig(env: Env = process.env): OAuthClientConfig {
  return {
    clientId: readValue(env, "GITLAB_OAUTH_CLIENT_ID"),
    clientSecret: readValue(env, "GITLAB_OAUTH_CLIENT_SECRET"),
    scopes: readScopes(env, "GITLAB_OAUTH_SCOPES", ["read_repository", "read_api", "read_user"]),
  };
}

/**
 * Bitbucket Cloud OAuth consumers declare their permissions on the consumer
 * itself; Savant's consumer must be created with only Account: Read and
 * Repositories: Read (`account`, `repository`).
 */
export function readBitbucketOAuthConfig(env: Env = process.env): OAuthClientConfig {
  return {
    clientId: readValue(env, "BITBUCKET_OAUTH_CLIENT_ID"),
    clientSecret: readValue(env, "BITBUCKET_OAUTH_CLIENT_SECRET"),
    scopes: readScopes(env, "BITBUCKET_OAUTH_SCOPES", ["repository", "account"]),
  };
}

/** The Azure DevOps resource application id documented by Microsoft. */
export const AZURE_DEVOPS_RESOURCE_ID = "499b84ac-1321-427f-aa17-267ca6975798";

export function readAzureEntraConfig(env: Env = process.env): AzureEntraConfig {
  return {
    clientId: readValue(env, "AZURE_DEVOPS_ENTRA_CLIENT_ID"),
    clientSecret: readValue(env, "AZURE_DEVOPS_ENTRA_CLIENT_SECRET"),
    tenant: readValue(env, "AZURE_DEVOPS_ENTRA_TENANT") ?? "organizations",
    scopes: readScopes(env, "AZURE_DEVOPS_ENTRA_SCOPES", [
      `${AZURE_DEVOPS_RESOURCE_ID}/vso.code`,
      "offline_access",
      "openid",
      "profile",
    ]),
  };
}

/**
 * The exact redirect URI registered with each provider. It is derived from
 * configuration only — never from request headers — so a spoofed Host cannot
 * redirect authorization codes elsewhere.
 */
export function resolveGitOAuthRedirectUri(provider: GitProviderType, env: Env = process.env): string {
  const base = readValue(env, "GIT_OAUTH_REDIRECT_BASE_URL")
    ?? readValue(env, "APP_BASE_URL")
    ?? readValue(env, "NEXT_PUBLIC_APP_URL");

  if (!base) {
    throw new GitProviderError(
      "PROVIDER_NOT_CONFIGURED",
      "APP_BASE_URL (or GIT_OAUTH_REDIRECT_BASE_URL) must be configured before Git providers can be authorized.",
    );
  }

  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    throw new GitProviderError("PROVIDER_NOT_CONFIGURED", "The configured Git OAuth redirect base URL is invalid.");
  }

  if (origin.protocol !== "https:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") {
    throw new GitProviderError("PROVIDER_NOT_CONFIGURED", "Git OAuth redirect URIs must use HTTPS outside local development.");
  }

  return `${origin.origin}/api/git/connections/${provider}/callback`;
}
