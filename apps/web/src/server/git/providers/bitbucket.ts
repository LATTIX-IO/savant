import { GitProviderError } from "../errors.ts";
import { decodeCursor, encodeCursor, encodePathSegments, providerJson, providerRequest } from "../http.ts";
import { readBitbucketOAuthConfig, type OAuthClientConfig } from "../provider-config.ts";
import type { Env } from "../secret-vault.ts";
import {
  createRuntimeCredential,
  type CompletedAuthorization,
  type GitProvider,
  type ProviderAccount,
  type ProviderCredential,
  type ProviderIdentity,
  type ProviderRepository,
  type ProviderRuntimeContext,
  type RepositoryLocator,
  type RepositoryTreeEntry,
  type RuntimeCredential,
} from "../types.ts";
import { parseBitbucketRepositoryUrl } from "../url-parsing.ts";

/**
 * Bitbucket Cloud adapter (OAuth 2.0 authorization code grant).
 *
 * Note: Atlassian removed the cross-workspace listing endpoints
 * (`GET /2.0/repositories`, `GET /2.0/workspaces`, cross-workspace
 * `GET /2.0/user/permissions/workspaces`) under CHANGE-2770. Repository
 * discovery therefore iterates the user's workspaces and uses the
 * workspace-scoped `GET /2.0/repositories/{workspace}?role=member` listing.
 */

export const BITBUCKET_WEB_BASE_URL = "https://bitbucket.org";
export const BITBUCKET_API_BASE_URL = "https://api.bitbucket.org/2.0";
export const BITBUCKET_HOST = "bitbucket.org";

const AUTHORIZE_URL = `${BITBUCKET_WEB_BASE_URL}/site/oauth2/authorize`;
const TOKEN_URL = `${BITBUCKET_WEB_BASE_URL}/site/oauth2/access_token`;

const MAX_WORKSPACE_PAGES = 20;
const MAX_EMPTY_WORKSPACE_SKIPS = 10;
const MAX_TREE_PAGES = 1_000;
const DEFAULT_TREE_DEPTH = 32;
const DEFAULT_TREE_MAX_ENTRIES = 50_000;

/** Scopes that grant more than read access; Savant only needs Account: Read and Repositories: Read. */
const PRIVILEGED_SCOPE_PATTERN = /^(repository:(write|admin|delete)|pullrequest:write|project:(write|admin)|workspace:(write|admin)|team:write|account:write|webhook|pipeline:(write|variable)|runner:write|snippet:write|issue:write|wiki)$/;

type BitbucketLink = { href?: string; name?: string };

type BitbucketWorkspace = { slug: string; name?: string; uuid?: string };

type BitbucketRepository = {
  uuid: string;
  slug?: string;
  name?: string;
  full_name: string;
  is_private?: boolean;
  mainbranch?: { name?: string } | null;
  workspace?: { slug?: string; name?: string; uuid?: string } | null;
  project?: { key?: string; name?: string } | null;
  links?: { html?: BitbucketLink; clone?: BitbucketLink[] } | null;
};

type BitbucketPage<T> = {
  values?: T[];
  page?: number;
  pagelen?: number;
  size?: number;
  next?: string;
};

type BitbucketTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scopes?: string;
  token_type?: string;
};

type BitbucketUser = {
  uuid?: string;
  account_id?: string;
  username?: string;
  nickname?: string;
  display_name?: string;
};

type BitbucketSrcEntry = {
  type?: string;
  path?: string;
  size?: number;
};

function parseScopes(value: string | null | undefined): string[] {
  return (value ?? "").split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
}

