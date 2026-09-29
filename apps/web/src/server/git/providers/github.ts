import { createPrivateKey, createSign } from "node:crypto";

import { GitProviderError } from "../errors.ts";
import { decodeCursor, encodeCursor, encodePathSegments, providerJson, providerRequest, readNextLink } from "../http.ts";
import { readGitHubAppConfig, type GitHubAppConfig } from "../provider-config.ts";
import { logGitEvent } from "../redaction.ts";
import type { Env } from "../secret-vault.ts";
import {
  createRuntimeCredential,
  type CompletedAuthorization,
  type GitProvider,
  type ProviderIdentity,
  type ProviderRepository,
  type ProviderRuntimeContext,
  type RepositoryLocator,
  type RepositoryTreeEntry,
} from "../types.ts";
import { parseGitHubRepositoryUrl } from "../url-parsing.ts";

type GitHubRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch?: string;
  html_url?: string;
  clone_url?: string;
  owner?: { login: string };
};

type GitHubInstallation = {
  id: number;
  account?: { login?: string; id?: number; type?: string } | null;
  repository_selection?: "all" | "selected";
  suspended_at?: string | null;
};

type InstallationToken = { token: string; expiresAt: number };

const INSTALLATION_TOKEN_SAFETY_MS = 5 * 60 * 1000;
const installationTokenCache = new Map<string, InstallationToken>();

