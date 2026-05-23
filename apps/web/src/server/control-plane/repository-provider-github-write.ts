import type { FetchLike } from "./repository-provider-read.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";
import type {
  ParsedRepositoryLocator,
  RepositoryCommitFileWrite,
  RepositoryCommitResult,
  RepositoryCreateRepositoryInput,
  RepositoryProviderAdapter,
  RepositoryProviderMetadata,
  RepositoryWebhookRegistration,
} from "./repository-provider.ts";
import { getRepositoryProviderCapabilities } from "./repository-provider.ts";
import {
  readGitHubRepositoryTree,
  resolveGitHubBranchHeadCommitSha,
  resolveGitHubRepositoryMetadata,
} from "./repository-provider-github.ts";
import { resolveRepositoryProviderSecretFromRef } from "./repository-provider-connection.ts";

type GitHubRepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  visibility?: "public" | "private" | "internal";
  default_branch: string;
  html_url?: string;
  owner?: {
    login?: string;
  };
};

type GitHubRefResponse = {
  ref?: string;
  object?: {
    sha?: string;
    type?: string;
  };
};

type GitHubGitCommitResponse = {
  sha: string;
  tree?: {
    sha?: string;
  };
  author?: {
    date?: string;
  };
  html_url?: string;
};

type GitHubBlobResponse = {
  sha: string;
};

type GitHubTreeResponse = {
  sha: string;
};

type GitHubWebhookResponse = {
  id: number;
  config?: {
    url?: string;
  };
  events?: string[];
};

function createRequestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(10000);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function createGitHubHeaders(headers?: HeadersInit): Headers {
  const normalized = new Headers(headers);

  if (!normalized.has("Accept")) {
    normalized.set("Accept", "application/vnd.github+json");
  }

  if (!normalized.has("User-Agent")) {
    normalized.set("User-Agent", "savant-control-plane-write");
  }

  if (!normalized.has("X-GitHub-Api-Version")) {
    normalized.set("X-GitHub-Api-Version", "2022-11-28");
  }

  return normalized;
}

export function createGitHubAuthenticatedFetch(
  token: string,
  baseFetcher: FetchLike = fetch,
): FetchLike {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new RepositoryProviderError(
      "github_token_missing",
      "A GitHub access token is required for repository write operations.",
      503,
    );
  }

  return async (input, init) => {
    const headers = createGitHubHeaders(init?.headers);
    headers.set("Authorization", `Bearer ${normalizedToken}`);

    return baseFetcher(input, {
      ...init,
      headers,
    });
  };
}

function mapGitHubVisibility(payload: GitHubRepositoryResponse): RepositoryProviderMetadata["visibility"] {
  if (payload.visibility === "public" || payload.visibility === "private" || payload.visibility === "internal") {
    return payload.visibility;
  }

  return payload.private ? "private" : "public";
}

function normalizeChangedPaths(files: readonly RepositoryCommitFileWrite[]): string[] {
  return [...new Set(files.map((file) => file.path.trim()).filter(Boolean))].sort();
}

function assertGitHubLocator(locator: ParsedRepositoryLocator): {
  owner: string;
  repository: string;
} {
  if (locator.provider !== "github" || !locator.owner || !locator.repository) {
    throw new RepositoryProviderError(
      "invalid_github_repository_locator",
      "A valid GitHub repository locator is required for provider-backed writes.",
      400,
    );
  }

  return {
    owner: locator.owner,
    repository: locator.repository,
  };
}

async function readGitHubMutationErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.json() as { message?: string; errors?: Array<{ message?: string }> };
    const messages = [payload.message, ...(payload.errors ?? []).map((entry) => entry.message)]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());

    return messages.length > 0 ? messages.join(" ") : undefined;
  } catch {
    return undefined;
  }
}