function toIdentity(user: BitbucketUser): ProviderIdentity {
  const id = user.uuid ?? user.account_id ?? "";
  const login = user.username ?? user.nickname ?? user.display_name ?? id;
  const attributes: Record<string, string> = {};
  if (user.account_id) {
    attributes.accountId = user.account_id;
  }
  if (user.uuid) {
    attributes.uuid = user.uuid;
  }
  return {
    id,
    login,
    displayName: user.display_name || login,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
}

function toProviderRepository(repo: BitbucketRepository): ProviderRepository {
  const [fullOwner, fullSlug] = repo.full_name.split("/");
  const owner = repo.workspace?.slug ?? fullOwner ?? "";
  const name = repo.slug ?? fullSlug ?? repo.name ?? "";
  const projectKey = repo.project?.key;
  const projectLabel = repo.project?.name ?? projectKey;
  const clone = repo.links?.clone?.find((link) => link.name === "https" && link.href)?.href ?? null;

  return {
    providerRepositoryId: repo.uuid,
    provider: "bitbucket",
    host: BITBUCKET_HOST,
    owner,
    ...(projectKey ? { project: projectKey } : {}),
    name,
    fullName: repo.full_name,
    hierarchy: projectLabel ? [owner, projectLabel] : [owner],
    defaultBranch: repo.mainbranch?.name ?? null,
    webUrl: repo.links?.html?.href ?? `${BITBUCKET_WEB_BASE_URL}/${repo.full_name}`,
    cloneUrl: clone,
    isPrivate: repo.is_private ?? true,
  };
}

function isBraceUuid(value: string | undefined): value is string {
  return Boolean(value && /^\{[0-9a-f-]{36}\}$/i.test(value));
}

function repoPath(locator: RepositoryLocator): string {
  // Bitbucket accepts either the slug or the `{uuid}` in the repo position.
  const repo = locator.name || (isBraceUuid(locator.providerRepositoryId) ? locator.providerRepositoryId : "");
  return `/repositories/${encodeURIComponent(locator.owner)}/${encodeURIComponent(repo)}`;
}

/** Escapes a value for use inside a double-quoted Bitbucket query-language string. */
export function escapeBitbucketQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Only pagination links that stay on the Bitbucket API origin and under the
 * API base path are followed; anything else is treated as a malformed
 * response rather than a URL to fetch (prevents SSRF via response bodies).
 */
function assertTrustedNextUrl(next: string, apiBaseUrl: string): string {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(next);
    base = new URL(apiBaseUrl);
  } catch {
    throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "Bitbucket returned an invalid pagination link.", { provider: "bitbucket" });
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  if (parsed.origin !== base.origin || parsed.username || parsed.password || !parsed.pathname.startsWith(`${basePath}/`)) {
    throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "Bitbucket returned a pagination link outside the Bitbucket API.", {
      provider: "bitbucket",
    });
  }

  return parsed.toString();
}

function normalizeTreePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

export type BitbucketProviderOptions = {
  env?: Env | undefined;
  config?: OAuthClientConfig | undefined;
  now?: (() => number) | undefined;
};

