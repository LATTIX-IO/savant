import { GitProviderError } from "../errors.ts";
import { validateProviderBaseUrl, type HostResolver } from "../host-validation.ts";
import { decodeCursor, encodeCursor, providerJson, providerRequest, readNextLink } from "../http.ts";
import { readGitLabOAuthConfig, type OAuthClientConfig } from "../provider-config.ts";
import type { Env } from "../secret-vault.ts";
import {
  createRuntimeCredential,
  type CompletedAuthorization,
  type GitConnectionAuthType,
  type GitProvider,
  type ProviderCredential,
  type ProviderIdentity,
  type ProviderRepository,
  type ProviderRuntimeContext,
  type RepositoryLocator,
  type RepositoryTreeEntry,
  type RuntimeCredential,
} from "../types.ts";
import { parseGitLabRepositoryUrl } from "../url-parsing.ts";

/**
 * GitLab adapter covering GitLab.com and GitLab Self-Managed. Every repository
 * operation is addressed through the credential's API base (derived from the
 * connection host), so nothing below hard-codes gitlab.com except the default
 * host for new GitLab.com connections.
 */

export const GITLAB_DOT_COM_HOST = "gitlab.com";

type GitLabNamespace = { id?: number; full_path: string; kind?: string };

type GitLabProject = {
  id: number;
  path: string;
  name?: string;
  path_with_namespace: string;
  namespace?: GitLabNamespace | null;
  default_branch?: string | null;
  web_url?: string | null;
  http_url_to_repo?: string | null;
  visibility?: string | null;
};

type GitLabUser = { id: number; username: string; name?: string | null };

type GitLabGroup = { id: number; full_path: string; name?: string | null; full_name?: string | null };

type GitLabTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  created_at?: number;
};

type GitLabTreeEntry = { path: string; type: string; name?: string };

/** Scopes that grant more than the read access Savant needs. */
const PRIVILEGED_GITLAB_SCOPES = ["api", "write_repository", "sudo", "admin_mode"];

const OAUTH_TOKEN_AUTH_TYPES = new Set<GitConnectionAuthType>(["oauth", "pat", "access_token", "legacy_env"]);

const MAX_TREE_PAGES = 1_000;

export type GitLabProviderOptions = {
  env?: Env | undefined;
  config?: OAuthClientConfig | undefined;
  now?: (() => number) | undefined;
  /** DNS resolver used by the SSRF guard for self-managed hosts (test hook). */
  resolveHost?: HostResolver | undefined;
};

type GitLabEndpoint = { host: string; webBaseUrl: string; apiBaseUrl: string; isDotCom: boolean };