async function requestGitHubJson<T>(
  path: string,
  options?: {
    method?: string | undefined;
    body?: unknown;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
    conflictCode?: string | undefined;
    conflictMessage?: string | undefined;
    deniedCode?: string | undefined;
    deniedMessage?: string | undefined;
    failureCode?: string | undefined;
    failureMessage?: string | undefined;
  },
): Promise<T> {
  const fetcher = options?.fetcher ?? fetch;

  try {
    const headers = createGitHubHeaders();
    let body: string | undefined;

    if (options?.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    const response = await fetcher(`https://api.github.com${path}`, {
      method: options?.method ?? "GET",
      headers,
      signal: createRequestSignal(options?.signal),
      ...(body !== undefined ? { body } : {}),
    });

    if (!response.ok) {
      const detail = await readGitHubMutationErrorMessage(response);

      if (response.status === 401 || response.status === 403) {
        throw new RepositoryProviderError(
          options?.deniedCode ?? "github_write_access_denied",
          detail ?? options?.deniedMessage ?? "GitHub denied access to the requested repository mutation.",
          response.status === 401 ? 401 : 403,
        );
      }

      if (response.status === 409 || response.status === 422) {
        throw new RepositoryProviderError(
          options?.conflictCode ?? "github_write_conflict",
          detail ?? options?.conflictMessage ?? "GitHub reported a repository write conflict.",
          409,
        );
      }

      throw new RepositoryProviderError(
        options?.failureCode ?? "github_write_failed",
        detail ?? options?.failureMessage ?? "GitHub could not complete the requested repository mutation.",
        response.status >= 500 ? 502 : response.status,
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
        options?.failureCode ?? "github_write_timeout",
        "GitHub took too long to complete the requested repository mutation.",
        504,
      );
    }

    throw new RepositoryProviderError(
      options?.failureCode ?? "github_write_unavailable",
      options?.failureMessage ?? "GitHub could not be reached for the requested repository mutation.",
      502,
    );
  }
}

async function resolveGitHubCommitTreeSha(
  locator: ParsedRepositoryLocator,
  commitSha: string,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<string> {
  const { owner, repository } = assertGitHubLocator(locator);
  const payload = await requestGitHubJson<GitHubGitCommitResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits/${encodeURIComponent(commitSha)}`,
    {
      fetcher: options?.fetcher,
      signal: options?.signal,
      deniedCode: "github_commit_lookup_denied",
      deniedMessage: "GitHub denied access to the current repository commit.",
      failureCode: "github_commit_lookup_failed",
      failureMessage: "GitHub could not resolve the current repository commit tree.",
    },
  );

  const treeSha = payload.tree?.sha?.trim();

  if (!treeSha) {
    throw new RepositoryProviderError(
      "github_commit_tree_unavailable",
      `GitHub did not return a tree SHA for commit '${commitSha}'.`,
      409,
    );
  }

  return treeSha;
}

async function createGitHubBranchFromSource(
  locator: ParsedRepositoryLocator,
  branch: string,
  sourceSha: string,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<void> {
  const { owner, repository } = assertGitHubLocator(locator);

  await requestGitHubJson<GitHubRefResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/refs`,
    {
      method: "POST",
      body: {
        ref: `refs/heads/${branch}`,
        sha: sourceSha,
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      conflictCode: "github_branch_create_conflict",
      conflictMessage: `GitHub could not create branch '${branch}'.`,
      deniedCode: "github_branch_create_denied",
      deniedMessage: `GitHub denied access to create branch '${branch}'.`,
      failureCode: "github_branch_create_failed",
      failureMessage: `GitHub could not create branch '${branch}'.`,
    },
  );
}

async function updateGitHubBranchRef(
  locator: ParsedRepositoryLocator,
  branch: string,
  commitSha: string,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<void> {
  const { owner, repository } = assertGitHubLocator(locator);

  await requestGitHubJson<GitHubRefResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "PATCH",
      body: {
        sha: commitSha,
        force: false,
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      conflictCode: "github_ref_update_conflict",
      conflictMessage: `GitHub could not update branch '${branch}' because it changed concurrently.`,
      deniedCode: "github_ref_update_denied",
      deniedMessage: `GitHub denied access to update branch '${branch}'.`,
      failureCode: "github_ref_update_failed",
      failureMessage: `GitHub could not update branch '${branch}'.`,
    },
  );
}

async function ensureGitHubBranchState(
  locator: ParsedRepositoryLocator,
  branch: string,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<{ commitSha: string; treeSha: string }> {
  try {
    const commitSha = await resolveGitHubBranchHeadCommitSha(locator, {
      branch,
      fetcher: options?.fetcher,
      signal: options?.signal,
    });

    return {
      commitSha,
      treeSha: await resolveGitHubCommitTreeSha(locator, commitSha, options),
    };
  } catch (error) {
    if (!(error instanceof RepositoryProviderError) || error.code !== "github_branch_head_unavailable") {
      throw error;
    }

    const metadata = await resolveGitHubRepositoryMetadata(locator, {
      fetcher: options?.fetcher,
      signal: options?.signal,
    });
    const baseBranch = metadata.defaultBranch;

    if (!baseBranch || baseBranch === branch) {
      throw error;
    }

    const baseCommitSha = await resolveGitHubBranchHeadCommitSha(locator, {
      branch: baseBranch,
      fetcher: options?.fetcher,
      signal: options?.signal,
    });

    await createGitHubBranchFromSource(locator, branch, baseCommitSha, options);

    return {
      commitSha: baseCommitSha,
      treeSha: await resolveGitHubCommitTreeSha(locator, baseCommitSha, options),
    };
  }
}

async function updateGitHubRepositoryDefaultBranch(
  locator: ParsedRepositoryLocator,
  branch: string,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<void> {
  const { owner, repository } = assertGitHubLocator(locator);

  await requestGitHubJson<GitHubRepositoryResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    {
      method: "PATCH",
      body: {
        default_branch: branch,
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      deniedCode: "github_default_branch_update_denied",
      deniedMessage: `GitHub denied access to update the default branch to '${branch}'.`,
      failureCode: "github_default_branch_update_failed",
      failureMessage: `GitHub could not update the default branch to '${branch}'.`,
    },
  );
}

export async function createGitHubRepository(
  input: RepositoryCreateRepositoryInput,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryProviderMetadata & { normalizedUrl: string }> {
  const owner = input.owner?.trim();
  const targetPath = owner
    ? `/orgs/${encodeURIComponent(owner)}/repos`
    : "/user/repos";
  const payload = await requestGitHubJson<GitHubRepositoryResponse>(targetPath, {
    method: "POST",
    body: {
      name: input.name,
      description: input.description,
      private: input.visibility !== "public",
      visibility: input.visibility,
      auto_init: true,
    },
    fetcher: options?.fetcher,
    signal: options?.signal,
    conflictCode: "github_repository_create_conflict",
    conflictMessage: `GitHub could not create repository '${input.name}' because it already exists or conflicts with an existing resource.`,
    deniedCode: "github_repository_create_denied",
    deniedMessage: `GitHub denied access to create repository '${input.name}'.`,
    failureCode: "github_repository_create_failed",
    failureMessage: `GitHub could not create repository '${input.name}'.`,
  });

  const resolvedOwner = payload.owner?.login?.trim() || owner;

  if (!resolvedOwner) {
    throw new RepositoryProviderError(
      "github_repository_owner_missing",
      "GitHub created the repository but did not return an owner name.",
      502,
    );
  }

  const locator: ParsedRepositoryLocator = {
    provider: "github",
    rawUrl: payload.html_url?.trim() || `https://github.com/${resolvedOwner}/${input.name}`,
    normalizedUrl: `https://github.com/${resolvedOwner}/${input.name}`,
    host: "github.com",
    owner: resolvedOwner,
    repository: payload.name,
    projectPath: `${resolvedOwner}/${payload.name}`,
  };

  if (payload.default_branch && payload.default_branch !== input.defaultBranch) {
    const defaultBranchHead = await resolveGitHubBranchHeadCommitSha(locator, {
      branch: payload.default_branch,
      fetcher: options?.fetcher,
      signal: options?.signal,
    });

    await createGitHubBranchFromSource(locator, input.defaultBranch, defaultBranchHead, options);
    await updateGitHubRepositoryDefaultBranch(locator, input.defaultBranch, options);
  }

  return {
    externalId: String(payload.id),
    defaultBranch: input.defaultBranch,
    displayName: payload.full_name || `${resolvedOwner}/${payload.name}`,
    visibility: mapGitHubVisibility(payload),
    normalizedUrl: locator.normalizedUrl,
  };
}

export async function createGitHubRepositoryCommit(
  locator: ParsedRepositoryLocator,
  input: {
    branch: string;
    message: string;
    files: RepositoryCommitFileWrite[];
  },
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryCommitResult> {
  const { owner, repository } = assertGitHubLocator(locator);
  const files = [...new Map(
    input.files.map((file) => [file.path.trim(), { ...file, path: file.path.trim() }]),
  ).values()].filter((file) => file.path.length > 0);

  if (files.length === 0) {
    throw new RepositoryProviderError(
      "github_commit_files_required",
      "At least one file is required to create a GitHub commit.",
      400,
    );
  }

  const branchState = await ensureGitHubBranchState(locator, input.branch, options);
  const treeEntries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];

  for (const file of files) {
    const blob = await requestGitHubJson<GitHubBlobResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/blobs`,
      {
        method: "POST",
        body: {
          content: file.content,
          encoding: "utf-8",
        },
        fetcher: options?.fetcher,
        signal: options?.signal,
        deniedCode: "github_blob_create_denied",
        deniedMessage: `GitHub denied access to write '${file.path}'.`,
        failureCode: "github_blob_create_failed",
        failureMessage: `GitHub could not stage '${file.path}' for commit creation.`,
      },
    );

    treeEntries.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await requestGitHubJson<GitHubTreeResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees`,
    {
      method: "POST",
      body: {
        base_tree: branchState.treeSha,
        tree: treeEntries,
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      deniedCode: "github_tree_create_denied",
      deniedMessage: `GitHub denied access to assemble a tree for branch '${input.branch}'.`,
      failureCode: "github_tree_create_failed",
      failureMessage: `GitHub could not assemble the requested repository tree for branch '${input.branch}'.`,
    },
  );

  const commit = await requestGitHubJson<GitHubGitCommitResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits`,
    {
      method: "POST",
      body: {
        message: input.message,
        tree: tree.sha,
        parents: [branchState.commitSha],
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      deniedCode: "github_commit_create_denied",
      deniedMessage: `GitHub denied access to create a commit on branch '${input.branch}'.`,
      failureCode: "github_commit_create_failed",
      failureMessage: `GitHub could not create a commit on branch '${input.branch}'.`,
    },
  );

  await updateGitHubBranchRef(locator, input.branch, commit.sha, options);

  return {
    commitSha: commit.sha,
    committedAt: commit.author?.date?.trim() || new Date().toISOString(),
    url: commit.html_url?.trim() || null,
    changedPaths: normalizeChangedPaths(files),
  };
}

export async function registerGitHubRepositoryWebhook(
  locator: ParsedRepositoryLocator,
  input: {
    callbackUrl: string;
    secretRef: string | null;
    events: string[];
  },
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
    env?: Record<string, string | undefined> | undefined;
  },
): Promise<RepositoryWebhookRegistration> {
  const { owner, repository } = assertGitHubLocator(locator);
  const secret = input.secretRef
    ? resolveRepositoryProviderSecretFromRef(input.secretRef, options?.env ?? process.env)
    : undefined;
  const payload = await requestGitHubJson<GitHubWebhookResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/hooks`,
    {
      method: "POST",
      body: {
        active: true,
        events: input.events,
        config: {
          url: input.callbackUrl,
          content_type: "json",
          insecure_ssl: "0",
          ...(secret ? { secret } : {}),
        },
      },
      fetcher: options?.fetcher,
      signal: options?.signal,
      conflictCode: "github_webhook_register_conflict",
      conflictMessage: "GitHub could not register the repository webhook because the target already exists or conflicts with an existing webhook.",
      deniedCode: "github_webhook_register_denied",
      deniedMessage: "GitHub denied access to register the repository webhook.",
      failureCode: "github_webhook_register_failed",
      failureMessage: "GitHub could not register the repository webhook.",
    },
  );

  return {
    id: String(payload.id),
    url: payload.config?.url?.trim() || input.callbackUrl,
    events: payload.events ?? input.events,
    secretRef: input.secretRef,
  };
}

export function createGitHubRepositoryProviderAdapter(
  options?: {
    fetcher?: FetchLike | undefined;
    env?: Record<string, string | undefined> | undefined;
  },
): RepositoryProviderAdapter {
  return {
    provider: "github",
    capabilities: getRepositoryProviderCapabilities("github"),
    resolveRepository: (locator, requestOptions) => resolveGitHubRepositoryMetadata(locator, {
      fetcher: options?.fetcher,
      signal: requestOptions?.signal,
    }),
    readRepositoryTree: (locator, requestOptions) => readGitHubRepositoryTree(locator, {
      branch: requestOptions?.ref,
      fetcher: options?.fetcher,
      signal: requestOptions?.signal,
    }),
    createRepository: (input, requestOptions) => createGitHubRepository(input, {
      fetcher: options?.fetcher,
      signal: requestOptions?.signal,
    }),
    createCommit: (locator, input, requestOptions) => createGitHubRepositoryCommit(locator, input, {
      fetcher: options?.fetcher,
      signal: requestOptions?.signal,
    }),
    registerWebhook: (locator, input, requestOptions) => registerGitHubRepositoryWebhook(locator, input, {
      fetcher: options?.fetcher,
      signal: requestOptions?.signal,
      env: options?.env,
    }),
  };
}