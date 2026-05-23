import type {
  ParsedRepositoryLocator,
  RepositoryCommitFileWrite,
  RepositoryCommitResult,
  RepositoryCreateRepositoryInput,
  RepositoryProviderAdapter,
  RepositoryProviderMetadata,
  RepositoryWebhookRegistration,
} from "./repository-provider.ts";
import {
  getRepositoryProviderCapabilities,
  parseRepositoryLocator,
} from "./repository-provider.ts";
import {
  readGitLabRepositoryTree,
  resolveGitLabRepositoryMetadata,
} from "./repository-provider-gitlab.ts";
import { resolveRepositoryProviderSecretFromRef } from "./repository-provider-connection.ts";
import type { FetchLike } from "./repository-provider-read.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";

const DEFAULT_GITLAB_BASE_URL = "https://gitlab.com";
const GITLAB_WRITE_TIMEOUT_MS = 10_000;

type GitLabProjectResponse = {
  id: number;
  name: string;
  path_with_namespace?: string;
  name_with_namespace?: string;
  default_branch?: string | null;
  visibility?: "public" | "private" | "internal";
  web_url?: string;
  http_url_to_repo?: string;
  namespace?: {
    full_path?: string;
  };
};

type GitLabNamespaceResponse = {
  id: number;
  full_path?: string;
};

type GitLabCommitResponse = {
  id?: string;
  committed_date?: string;
  created_at?: string;
  web_url?: string;
};

type GitLabProjectHookResponse = {
  id: number;
  url?: string;
  push_events?: boolean;
};

function createRequestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(GITLAB_WRITE_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function createGitLabHeaders(headers?: HeadersInit): Headers {
  const normalized = new Headers(headers);

  if (!normalized.has("Accept")) {
    normalized.set("Accept", "application/json");
  }

  if (!normalized.has("User-Agent")) {
    normalized.set("User-Agent", "savant-control-plane-write");
  }

  return normalized;
}

export function createGitLabAuthenticatedFetch(
  token: string,
  baseFetcher: FetchLike = fetch,
): FetchLike {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new RepositoryProviderError(
      "gitlab_access_token_missing",
      "A GitLab access token is required for provider-backed repository operations.",
      500,
    );
  }

  return async (input, init) => {
    const headers = createGitLabHeaders(init?.headers);
    headers.set("PRIVATE-TOKEN", normalizedToken);

    return baseFetcher(input, {
      ...init,
      headers,
    });
  };
}

function buildGitLabApiBaseUrl(baseUrl: string): string {
  return `${new URL(baseUrl).origin}/api/v4`;
}

function buildGitLabApiBaseUrlFromLocator(locator: ParsedRepositoryLocator): string {
  return buildGitLabApiBaseUrl(locator.normalizedUrl);
}

function encodeGitLabProjectPath(locator: ParsedRepositoryLocator): string {
  return encodeURIComponent(locator.projectPath);
}

function assertGitLabLocator(locator: ParsedRepositoryLocator): void {
  if (locator.provider !== "gitlab" || !locator.owner || !locator.repository) {
    throw new RepositoryProviderError(
      "invalid_gitlab_repository_locator",
      "A valid GitLab repository locator is required for provider-backed repository operations.",
      400,
    );
  }
}

function normalizeChangedPaths(files: readonly RepositoryCommitFileWrite[]): string[] {
  return [...new Set(files.map((file) => file.path.trim()).filter(Boolean))].sort();
}

async function readGitLabErrorDetail(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as {
      error?: string;
      message?: string | string[] | Record<string, unknown>;
    };

    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }

    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }

    if (Array.isArray(payload.message)) {
      const detail = payload.message.map((value) => `${value}`.trim()).filter(Boolean).join("; ");
      return detail || null;
    }

    if (payload.message && typeof payload.message === "object") {
      const detail = Object.entries(payload.message)
        .flatMap(([key, value]) => {
          if (Array.isArray(value)) {
            return value.map((entry) => `${key}: ${String(entry).trim()}`);
          }

          if (typeof value === "string") {
            return [`${key}: ${value.trim()}`];
          }

          return [`${key}: ${String(value).trim()}`];
        })
        .filter(Boolean)
        .join("; ");

      return detail || null;
    }
  } catch {
    return null;
  }

  return null;
}