export function createBitbucketProvider(options?: BitbucketProviderOptions): GitProvider {
  const env = options?.env ?? process.env;
  const config = () => options?.config ?? readBitbucketOAuthConfig(env);
  const now = options?.now ?? Date.now;

  function requireClient(): { clientId: string; clientSecret: string } {
    const cfg = config();
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new GitProviderError("PROVIDER_NOT_CONFIGURED", provider.configurationHint() ?? "Bitbucket is not configured.", {
        provider: "bitbucket",
      });
    }
    return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
  }

  function toStoredCredential(token: BitbucketTokenResponse, previous?: ProviderCredential): ProviderCredential {
    if (!token.access_token) {
      throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "Bitbucket did not return an access token.", { provider: "bitbucket" });
    }

    const scopes = parseScopes(token.scopes);
    const refreshToken = token.refresh_token ?? previous?.refreshToken;
    const resolvedScopes = scopes.length > 0 ? scopes : previous?.scopes;

    return {
      accessToken: token.access_token,
      ...(refreshToken ? { refreshToken } : {}),
      ...(typeof token.expires_in === "number" && Number.isFinite(token.expires_in)
        ? { expiresAt: new Date(now() + token.expires_in * 1000).toISOString() }
        : {}),
      tokenType: token.token_type ?? "bearer",
      ...(resolvedScopes ? { scopes: resolvedScopes } : {}),
    };
  }

  async function tokenRequest(
    params: URLSearchParams,
    context: ProviderRuntimeContext | undefined,
    maxRetries: number | undefined,
  ): Promise<BitbucketTokenResponse> {
    const { clientId, clientSecret } = requireClient();
    const { data } = await providerJson<BitbucketTokenResponse>(TOKEN_URL, {
      provider: "bitbucket",
      method: "POST",
      // No `credential`: the client authenticates with HTTP Basic instead.
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      subject: "OAuth token exchange",
      ...(maxRetries != null ? { maxRetries } : {}),
      ...(context?.fetcher ? { fetcher: context.fetcher } : {}),
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    return data;
  }

  async function fetchUser(credential: RuntimeCredential, context?: ProviderRuntimeContext) {
    return providerJson<BitbucketUser>(`${credential.apiBaseUrl}/user`, {
      provider: "bitbucket",
      credential,
      ...context,
    });
  }

  async function listWorkspaces(credential: RuntimeCredential, context?: ProviderRuntimeContext): Promise<BitbucketWorkspace[]> {
    const workspaces: BitbucketWorkspace[] = [];
    let url: string | null = `${credential.apiBaseUrl}/user/workspaces?pagelen=100`;

    for (let page = 0; url && page < MAX_WORKSPACE_PAGES; page += 1) {
      let data: BitbucketPage<{ workspace?: BitbucketWorkspace } & Partial<BitbucketWorkspace>>;
      try {
        ({ data } = await providerJson<BitbucketPage<{ workspace?: BitbucketWorkspace } & Partial<BitbucketWorkspace>>>(url, {
          provider: "bitbucket",
          credential,
          subject: "workspaces",
          ...context,
        }));
      } catch (error) {
        // Older deployments / API revisions only expose the permissions listing.
        if (page === 0 && error instanceof GitProviderError && error.code === "REPOSITORY_NOT_FOUND") {
          url = `${credential.apiBaseUrl}/user/permissions/workspaces?pagelen=100`;
          ({ data } = await providerJson<BitbucketPage<{ workspace?: BitbucketWorkspace } & Partial<BitbucketWorkspace>>>(url, {
            provider: "bitbucket",
            credential,
            subject: "workspaces",
            ...context,
          }));
        } else {
          throw error;
        }
      }

      for (const value of data.values ?? []) {
        const workspace = value.workspace ?? (value.slug ? (value as BitbucketWorkspace) : null);
        if (workspace?.slug && !workspaces.some((existing) => existing.slug === workspace.slug)) {
          workspaces.push({
            slug: workspace.slug,
            ...(workspace.name ? { name: workspace.name } : {}),
            ...(workspace.uuid ? { uuid: workspace.uuid } : {}),
          });
        }
      }

      url = data.next ? assertTrustedNextUrl(data.next, credential.apiBaseUrl) : null;
    }

    workspaces.sort((a, b) => a.slug.localeCompare(b.slug));
    return workspaces;
  }

  async function listSrc(
    credential: RuntimeCredential,
    locator: RepositoryLocator,
    commit: string,
    directory: string,
    depth: number,
    context: ProviderRuntimeContext | undefined,
    onEntry: (entry: BitbucketSrcEntry) => void,
  ): Promise<void> {
    const dirPath = directory ? `${encodePathSegments(directory)}/` : "";
    let url: string | null =
      `${credential.apiBaseUrl}${repoPath(locator)}/src/${encodeURIComponent(commit)}/${dirPath}?pagelen=100&max_depth=${depth}`;

    for (let page = 0; url; page += 1) {
      if (page >= MAX_TREE_PAGES) {
        throw new GitProviderError("INDEX_FAILED", `The Bitbucket tree listing for ${locator.fullName} has too many pages.`, {
          provider: "bitbucket",
          status: 413,
        });
      }

      const { data }: { data: BitbucketPage<BitbucketSrcEntry> } = await providerJson<BitbucketPage<BitbucketSrcEntry>>(url, {
        provider: "bitbucket",
        credential,
        repositoryKnown: true,
        subject: locator.fullName,
        ...context,
      });

      for (const entry of data.values ?? []) {
        onEntry(entry);
      }

      url = data.next ? assertTrustedNextUrl(data.next, credential.apiBaseUrl) : null;
    }
  }

  const provider: GitProvider = {
    type: "bitbucket",
    label: "Bitbucket",
    hierarchy: ["Workspace", "Project", "Repository"],
    requestedAccess: ["Repositories: Read", "Account: Read", "Workspace membership: Read"],
    capabilities: {
      primaryAuth: "oauth",
      supportsRefresh: true,
      supportsRevocation: false,
      supportsSelfManaged: false,
      supportsManualToken: true,
      usesPkce: false,
    },

    isConfigured() {
      const cfg = config();
      return Boolean(cfg.clientId && cfg.clientSecret);
    },

    configurationHint() {
      if (provider.isConfigured()) {
        return null;
      }
      const appBaseUrl = (env.APP_BASE_URL ?? "<APP_BASE_URL>").replace(/\/+$/, "");
      return `Set BITBUCKET_OAUTH_CLIENT_ID and BITBUCKET_OAUTH_CLIENT_SECRET. Create a Bitbucket OAuth client with only Account: Read, Workspace membership: Read and Repositories: Read and the callback URL ${appBaseUrl}/api/git/connections/bitbucket/callback.`;
    },

    async getAuthorizationUrl(request) {
      const { clientId } = requireClient();
      // Permissions are declared on the OAuth consumer; no scope parameter is sent.
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", request.state);
      return url.toString();
    },

    async completeAuthorization(callback, _exchange, context): Promise<CompletedAuthorization> {
      const error = callback.get("error");
      if (error) {
        const description = callback.get("error_description");
        throw new GitProviderError(
          "AUTH_REQUIRED",
          error === "access_denied"
            ? "Bitbucket authorization was declined. Connect Bitbucket again and grant access to continue."
            : `Bitbucket authorization failed (${error}${description ? `: ${description}` : ""}). Connect Bitbucket again.`,
          { provider: "bitbucket" },
        );
      }

      const code = callback.get("code")?.trim();
      if (!code) {
        throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "Bitbucket did not return an authorization code.", { provider: "bitbucket" });
      }

      let token: BitbucketTokenResponse;
      try {
        token = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code }), context, 0);
      } catch (err) {
        if (err instanceof GitProviderError && err.code === "TOKEN_REVOKED") {
          throw new GitProviderError(
            "AUTHORIZATION_STATE_INVALID",
            "Bitbucket rejected the authorization code (it may have expired or already been used). Connect Bitbucket again.",
            { provider: "bitbucket" },
          );
        }
        throw err;
      }

      const credential = toStoredCredential(token);
      const runtime = createRuntimeCredential({
        provider: "bitbucket",
        connectionId: null,
        organizationId: null,
        apiBaseUrl: BITBUCKET_API_BASE_URL,
        host: BITBUCKET_HOST,
        accessToken: credential.accessToken ?? null,
      });
      const { data: user } = await fetchUser(runtime, context);
      const identity = toIdentity(user);

      return {
        authType: "oauth",
        credential,
        identity,
        accountId: user.uuid ?? user.account_id ?? identity.id,
        accountName: user.username ?? user.display_name ?? identity.login,
        host: BITBUCKET_HOST,
        scopes: credential.scopes ?? [],
      };
    },

    async refreshCredential(credential, context) {
      if (!credential.refreshToken) {
        throw new GitProviderError("TOKEN_EXPIRED", "This Bitbucket connection has no refresh token. Reauthorize Bitbucket.", {
          provider: "bitbucket",
        });
      }

      const token = await tokenRequest(
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: credential.refreshToken }),
        context,
        undefined,
      );
      return toStoredCredential(token, credential);
    },

    async createRuntimeCredential(input) {
      if (!input.credential?.accessToken) {
        throw new GitProviderError("AUTH_REQUIRED", "This Bitbucket connection has no stored credential. Reauthorize Bitbucket.", {
          provider: "bitbucket",
        });
      }

      // OAuth access tokens and repository/project/workspace access tokens
      // (and API tokens used as bearer tokens) all authenticate with Bearer.
      return createRuntimeCredential({
        provider: "bitbucket",
        connectionId: input.connectionId,
        organizationId: input.organizationId,
        apiBaseUrl: BITBUCKET_API_BASE_URL,
        host: BITBUCKET_HOST,
        scheme: "bearer",
        accessToken: input.credential.accessToken,
        ...(input.credential.expiresAt ? { expiresAt: input.credential.expiresAt } : {}),
      });
    },

    async getIdentity(credential, context) {
      const { data } = await fetchUser(credential, context);
      return toIdentity(data);
    },

    async listAccounts(credential, context): Promise<ProviderAccount[]> {
      const workspaces = await listWorkspaces(credential, context);
      return workspaces.map((workspace) => ({
        id: workspace.uuid ?? workspace.slug,
        name: workspace.name ?? workspace.slug,
        kind: "workspace",
      }));
    },

    async listRepositories(credential, options, context) {
      const pageSize = Math.min(Math.max(Math.floor(options?.pageSize ?? 50), 1), 100);
      const cursor = decodeCursor(options?.cursor, { w: 0, page: 1 });
      let workspaceIndex = Math.max(0, Math.floor(Number(cursor.w) || 0));
      let page = Math.max(1, Math.floor(Number(cursor.page) || 1));
      const search = options?.search?.trim();
      const workspaces = await listWorkspaces(credential, context);

      for (let skips = 0; workspaceIndex < workspaces.length; skips += 1) {
        const workspace = workspaces[workspaceIndex] as BitbucketWorkspace;
        const params = new URLSearchParams({
          role: "member",
          pagelen: String(pageSize),
          page: String(page),
          sort: "full_name",
        });
        if (search) {
          params.set("q", `name ~ "${escapeBitbucketQueryValue(search)}"`);
        }

        const { data } = await providerJson<BitbucketPage<BitbucketRepository>>(
          `${credential.apiBaseUrl}/repositories/${encodeURIComponent(workspace.slug)}?${params.toString()}`,
          { provider: "bitbucket", credential, subject: `workspace ${workspace.slug}`, ...context },
        );

        const items = (data.values ?? []).map(toProviderRepository);
        const currentPage = typeof data.page === "number" && data.page > 0 ? data.page : page;
        let nextCursor: string | null = null;
        if (data.next) {
          nextCursor = encodeCursor({ w: workspaceIndex, page: currentPage + 1 });
        } else if (workspaceIndex + 1 < workspaces.length) {
          nextCursor = encodeCursor({ w: workspaceIndex + 1, page: 1 });
        }

        // Skip over empty workspaces (bounded) so callers do not see empty pages.
        if (items.length === 0 && nextCursor && !data.next && skips < MAX_EMPTY_WORKSPACE_SKIPS) {
          workspaceIndex += 1;
          page = 1;
          continue;
        }

        return { items, nextCursor };
      }

      return { items: [], nextCursor: null };
    },

    async getRepository(credential, locator, context) {
      const { data } = await providerJson<BitbucketRepository>(`${credential.apiBaseUrl}${repoPath(locator)}`, {
        provider: "bitbucket",
        credential,
        repositoryKnown: true,
        subject: locator.fullName,
        ...context,
      });
      return toProviderRepository(data);
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
      const maxDepth = Math.max(1, Math.floor(context?.maxDepth ?? DEFAULT_TREE_DEPTH));
      const maxEntries = Math.max(1, Math.floor(context?.maxEntries ?? DEFAULT_TREE_MAX_ENTRIES));
      const runtime: ProviderRuntimeContext = {
        ...(context?.fetcher ? { fetcher: context.fetcher } : {}),
        ...(context?.signal ? { signal: context.signal } : {}),
      };

      const entries = new Map<string, RepositoryTreeEntry>();
      const add = (entry: BitbucketSrcEntry) => {
        if (!entry.path || (entry.type !== "commit_file" && entry.type !== "commit_directory")) {
          return;
        }
        const path = normalizeTreePath(entry.path);
        if (!path || pathDepth(path) > maxDepth || entries.has(path)) {
          return;
        }
        if (entries.size >= maxEntries) {
          throw new GitProviderError(
            "INDEX_FAILED",
            `${locator.fullName} has more than ${maxEntries} tree entries; the repository exceeds the indexing limit.`,
            { provider: "bitbucket", status: 413 },
          );
        }
        entries.set(path, {
          path,
          kind: entry.type === "commit_directory" ? "dir" : "file",
          ...(entry.type === "commit_file" && typeof entry.size === "number" ? { size: entry.size } : {}),
        });
      };

      // Ask Bitbucket to recurse via max_depth; then fall back to a
      // breadth-first walk for any directory it did not expand. Git has no
      // empty directories, so a directory without listed children was not
      // expanded.
      await listSrc(credential, locator, revision, "", maxDepth, runtime, add);

      const expanded = new Set<string>([""]);
      for (;;) {
        const parents = new Set<string>();
        for (const path of entries.keys()) {
          const slash = path.lastIndexOf("/");
          if (slash > 0) {
            parents.add(path.slice(0, slash));
          }
        }
        const pending = [...entries.values()].filter(
          (entry) => entry.kind === "dir" && !expanded.has(entry.path) && !parents.has(entry.path) && pathDepth(entry.path) < maxDepth,
        );
        if (pending.length === 0) {
          break;
        }
        for (const dir of pending) {
          expanded.add(dir.path);
          await listSrc(credential, locator, revision, dir.path, maxDepth - pathDepth(dir.path), runtime, add);
        }
      }

      return [...entries.values()];
    },

    async readFile(credential, locator, revision, path, context) {
      const { body } = await providerRequest(
        `${credential.apiBaseUrl}${repoPath(locator)}/src/${encodeURIComponent(revision)}/${encodePathSegments(path)}`,
        {
          provider: "bitbucket",
          credential,
          repositoryKnown: true,
          subject: `${locator.fullName}:${path}`,
          ...context,
          maxBytes: context?.maxBytes,
        },
      );
      return body;
    },

    async getDefaultBranch(credential, locator, context) {
      const repository = await provider.getRepository(credential, locator, context);
      if (!repository.defaultBranch) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", `${locator.fullName} has no main branch (empty repository?).`, {
          provider: "bitbucket",
        });
      }
      return repository.defaultBranch;
    },

    async resolveRevision(credential, locator, ref, context) {
      const { data } = await providerJson<{ hash?: string }>(
        `${credential.apiBaseUrl}${repoPath(locator)}/commit/${encodeURIComponent(ref)}`,
        {
          provider: "bitbucket",
          credential,
          repositoryKnown: true,
          subject: `${locator.fullName}@${ref}`,
          ...context,
        },
      );
      const hash = data.hash?.trim() ?? "";
      if (!/^[0-9a-f]{40}$/i.test(hash)) {
        throw new GitProviderError("INVALID_PROVIDER_RESPONSE", `Bitbucket could not resolve '${ref}' in ${locator.fullName}.`, {
          provider: "bitbucket",
        });
      }
      return hash.toLowerCase();
    },

    parseRepositoryUrl(url) {
      return parseBitbucketRepositoryUrl(url);
    },

    async inspectTokenPrivileges(credential, context) {
      const { response } = await fetchUser(credential, context);
      const scopes = parseScopes(response.headers.get("x-oauth-scopes"));
      const privileged = scopes.filter((scope) => PRIVILEGED_SCOPE_PATTERN.test(scope) || /(^|:)admin$/.test(scope));

      if (privileged.length === 0) {
        return [];
      }

      return [
        `This Bitbucket token grants write or admin permissions (${privileged.join(", ")}). Savant only needs Account: Read and Repositories: Read; create a token limited to read access.`,
      ];
    },
  };

  return provider;
}