export function clearGitHubInstallationTokenCache(): void {
  installationTokenCache.clear();
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Signs a short-lived GitHub App JWT (RS256). The private key never leaves the server. */
export function createGitHubAppJwt(config: Pick<GitHubAppConfig, "appId" | "privateKey">, nowMs = Date.now()): string {
  if (!config.appId || !config.privateKey) {
    throw new GitProviderError("PROVIDER_NOT_CONFIGURED", "The Savant GitHub App is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY).", {
      provider: "github",
    });
  }

  const now = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat is backdated to tolerate clock drift; GitHub caps exp at 10 minutes.
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: config.appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();

  return `${header}.${payload}.${signer.sign(config.privateKey).toString("base64url")}`;
}

function toProviderRepository(repo: GitHubRepository, host: string): ProviderRepository {
  const owner = repo.owner?.login ?? repo.full_name.split("/")[0] ?? "";
  return {
    providerRepositoryId: String(repo.id),
    provider: "github",
    host,
    owner,
    name: repo.name,
    fullName: repo.full_name,
    hierarchy: [owner],
    defaultBranch: repo.default_branch ?? null,
    webUrl: repo.html_url ?? `https://${host}/${repo.full_name}`,
    cloneUrl: repo.clone_url ?? null,
    isPrivate: repo.private,
  };
}

function githubHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

function inspectGitHubFailure(response: Response, body: string) {
  if (response.status === 403 && /not accessible by integration/i.test(body)) {
    return { insufficientScope: false };
  }

  if (response.status === 403 && /scope|permission/i.test(response.headers.get("x-accepted-oauth-scopes") ?? "") ) {
    return { insufficientScope: true };
  }

  return {};
}

function repoPath(locator: RepositoryLocator): string {
  return `/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.name)}`;
}

export type GitHubProviderOptions = {
  env?: Env | undefined;
  config?: GitHubAppConfig | undefined;
  now?: (() => number) | undefined;
};

export function createGitHubProvider(options?: GitHubProviderOptions): GitProvider {
  const env = options?.env ?? process.env;
  const config = () => options?.config ?? readGitHubAppConfig(env);
  const now = options?.now ?? Date.now;
  const webHost = () => new URL(config().webBaseUrl).host;

  /**
   * Env vars still needed. The OAuth client is required in production because
   * installation ownership is verified with it at callback time.
   */
  function missingConfiguration(): string[] {
    const cfg = config();
    const required: Array<[string, string | null]> = [
      ["GITHUB_APP_ID", cfg.appId],
      ["GITHUB_APP_SLUG", cfg.appSlug],
      ["GITHUB_APP_PRIVATE_KEY", cfg.privateKey],
    ];
    if (env.NODE_ENV === "production" && env.GITHUB_APP_ALLOW_UNVERIFIED_INSTALLATIONS !== "true") {
      required.push(["GITHUB_APP_CLIENT_ID", cfg.clientId], ["GITHUB_APP_CLIENT_SECRET", cfg.clientSecret]);
    }
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (cfg.privateKey) {
      try {
        createPrivateKey(cfg.privateKey);
      } catch {
        missing.push("GITHUB_APP_PRIVATE_KEY (not a valid PEM private key; paste the whole .pem file, including the BEGIN/END lines)");
      }
    }
    return missing;
  }

  async function mintInstallationToken(installationId: string, context?: ProviderRuntimeContext): Promise<InstallationToken> {
    const cached = installationTokenCache.get(installationId);
    if (cached && cached.expiresAt - INSTALLATION_TOKEN_SAFETY_MS > now()) {
      return cached;
    }

    const cfg = config();
    try {
      const { data } = await providerJson<{ token: string; expires_at: string }>(
        `${cfg.apiBaseUrl}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
        {
          provider: "github",
          method: "POST",
          headers: githubHeaders({ Authorization: `Bearer ${createGitHubAppJwt(cfg, now())}`, "Content-Type": "application/json" }),
          // Down-scope every installation token to read-only (INV-GIT-09).
          body: JSON.stringify({ permissions: { contents: "read", metadata: "read" } }),
          ...context,
        },
      );
      const token = { token: data.token, expiresAt: Date.parse(data.expires_at) || now() + 55 * 60 * 1000 };
      installationTokenCache.set(installationId, token);
      return token;
    } catch (error) {
      if (error instanceof GitProviderError && (error.code === "REPOSITORY_NOT_FOUND" || error.code === "TOKEN_EXPIRED" || error.code === "REPOSITORY_ACCESS_DENIED")) {
        installationTokenCache.delete(installationId);
        throw new GitProviderError(
          "TOKEN_REVOKED",
          "The Savant GitHub App installation was removed or suspended. Reinstall the app from Settings → Source control.",
          { provider: "github" },
        );
      }
      throw error;
    }
  }

  async function readInstallation(installationId: string, context?: ProviderRuntimeContext): Promise<GitHubInstallation> {
    const cfg = config();
    const { data } = await providerJson<GitHubInstallation>(
      `${cfg.apiBaseUrl}/app/installations/${encodeURIComponent(installationId)}`,
      {
        provider: "github",
        headers: githubHeaders({ Authorization: `Bearer ${createGitHubAppJwt(cfg, now())}` }),
        subject: `installation ${installationId}`,
        ...context,
      },
    );
    return data;
  }

  async function verifyInstallationOwnership(code: string, installationId: string, redirectUri: string, context?: ProviderRuntimeContext): Promise<ProviderIdentity> {
    const cfg = config();
    const { data: token } = await providerJson<{ access_token?: string; error?: string }>(`${cfg.webBaseUrl}/login/oauth/access_token`, {
      provider: "github",
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri }),
      maxRetries: 0,
      ...context,
    });

    if (!token.access_token) {
      throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "GitHub did not confirm the installation authorization. Try connecting again.", {
        provider: "github",
      });
    }

    // The user-to-server token only proves who completed the installation; it is discarded, never persisted.
    const userCredential = createRuntimeCredential({
      provider: "github",
      connectionId: null,
      organizationId: null,
      apiBaseUrl: cfg.apiBaseUrl,
      host: webHost(),
      accessToken: token.access_token,
    });
    const { data: user } = await providerJson<{ id: number; login: string; name?: string | null }>(`${cfg.apiBaseUrl}/user`, {
      provider: "github",
      credential: userCredential,
      headers: githubHeaders(),
      ...context,
    });

    let page = 1;
    for (;;) {
      const { data, response } = await providerJson<{ installations: GitHubInstallation[] }>(
        `${cfg.apiBaseUrl}/user/installations?per_page=100&page=${page}`,
        { provider: "github", credential: userCredential, headers: githubHeaders(), ...context },
      );

      if (data.installations.some((installation) => String(installation.id) === installationId)) {
        return { id: String(user.id), login: user.login, displayName: user.name || user.login };
      }

      if (!readNextLink(response) || page >= 20) {
        break;
      }
      page += 1;
    }

    throw new GitProviderError(
      "AUTHORIZATION_STATE_INVALID",
      "That GitHub App installation is not accessible to the GitHub account that completed authorization.",
      { provider: "github", status: 403 },
    );
  }

  const provider: GitProvider = {
    type: "github",
    label: "GitHub",
    hierarchy: ["Account / Organization", "Repository"],
    requestedAccess: ["Contents: Read", "Metadata: Read"],
    capabilities: {
      primaryAuth: "github_app_installation",
      supportsRefresh: false,
      supportsRevocation: false,
      supportsSelfManaged: false,
      supportsManualToken: true,
      usesPkce: false,
    },

    isConfigured() {
      return missingConfiguration().length === 0;
    },

    configurationHint() {
      const missing = missingConfiguration();
      return missing.length === 0
        ? null
        : `The Savant GitHub App is not configured on this deployment. Missing: ${missing.join(", ")}.`;
    },

    async getAuthorizationUrl(request) {
      const cfg = config();
      if (!provider.isConfigured()) {
        throw new GitProviderError("PROVIDER_NOT_CONFIGURED", provider.configurationHint() ?? "GitHub is not configured.", { provider: "github" });
      }

      const url = new URL(`${cfg.webBaseUrl}/apps/${encodeURIComponent(cfg.appSlug as string)}/installations/new`);
      url.searchParams.set("state", request.state);
      return url.toString();
    },

    async completeAuthorization(callback, exchange, context): Promise<CompletedAuthorization> {
      const installationId = callback.get("installation_id")?.trim();
      const setupAction = callback.get("setup_action");

      if (setupAction === "request") {
        throw new GitProviderError(
          "AUTH_REQUIRED",
          "The GitHub installation request was sent to an organization owner. Savant will be available after they approve it; then connect GitHub again.",
          { provider: "github", status: 202 },
        );
      }

      if (!installationId || !/^\d+$/.test(installationId)) {
        throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "GitHub did not return an installation id.", { provider: "github" });
      }

      const cfg = config();
      const code = callback.get("code");
      let identity: ProviderIdentity | null = null;

      // The installation id arrives in a query parameter, so it must be proven
      // to belong to the user; otherwise anyone could claim another tenant's installation.
      if (code && cfg.clientId && cfg.clientSecret) {
        identity = await verifyInstallationOwnership(code, installationId, exchange.redirectUri, context);
      } else if (env.NODE_ENV === "production" && env.GITHUB_APP_ALLOW_UNVERIFIED_INSTALLATIONS !== "true") {
        throw new GitProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "Enable “Request user authorization (OAuth) during installation” on the Savant GitHub App and configure GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET.",
          { provider: "github" },
        );
      } else {
        logGitEvent("warn", "github_installation_unverified", { provider: "github", reason: "oauth_client_unconfigured" });
      }

      const installation = await readInstallation(installationId, context);
      if (installation.suspended_at) {
        throw new GitProviderError("TOKEN_REVOKED", "The Savant GitHub App installation is suspended.", { provider: "github" });
      }

      const accountLogin = installation.account?.login ?? `installation-${installationId}`;

      return {
        authType: "github_app_installation",
        credential: null,
        identity: identity ?? { id: String(installation.account?.id ?? installationId), login: accountLogin, displayName: accountLogin },
        accountId: String(installation.account?.id ?? installationId),
        accountName: accountLogin,
        installationId,
        host: webHost(),
        scopes: ["contents:read", "metadata:read", `repository_selection:${installation.repository_selection ?? "selected"}`],
      };
    },

    async createRuntimeCredential(input, context) {
      const cfg = config();

      if (input.authType === "github_app_installation") {
        if (!input.installationId) {
          throw new GitProviderError("AUTH_REQUIRED", "This GitHub connection has no installation. Reconnect GitHub.", { provider: "github" });
        }

        const token = await mintInstallationToken(input.installationId, context);
        return createRuntimeCredential({
          provider: "github",
          connectionId: input.connectionId,
          organizationId: input.organizationId,
          apiBaseUrl: cfg.apiBaseUrl,
          host: webHost(),
          accessToken: token.token,
          installationId: input.installationId,
          expiresAt: new Date(token.expiresAt).toISOString(),
        });
      }

      if (!input.credential?.accessToken) {
        throw new GitProviderError("AUTH_REQUIRED", "This GitHub connection has no stored credential. Reauthorize GitHub.", { provider: "github" });
      }

      return createRuntimeCredential({
        provider: "github",
        connectionId: input.connectionId,
        organizationId: input.organizationId,
        apiBaseUrl: cfg.apiBaseUrl,
        host: webHost(),
        accessToken: input.credential.accessToken,
      });
    },

    async getIdentity(credential, context) {
      if (credential.installationId) {
        const installation = await readInstallation(credential.installationId, context);
        const login = installation.account?.login ?? `installation-${credential.installationId}`;
        return { id: String(installation.account?.id ?? credential.installationId), login, displayName: login };
      }

      const { data } = await providerJson<{ id: number; login: string; name?: string | null }>(`${credential.apiBaseUrl}/user`, {
        provider: "github",
        credential,
        headers: githubHeaders(),
        ...context,
      });
      return { id: String(data.id), login: data.login, displayName: data.name || data.login };
    },

    async listRepositories(credential, options, context) {
      const pageSize = Math.min(Math.max(options?.pageSize ?? 50, 1), 100);
      const { page } = decodeCursor(options?.cursor, { page: 1 });
      const url = credential.installationId
        ? `${credential.apiBaseUrl}/installation/repositories?per_page=${pageSize}&page=${Number(page)}`
        : `${credential.apiBaseUrl}/user/repos?per_page=${pageSize}&page=${Number(page)}&sort=full_name&affiliation=owner,collaborator,organization_member`;
      const { data, response } = await providerJson<GitHubRepository[] | { repositories: GitHubRepository[] }>(url, {
        provider: "github",
        credential,
        headers: githubHeaders(),
        ...context,
      });
      const repos = Array.isArray(data) ? data : data.repositories;
      const search = options?.search?.trim().toLowerCase();
      const items = repos
        .map((repo) => toProviderRepository(repo, credential.host))
        .filter((repo) => !search || repo.fullName.toLowerCase().includes(search));

      return { items, nextCursor: readNextLink(response) ? encodeCursor({ page: Number(page) + 1 }) : null };
    },

    async getRepository(credential, locator, context) {
      const path = locator.providerRepositoryId && /^\d+$/.test(locator.providerRepositoryId)
        ? `/repositories/${locator.providerRepositoryId}`
        : repoPath(locator);
      const { data } = await providerJson<GitHubRepository>(`${credential.apiBaseUrl}${path}`, {
        provider: "github",
        credential,
        headers: githubHeaders(),
        repositoryKnown: true,
        subject: locator.fullName,
        inspectFailure: inspectGitHubFailure,
        ...context,
      });
      return toProviderRepository(data, credential.host);
    },

    async validateRepositoryAccess(credential, locator, context) {
      try {
        const repository = await provider.getRepository(credential, locator, context);
        return { accessible: true, repository };
      } catch (error) {
        if (error instanceof GitProviderError && !error.retryable) {
          return { accessible: false, errorCode: error.code, message: error.message };
        }
        throw error;
      }
    },

    async listTree(credential, locator, revision, context) {
      const { data } = await providerJson<{ truncated: boolean; tree: Array<{ path: string; type: string; size?: number }> }>(
        `${credential.apiBaseUrl}${repoPath(locator)}/git/trees/${encodeURIComponent(revision)}?recursive=1`,
        { provider: "github", credential, headers: githubHeaders(), repositoryKnown: true, subject: locator.fullName, ...context },
      );

      if (data.truncated) {
        throw new GitProviderError(
          "INDEX_FAILED",
          `GitHub truncated the tree for ${locator.fullName}; the repository exceeds GitHub's recursive tree limit.`,
          { provider: "github", status: 413 },
        );
      }

      const entries: RepositoryTreeEntry[] = [];
      for (const entry of data.tree) {
        if (entry.type !== "blob" && entry.type !== "tree") {
          continue;
        }
        entries.push({ path: entry.path, kind: entry.type === "tree" ? "dir" : "file", ...(entry.size != null ? { size: entry.size } : {}) });
      }
      return entries;
    },

    async readFile(credential, locator, revision, path, context) {
      const { body } = await providerRequest(
        `${credential.apiBaseUrl}${repoPath(locator)}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(revision)}`,
        {
          provider: "github",
          credential,
          headers: githubHeaders({ Accept: "application/vnd.github.raw" }),
          repositoryKnown: true,
          subject: `${locator.fullName}:${path}`,
          maxBytes: context?.maxBytes,
          ...context,
        },
      );
      return body;
    },

    async getDefaultBranch(credential, locator, context) {
      const repository = await provider.getRepository(credential, locator, context);
      if (!repository.defaultBranch) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", `${locator.fullName} has no default branch (empty repository?).`, { provider: "github" });
      }
      return repository.defaultBranch;
    },

    async resolveRevision(credential, locator, ref, context) {
      const { body } = await providerRequest(`${credential.apiBaseUrl}${repoPath(locator)}/commits/${encodeURIComponent(ref)}`, {
        provider: "github",
        credential,
        headers: githubHeaders({ Accept: "application/vnd.github.sha" }),
        repositoryKnown: true,
        subject: `${locator.fullName}@${ref}`,
        ...context,
      });
      const sha = body.toString("utf8").trim();
      if (!/^[0-9a-f]{40}$/i.test(sha)) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", `GitHub could not resolve '${ref}' in ${locator.fullName}.`, { provider: "github" });
      }
      return sha;
    },

    parseRepositoryUrl(url) {
      return parseGitHubRepositoryUrl(url, webHost());
    },

    async inspectTokenPrivileges(credential, context) {
      const { response } = await providerJson<unknown>(`${credential.apiBaseUrl}/user`, {
        provider: "github",
        credential,
        headers: githubHeaders(),
        ...context,
      });
      const scopes = (response.headers.get("x-oauth-scopes") ?? "").split(",").map((scope) => scope.trim()).filter(Boolean);
      const warnings: string[] = [];

      if (scopes.includes("repo") || scopes.some((scope) => scope.startsWith("write:") || scope.startsWith("admin:") || scope === "delete_repo")) {
        warnings.push(
          `This classic token grants write or admin scopes (${scopes.join(", ")}). Savant only needs read access; prefer a fine-grained token with Contents: Read and Metadata: Read.`,
        );
      }

      return warnings;
    },
  };

  return provider;
}