async function requestGitLabJson<T>(
  target: string | ParsedRepositoryLocator,
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT";
    body?: Record<string, unknown> | undefined;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
    notFoundCode?: string | undefined;
    notFoundMessage?: string | undefined;
    conflictCode: string;
    conflictMessage: string;
    deniedCode: string;
    deniedMessage: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = typeof target === "string"
    ? buildGitLabApiBaseUrl(target)
    : buildGitLabApiBaseUrlFromLocator(target);
  const headers = createGitLabHeaders();

  if (options.body) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const requestInit: RequestInit = {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers,
      signal: createRequestSignal(options.signal),
    };

    if (options.body) {
      requestInit.body = JSON.stringify(options.body);
    }

    const response = await fetcher(`${baseUrl}${path}`, requestInit);

    if (!response.ok) {
      const detail = await readGitLabErrorDetail(response);
      const suffix = detail ? ` ${detail}` : "";

      if (response.status === 401 || response.status === 403) {
        throw new RepositoryProviderError(
          options.deniedCode,
          `${options.deniedMessage}${suffix}`,
          403,
        );
      }

      if (response.status === 404 && options.notFoundCode && options.notFoundMessage) {
        throw new RepositoryProviderError(
          options.notFoundCode,
          `${options.notFoundMessage}${suffix}`,
          404,
        );
      }

      if (response.status === 409 || response.status === 422) {
        throw new RepositoryProviderError(
          options.conflictCode,
          `${options.conflictMessage}${suffix}`,
          409,
        );
      }

      throw new RepositoryProviderError(
        options.failureCode,
        `${options.failureMessage}${suffix}`,
        502,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof RepositoryProviderError) {
      throw error;
    }

    if (
      error instanceof Error
      && (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new RepositoryProviderError(
        `${options.failureCode}_timeout`,
        `${options.failureMessage} GitLab took too long to respond.`,
        504,
      );
    }

    throw new RepositoryProviderError(
      `${options.failureCode}_unavailable`,
      `${options.failureMessage} GitLab could not be reached right now.`,
      502,
    );
  }
}

async function resolveGitLabNamespaceId(
  baseUrl: string,
  ownerPath: string,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<number> {
  const namespace = await requestGitLabJson<GitLabNamespaceResponse>(
    baseUrl,
    `/namespaces/${encodeURIComponent(ownerPath)}`,
    {
      fetcher: options?.fetcher,
      signal: options?.signal,
      notFoundCode: "gitlab_namespace_unavailable",
      notFoundMessage: `GitLab namespace '${ownerPath}' could not be found or accessed.`,
      conflictCode: "gitlab_namespace_invalid",
      conflictMessage: `GitLab returned an unexpected response while resolving namespace '${ownerPath}'.`,
      deniedCode: "gitlab_namespace_denied",
      deniedMessage: `GitLab denied access to namespace '${ownerPath}'.`,
      failureCode: "gitlab_namespace_lookup_failed",
      failureMessage: `GitLab could not resolve namespace '${ownerPath}'.`,
    },
  );

  if (!Number.isInteger(namespace.id) || namespace.id < 1) {
    throw new RepositoryProviderError(
      "gitlab_namespace_invalid",
      `GitLab returned an invalid namespace id for '${ownerPath}'.`,
      409,
    );
  }

  return namespace.id;
}

function createLocatorFromGitLabProject(
  baseUrl: string,
  payload: GitLabProjectResponse,
  input: RepositoryCreateRepositoryInput,
): ParsedRepositoryLocator {
  const pathWithNamespace = payload.path_with_namespace?.trim()
    || [payload.namespace?.full_path?.trim() || input.owner?.trim(), payload.name?.trim() || input.name]
      .filter(Boolean)
      .join("/");

  if (!pathWithNamespace) {
    throw new RepositoryProviderError(
      "gitlab_repository_path_unavailable",
      "GitLab did not return the created repository path.",
      409,
    );
  }

  const rawRepositoryUrl = payload.web_url?.trim()
    || payload.http_url_to_repo?.trim()
    || `${new URL(baseUrl).origin}/${pathWithNamespace}`;

  const locator = parseRepositoryLocator({
    provider: "gitlab",
    repoUrl: rawRepositoryUrl,
  });

  if (!locator) {
    throw new RepositoryProviderError(
      "gitlab_repository_locator_invalid",
      "GitLab returned a repository URL that Savant could not parse.",
      502,
    );
  }

  return locator;
}

async function ensureGitLabDefaultBranch(
  locator: ParsedRepositoryLocator,
  currentDefaultBranch: string,
  desiredDefaultBranch: string,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<void> {
  if (currentDefaultBranch === desiredDefaultBranch) {
    return;
  }

  await requestGitLabJson<Record<string, unknown>>(
    locator,
    `/projects/${encodeGitLabProjectPath(locator)}/repository/branches?branch=${encodeURIComponent(desiredDefaultBranch)}&ref=${encodeURIComponent(currentDefaultBranch)}`,
    {
      method: "POST",
      fetcher: options?.fetcher,
      signal: options?.signal,
      conflictCode: "gitlab_default_branch_create_conflict",
      conflictMessage: `GitLab could not create branch '${desiredDefaultBranch}' from '${currentDefaultBranch}'.`,
      deniedCode: "gitlab_default_branch_create_denied",
      deniedMessage: "GitLab denied access while creating the requested default branch.",
      failureCode: "gitlab_default_branch_create_failed",
      failureMessage: `GitLab could not create branch '${desiredDefaultBranch}'.`,
    },
  );

  await requestGitLabJson<GitLabProjectResponse>(
    locator,
    `/projects/${encodeGitLabProjectPath(locator)}`,
    {
      method: "PUT",
      body: {
        default_branch: desiredDefaultBranch,
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      conflictCode: "gitlab_default_branch_update_conflict",
      conflictMessage: `GitLab could not set '${desiredDefaultBranch}' as the default branch.`,
      deniedCode: "gitlab_default_branch_update_denied",
      deniedMessage: "GitLab denied access while updating the project default branch.",
      failureCode: "gitlab_default_branch_update_failed",
      failureMessage: "GitLab could not update the project default branch.",
    },
  );
}

export async function createGitLabRepository(
  input: RepositoryCreateRepositoryInput,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryProviderMetadata & { normalizedUrl: string }> {
  const baseUrl = input.baseUrl?.trim()
    ? new URL(input.baseUrl).origin
    : DEFAULT_GITLAB_BASE_URL;
  const namespaceId = input.owner?.trim()
    ? await resolveGitLabNamespaceId(baseUrl, input.owner.trim(), options)
    : undefined;
  const payload = await requestGitLabJson<GitLabProjectResponse>(baseUrl, "/projects", {
    method: "POST",
    body: {
      name: input.name,
      path: input.name,
      namespace_id: namespaceId,
      description: input.description,
      visibility: input.visibility,
      initialize_with_readme: true,
      default_branch: input.defaultBranch,
    },
    fetcher: options?.fetcher,
    signal: options?.signal,
    conflictCode: "gitlab_repository_create_conflict",
    conflictMessage: `GitLab could not create repository '${input.name}' because it already exists or conflicts with an existing project.`,
    deniedCode: "gitlab_repository_create_denied",
    deniedMessage: "GitLab denied access to create the repository.",
    failureCode: "gitlab_repository_create_failed",
    failureMessage: `GitLab could not create repository '${input.name}'.`,
  });
  const locator = createLocatorFromGitLabProject(baseUrl, payload, input);
  let metadata = await resolveGitLabRepositoryMetadata(locator, {
    fetcher: options?.fetcher,
    signal: options?.signal,
  });

  if (metadata.defaultBranch !== input.defaultBranch) {
    await ensureGitLabDefaultBranch(locator, metadata.defaultBranch, input.defaultBranch, options);
    metadata = await resolveGitLabRepositoryMetadata(locator, {
      fetcher: options?.fetcher,
      signal: options?.signal,
    });
  }

  return {
    ...metadata,
    normalizedUrl: locator.normalizedUrl,
  };
}

export async function createGitLabRepositoryCommit(
  locator: ParsedRepositoryLocator,
  input: {
    branch: string;
    message: string;
    files: readonly RepositoryCommitFileWrite[];
  },
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryCommitResult> {
  assertGitLabLocator(locator);
  const files = input.files.filter((file) => file.path.trim());

  if (files.length === 0) {
    throw new RepositoryProviderError(
      "gitlab_commit_files_missing",
      "At least one file change is required to create a GitLab repository commit.",
      400,
    );
  }

  const existingTree = await readGitLabRepositoryTree(locator, {
    branch: input.branch,
    fetcher: options?.fetcher,
    signal: options?.signal,
  });
  const existingPaths = new Set(
    existingTree
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path),
  );
  const payload = await requestGitLabJson<GitLabCommitResponse>(
    locator,
    `/projects/${encodeGitLabProjectPath(locator)}/repository/commits`,
    {
      method: "POST",
      body: {
        branch: input.branch,
        commit_message: input.message,
        actions: files.map((file) => ({
          action: existingPaths.has(file.path) ? "update" : "create",
          file_path: file.path,
          content: file.content,
          encoding: "text",
        })),
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      conflictCode: "gitlab_commit_create_conflict",
      conflictMessage: "GitLab could not create the requested repository commit because the branch state changed or the repository rejected the update.",
      deniedCode: "gitlab_commit_create_denied",
      deniedMessage: "GitLab denied access to create the repository commit.",
      failureCode: "gitlab_commit_create_failed",
      failureMessage: "GitLab could not create the repository commit.",
    },
  );
  const commitSha = payload.id?.trim();

  if (!commitSha) {
    throw new RepositoryProviderError(
      "gitlab_commit_sha_unavailable",
      "GitLab did not return the created commit sha.",
      409,
    );
  }

  return {
    commitSha,
    changedPaths: normalizeChangedPaths(files),
    committedAt: payload.committed_date?.trim() || payload.created_at?.trim() || new Date().toISOString(),
    url: payload.web_url?.trim() || null,
  };
}

export async function registerGitLabRepositoryWebhook(
  locator: ParsedRepositoryLocator,
  input: {
    callbackUrl: string;
    secretRef: string | null;
    events: readonly string[];
  },
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
    env?: Record<string, string | undefined> | undefined;
  },
): Promise<RepositoryWebhookRegistration> {
  assertGitLabLocator(locator);
  const secret = input.secretRef
    ? resolveRepositoryProviderSecretFromRef(input.secretRef, options?.env ?? process.env)
    : undefined;
  const payload = await requestGitLabJson<GitLabProjectHookResponse>(
    locator,
    `/projects/${encodeGitLabProjectPath(locator)}/hooks`,
    {
      method: "POST",
      body: {
        url: input.callbackUrl,
        push_events: input.events.includes("push"),
        enable_ssl_verification: true,
        ...(secret ? { token: secret } : {}),
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      conflictCode: "gitlab_webhook_register_conflict",
      conflictMessage: "GitLab could not register the repository webhook because the target already exists or conflicts with an existing webhook.",
      deniedCode: "gitlab_webhook_register_denied",
      deniedMessage: "GitLab denied access to register the repository webhook.",
      failureCode: "gitlab_webhook_register_failed",
      failureMessage: "GitLab could not register the repository webhook.",
    },
  );

  return {
    id: String(payload.id),
    url: payload.url?.trim() || input.callbackUrl,
    events: payload.push_events ? ["push"] : [...input.events],
    secretRef: input.secretRef,
  };
}

export function createGitLabRepositoryProviderAdapter(options?: {
  fetcher?: FetchLike | undefined;
  env?: Record<string, string | undefined> | undefined;
}): RepositoryProviderAdapter {
  const fetcher = options?.fetcher;

  return {
    provider: "gitlab",
    capabilities: getRepositoryProviderCapabilities("gitlab"),
    resolveRepository: (locator, requestOptions) => resolveGitLabRepositoryMetadata(locator, {
      fetcher,
      signal: requestOptions?.signal,
    }),
    readRepositoryTree: (locator, requestOptions) => readGitLabRepositoryTree(locator, {
      branch: requestOptions?.ref,
      fetcher,
      signal: requestOptions?.signal,
    }),
    createRepository: (input, requestOptions) => createGitLabRepository(input, {
      fetcher,
      signal: requestOptions?.signal,
    }),
    createCommit: (locator, input, requestOptions) => createGitLabRepositoryCommit(locator, input, {
      fetcher,
      signal: requestOptions?.signal,
    }),
    registerWebhook: (locator, input, requestOptions) => registerGitLabRepositoryWebhook(locator, input, {
      fetcher,
      signal: requestOptions?.signal,
      env: options?.env,
    }),
  };
}