function normalizeHostInput(host: string | null | undefined): string {
  const trimmed = (host ?? "").trim().toLowerCase();
  if (!trimmed) {
    return GITLAB_DOT_COM_HOST;
  }
  // Accept either a bare host or an origin; compare on the host only.
  return trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function isGitLabDotComHost(host: string | null | undefined): boolean {
  const normalized = normalizeHostInput(host);
  return normalized === GITLAB_DOT_COM_HOST || normalized === `www.${GITLAB_DOT_COM_HOST}`;
}

function runtime(context: ProviderRuntimeContext | undefined): ProviderRuntimeContext {
  return { fetcher: context?.fetcher, signal: context?.signal };
}

/** GitLab project addressing: numeric id when known, else the URL-encoded full path. */
export function gitLabProjectRef(locator: Pick<RepositoryLocator, "providerRepositoryId" | "fullName">): string {
  return locator.providerRepositoryId && /^\d+$/.test(locator.providerRepositoryId)
    ? locator.providerRepositoryId
    : encodeURIComponent(locator.fullName);
}

function toProviderRepository(project: GitLabProject, host: string): ProviderRepository {
  const namespacePath = project.namespace?.full_path
    ?? project.path_with_namespace.split("/").slice(0, -1).join("/");
  return {
    providerRepositoryId: String(project.id),
    provider: "gitlab",
    host,
    owner: namespacePath,
    namespace: namespacePath,
    name: project.path,
    fullName: project.path_with_namespace,
    hierarchy: namespacePath.split("/").filter(Boolean),
    defaultBranch: project.default_branch ?? null,
    webUrl: project.web_url ?? null,
    cloneUrl: project.http_url_to_repo ?? null,
    isPrivate: project.visibility !== "public",
  };
}

function parseScopes(scope: string | undefined, fallback: string[]): string[] {
  const scopes = (scope ?? "").split(/[\s,]+/).filter(Boolean);
  return scopes.length > 0 ? scopes : fallback;
}

function readNextPage(response: Response): number | null {
  const header = response.headers.get("x-next-page")?.trim();
  if (header && /^\d+$/.test(header)) {
    return Number(header);
  }
  return null;
}

function formHeaders(): Record<string, string> {
  return { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
}

export function createGitLabProvider(options?: GitLabProviderOptions): GitProvider {
  const env = options?.env ?? process.env;
  const config = () => options?.config ?? readGitLabOAuthConfig(env);
  const now = options?.now ?? Date.now;

  /**
   * Resolves the web/API bases for a host. Self-managed hosts pass the SSRF
   * guard before Savant sends anything (codes, client secrets, tokens) there.
   */
  async function resolveEndpoint(host: string | null | undefined): Promise<GitLabEndpoint> {
    if (isGitLabDotComHost(host)) {
      return {
        host: GITLAB_DOT_COM_HOST,
        webBaseUrl: `https://${GITLAB_DOT_COM_HOST}`,
        apiBaseUrl: `https://${GITLAB_DOT_COM_HOST}/api/v4`,
        isDotCom: true,
      };
    }

    const validated = await validateProviderBaseUrl(normalizeHostInput(host), { env, resolve: options?.resolveHost });
    return {
      host: validated.host,
      webBaseUrl: validated.baseUrl,
      apiBaseUrl: `${validated.baseUrl}/api/v4`,
      isDotCom: false,
    };
  }

  function clientFor(
    endpoint: GitLabEndpoint,
    supplied: { clientId?: string | undefined; clientSecret?: string | undefined },
    requireSecret: boolean,
  ): { clientId: string; clientSecret: string | null } {
    const cfg = config();
    const clientId = endpoint.isDotCom ? supplied.clientId ?? cfg.clientId : supplied.clientId;
    const clientSecret = endpoint.isDotCom ? supplied.clientSecret ?? cfg.clientSecret : supplied.clientSecret;

    if (!clientId || (requireSecret && !clientSecret)) {
      throw new GitProviderError(
        "PROVIDER_NOT_CONFIGURED",
        endpoint.isDotCom
          ? "The Savant GitLab.com OAuth application is not configured (GITLAB_OAUTH_CLIENT_ID / GITLAB_OAUTH_CLIENT_SECRET)."
          : `No OAuth application is registered for the GitLab instance ${endpoint.host}. Provide the instance OAuth application's client id and secret.`,
        { provider: "gitlab" },
      );
    }

    return { clientId, clientSecret: clientSecret ?? null };
  }

  function computeExpiresAt(token: GitLabTokenResponse): string | undefined {
    if (typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in)) {
      return undefined;
    }
    const issuedMs = typeof token.created_at === "number" && Number.isFinite(token.created_at) ? token.created_at * 1000 : now();
    return new Date(issuedMs + token.expires_in * 1000).toISOString();
  }

  async function fetchUser(apiBaseUrl: string, credential: RuntimeCredential, context?: ProviderRuntimeContext): Promise<GitLabUser> {
    const { data } = await providerJson<GitLabUser>(`${apiBaseUrl}/user`, {
      provider: "gitlab",
      credential,
      ...runtime(context),
    });
    return data;
  }

  function toIdentity(user: GitLabUser): ProviderIdentity {
    return { id: String(user.id), login: user.username, displayName: user.name || user.username };
  }

  function projectPath(credential: RuntimeCredential, locator: RepositoryLocator): string {
    return `${credential.apiBaseUrl}/projects/${gitLabProjectRef(locator)}`;
  }

  const provider: GitProvider = {
    type: "gitlab",
    label: "GitLab",
    hierarchy: ["Group", "Subgroup", "Repository"],
    get requestedAccess() {
      return [...config().scopes];
    },
    capabilities: {
      primaryAuth: "oauth",
      supportsRefresh: true,
      supportsRevocation: true,
      supportsSelfManaged: true,
      supportsManualToken: true,
      usesPkce: true,
    },

    isConfigured() {
      const cfg = config();
      return Boolean(cfg.clientId && cfg.clientSecret);
    },

    configurationHint() {
      return provider.isConfigured()
        ? null
        : "Set GITLAB_OAUTH_CLIENT_ID and GITLAB_OAUTH_CLIENT_SECRET for the Savant GitLab.com OAuth application. Self-managed GitLab instances can be connected with an OAuth application registered on that instance.";
    },

    async getAuthorizationUrl(request) {
      const endpoint = await resolveEndpoint(request.host);
      const { clientId } = clientFor(endpoint, { clientId: request.clientId }, false);

      if (!request.codeChallenge) {
        throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "GitLab authorization requires a PKCE code challenge.", {
          provider: "gitlab",
        });
      }

      const url = new URL(`${endpoint.webBaseUrl}/oauth/authorize`);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", request.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", request.state);
      url.searchParams.set("scope", config().scopes.join(" "));
      url.searchParams.set("code_challenge", request.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async completeAuthorization(callback, exchange, context): Promise<CompletedAuthorization> {
      const callbackError = callback.get("error");
      if (callbackError) {
        const description = callback.get("error_description");
        throw new GitProviderError(
          "AUTH_REQUIRED",
          callbackError === "access_denied"
            ? "GitLab authorization was declined. Connect GitLab again and approve read access."
            : `GitLab did not authorize Savant (${callbackError}${description ? `: ${description}` : ""}). Try connecting again.`,
          { provider: "gitlab" },
        );
      }

      const code = callback.get("code")?.trim();
      if (!code) {
        throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "GitLab did not return an authorization code.", { provider: "gitlab" });
      }

      const endpoint = await resolveEndpoint(exchange.host);
      const client = clientFor(endpoint, { clientId: exchange.clientId, clientSecret: exchange.clientSecret }, true);

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: exchange.redirectUri,
        client_id: client.clientId,
        client_secret: client.clientSecret ?? "",
      });
      if (exchange.codeVerifier) {
        body.set("code_verifier", exchange.codeVerifier);
      }

      const { data: token } = await providerJson<GitLabTokenResponse>(`${endpoint.webBaseUrl}/oauth/token`, {
        provider: "gitlab",
        method: "POST",
        headers: formHeaders(),
        body,
        // Authorization codes are single-use; never replay the exchange.
        maxRetries: 0,
        ...runtime(context),
      });

      if (!token.access_token) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "GitLab did not return an access token.", { provider: "gitlab" });
      }

      const scopes = parseScopes(token.scope, config().scopes);
      const runtimeCredential = createRuntimeCredential({
        provider: "gitlab",
        connectionId: null,
        organizationId: null,
        apiBaseUrl: endpoint.apiBaseUrl,
        host: endpoint.host,
        accessToken: token.access_token,
      });
      const user = await fetchUser(endpoint.apiBaseUrl, runtimeCredential, context);
      const expiresAt = computeExpiresAt(token);

      const credential: ProviderCredential = {
        accessToken: token.access_token,
        ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        tokenType: token.token_type ?? "bearer",
        scopes,
        // Self-managed instances bring their own OAuth application; persist it
        // (encrypted with the credential) so refresh and revocation work.
        ...(!endpoint.isDotCom ? { clientId: client.clientId, ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}) } : {}),
      };

      return {
        authType: "oauth",
        credential,
        identity: toIdentity(user),
        accountId: String(user.id),
        accountName: user.username,
        host: endpoint.host,
        scopes,
      };
    },

    async refreshCredential(credential, context) {
      if (!credential.refreshToken) {
        throw new GitProviderError("TOKEN_EXPIRED", "This GitLab connection has no refresh token. Reauthorize GitLab.", { provider: "gitlab" });
      }

      const endpoint = await resolveEndpoint(context?.host);
      const client = clientFor(endpoint, { clientId: credential.clientId, clientSecret: credential.clientSecret }, true);
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credential.refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret ?? "",
      });

      const { data: token } = await providerJson<GitLabTokenResponse>(`${endpoint.webBaseUrl}/oauth/token`, {
        provider: "gitlab",
        method: "POST",
        headers: formHeaders(),
        body,
        // GitLab rotates refresh tokens on use; a replayed refresh would be rejected.
        maxRetries: 0,
        ...runtime(context),
      });

      if (!token.access_token) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "GitLab did not return a refreshed access token.", { provider: "gitlab" });
      }

      const expiresAt = computeExpiresAt(token);
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? credential.refreshToken,
        ...(expiresAt ? { expiresAt } : {}),
        tokenType: token.token_type ?? credential.tokenType ?? "bearer",
        scopes: parseScopes(token.scope, credential.scopes ?? config().scopes),
        ...(credential.clientId ? { clientId: credential.clientId } : {}),
        ...(credential.clientSecret ? { clientSecret: credential.clientSecret } : {}),
      };
    },

    async revokeCredential(credential, context) {
      const token = credential.accessToken ?? credential.refreshToken;
      if (!token) {
        return;
      }

      const endpoint = await resolveEndpoint(context?.host);
      let client: { clientId: string; clientSecret: string | null };
      try {
        client = clientFor(endpoint, { clientId: credential.clientId, clientSecret: credential.clientSecret }, false);
      } catch {
        // Nothing to revoke against without a client; the local credential is still discarded.
        return;
      }

      const body = new URLSearchParams({ token, client_id: client.clientId });
      if (client.clientSecret) {
        body.set("client_secret", client.clientSecret);
      }

      try {
        await providerRequest(`${endpoint.webBaseUrl}/oauth/revoke`, {
          provider: "gitlab",
          method: "POST",
          headers: formHeaders(),
          body,
          maxRetries: 1,
          ...runtime(context),
        });
      } catch (error) {
        // Best effort: a 4xx means the token is already invalid or unknown.
        // Network failures and 5xx (PROVIDER_UNAVAILABLE) still surface.
        if (error instanceof GitProviderError && error.code !== "PROVIDER_UNAVAILABLE") {
          return;
        }
        throw error;
      }
    },

    async createRuntimeCredential(input) {
      if (!OAUTH_TOKEN_AUTH_TYPES.has(input.authType)) {
        throw new GitProviderError("AUTH_REQUIRED", `GitLab connections do not support '${input.authType}' authorization. Reconnect GitLab.`, {
          provider: "gitlab",
        });
      }

      if (!input.credential?.accessToken) {
        throw new GitProviderError("AUTH_REQUIRED", "This GitLab connection has no stored credential. Reauthorize GitLab.", { provider: "gitlab" });
      }

      const endpoint = await resolveEndpoint(input.host);
      return createRuntimeCredential({
        provider: "gitlab",
        connectionId: input.connectionId,
        organizationId: input.organizationId,
        apiBaseUrl: endpoint.apiBaseUrl,
        host: endpoint.host,
        scheme: "bearer",
        accessToken: input.credential.accessToken,
        ...(input.credential.expiresAt ? { expiresAt: input.credential.expiresAt } : {}),
      });
    },

    async getIdentity(credential, context) {
      return toIdentity(await fetchUser(credential.apiBaseUrl, credential, context));
    },

    async listAccounts(credential, context) {
      const { data } = await providerJson<GitLabGroup[]>(`${credential.apiBaseUrl}/groups?min_access_level=10&per_page=100`, {
        provider: "gitlab",
        credential,
        ...runtime(context),
      });
      return data.map((group) => ({ id: String(group.id), name: group.full_path, kind: "group" as const }));
    },

    async listRepositories(credential, listOptions, context) {
      const pageSize = Math.min(Math.max(Math.floor(listOptions?.pageSize ?? 50), 1), 100);
      const { page } = decodeCursor(listOptions?.cursor, { page: 1 });
      const pageNumber = Number(page);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "The repository page cursor is invalid.", { status: 400 });
      }

      const url = new URL(`${credential.apiBaseUrl}/projects`);
      url.searchParams.set("membership", "true");
      url.searchParams.set("simple", "true");
      url.searchParams.set("per_page", String(pageSize));
      url.searchParams.set("page", String(pageNumber));
      url.searchParams.set("order_by", "path");
      url.searchParams.set("sort", "asc");
      const search = listOptions?.search?.trim();
      if (search) {
        url.searchParams.set("search", search);
      }

      const { data, response } = await providerJson<GitLabProject[]>(url.toString(), {
        provider: "gitlab",
        credential,
        ...runtime(context),
      });

      const nextPage = readNextPage(response) ?? (readNextLink(response) ? pageNumber + 1 : null);
      return {
        items: data.map((project) => toProviderRepository(project, credential.host)),
        // Cursors only ever carry a page number, never a provider URL.
        nextCursor: nextPage ? encodeCursor({ page: nextPage }) : null,
      };
    },

    async getRepository(credential, locator, context) {
      const { data } = await providerJson<GitLabProject>(projectPath(credential, locator), {
        provider: "gitlab",
        credential,
        repositoryKnown: true,
        subject: locator.fullName,
        ...runtime(context),
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
      const maxEntries = context?.maxEntries;
      const maxDepth = context?.maxDepth;
      const apiOrigin = new URL(credential.apiBaseUrl).origin;
      const first = new URL(`${projectPath(credential, locator)}/repository/tree`);
      first.searchParams.set("recursive", "true");
      first.searchParams.set("ref", revision);
      first.searchParams.set("per_page", "100");
      first.searchParams.set("pagination", "keyset");

      const entries: RepositoryTreeEntry[] = [];
      let url: string | null = first.toString();

      for (let pageCount = 0; url && pageCount < MAX_TREE_PAGES; pageCount += 1) {
        const { data, response }: { data: GitLabTreeEntry[]; response: Response } = await providerJson<GitLabTreeEntry[]>(url, {
          provider: "gitlab",
          credential,
          repositoryKnown: true,
          subject: `${locator.fullName}@${revision}`,
          ...runtime(context),
        });

        for (const entry of data) {
          if (entry.type !== "blob" && entry.type !== "tree") {
            continue;
          }
          if (maxDepth != null && entry.path.split("/").filter(Boolean).length > maxDepth) {
            continue;
          }
          entries.push({ path: entry.path, kind: entry.type === "tree" ? "dir" : "file" });
          if (maxEntries != null && entries.length > maxEntries) {
            throw new GitProviderError(
              "INDEX_FAILED",
              `${locator.fullName} has more than ${maxEntries} tree entries; the repository exceeds Savant's indexing limit.`,
              { provider: "gitlab", status: 413 },
            );
          }
        }

        const nextLink = readNextLink(response);
        if (nextLink) {
          // Only follow pagination links back to the same GitLab API origin.
          const next = new URL(nextLink, credential.apiBaseUrl);
          if (next.origin !== apiOrigin) {
            throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "GitLab returned a pagination link to an unexpected host.", {
              provider: "gitlab",
            });
          }
          url = next.toString();
          continue;
        }

        const nextPage = readNextPage(response);
        if (nextPage) {
          const next = new URL(first);
          next.searchParams.delete("pagination");
          next.searchParams.set("page", String(nextPage));
          url = next.toString();
          continue;
        }

        url = null;
      }

      return entries;
    },

    async readFile(credential, locator, revision, path, context) {
      const { body } = await providerRequest(
        `${projectPath(credential, locator)}/repository/files/${encodeURIComponent(path.replace(/^\/+/, ""))}/raw?ref=${encodeURIComponent(revision)}`,
        {
          provider: "gitlab",
          credential,
          repositoryKnown: true,
          subject: `${locator.fullName}:${path}`,
          maxBytes: context?.maxBytes,
          ...runtime(context),
        },
      );
      return body;
    },

    async getDefaultBranch(credential, locator, context) {
      const repository = await provider.getRepository(credential, locator, context);
      if (!repository.defaultBranch) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", `${locator.fullName} has no default branch (empty repository?).`, { provider: "gitlab" });
      }
      return repository.defaultBranch;
    },

    async resolveRevision(credential, locator, ref, context) {
      const { data } = await providerJson<{ id?: string }>(
        `${projectPath(credential, locator)}/repository/commits/${encodeURIComponent(ref)}`,
        {
          provider: "gitlab",
          credential,
          repositoryKnown: true,
          subject: `${locator.fullName}@${ref}`,
          ...runtime(context),
        },
      );
      const sha = (data.id ?? "").trim();
      if (!/^[0-9a-f]{40}$/i.test(sha)) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", `GitLab could not resolve '${ref}' in ${locator.fullName}.`, { provider: "gitlab" });
      }
      return sha.toLowerCase();
    },

    parseRepositoryUrl(url, host) {
      return parseGitLabRepositoryUrl(url, host ?? GITLAB_DOT_COM_HOST);
    },

    async inspectTokenPrivileges(credential, context) {
      let scopes: string[];
      try {
        const { data } = await providerJson<{ scopes?: string[] }>(`${credential.apiBaseUrl}/personal_access_tokens/self`, {
          provider: "gitlab",
          credential,
          ...runtime(context),
        });
        scopes = Array.isArray(data.scopes) ? data.scopes : [];
      } catch (error) {
        // OAuth tokens cannot introspect themselves through this endpoint.
        if (
          error instanceof GitProviderError
          && ["TOKEN_EXPIRED", "AUTH_REQUIRED", "REPOSITORY_NOT_FOUND", "REPOSITORY_ACCESS_DENIED"].includes(error.code)
        ) {
          return [];
        }
        throw error;
      }

      const privileged = scopes.filter((scope) => PRIVILEGED_GITLAB_SCOPES.includes(scope));
      if (privileged.length === 0) {
        return [];
      }

      return [
        `This GitLab token grants write or admin scopes (${privileged.join(", ")}). Savant only needs read access; prefer a token limited to read_api and read_repository.`,
      ];
    },
  };

  return provider;
}
