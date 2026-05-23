import { tenantSkillRepoContract } from "@savant/schemas/tenant-skill-repo-contract";

import type {
  ParsedRepositoryLocator,
  RepositoryProviderMetadata,
  RepositoryTreeEntry,
} from "./repository-provider.ts";
import type {
  FetchLike,
  RepositoryProviderIndexSnapshot,
  RepositoryProviderPreview,
} from "./repository-provider-read.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";

type GitLabProjectResponse = {
  id: number;
  name: string;
  path_with_namespace?: string;
  name_with_namespace?: string;
  default_branch?: string | null;
  visibility?: "public" | "private" | "internal";
};

type GitLabRepositoryTreeEntryResponse = {
  id?: string;
  path: string;
  type: "blob" | "tree" | "commit";
};

type GitLabBranchResponse = {
  name: string;
  commit?: {
    id?: string;
  };
};

type GitLabFileResponse = {
  blob_id?: string;
  content?: string;
  encoding?: string;
  file_name?: string;
  file_path: string;
  ref?: string;
};

const GITLAB_TREE_PAGE_SIZE = 100;
const MAX_GITLAB_TREE_PAGES = 25;

function createRequestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(5000);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function createGitLabHeaders(): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent": "savant-control-plane-preview",
  };
}

function buildGitLabApiBaseUrl(locator: ParsedRepositoryLocator): string {
  return `${new URL(locator.normalizedUrl).origin}/api/v4`;
}

function encodeGitLabProjectPath(locator: ParsedRepositoryLocator): string {
  return encodeURIComponent(locator.projectPath);
}

function inferSkillPackageRoots(paths: readonly string[]): string[] {
  const discovered = new Set<string>();

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);

    if (parts[0] === "tier1" && parts[1] === "standards" && parts[2]) {
      discovered.add(parts.slice(0, 3).join("/"));
      continue;
    }

    if (parts[0] === "tier2" && parts[1] === "methodology" && parts[2] && parts[3]) {
      discovered.add(parts.slice(0, 4).join("/"));
      continue;
    }

    if (
      parts[0] === "tier3"
      && (parts[1] === "personal" || parts[1] === "workflow")
      && parts[2]
      && parts[3]
    ) {
      discovered.add(parts.slice(0, 4).join("/"));
    }
  }

  return [...discovered].sort();
}

function mapGitLabVisibility(payload: GitLabProjectResponse): RepositoryProviderMetadata["visibility"] {
  if (payload.visibility === "public" || payload.visibility === "private" || payload.visibility === "internal") {
    return payload.visibility;
  }

  return "unknown";
}

function mapGitLabTreeEntry(entry: GitLabRepositoryTreeEntryResponse): RepositoryTreeEntry | null {
  if (!entry.path || entry.type === "commit") {
    return null;
  }

  return {
    path: entry.path,
    kind: entry.type === "tree" ? "dir" : "file",
  };
}

function mapGitLabHttpError(
  status: number,
  context: "project" | "tree" | "branch" | "file",
): RepositoryProviderError {
  if (status === 404) {
    if (context === "project") {
      return new RepositoryProviderError(
        "gitlab_repository_unavailable",
        "GitLab could not read that repository preview anonymously. Paste a repository path snapshot or complete provider authorization for private repositories.",
        404,
      );
    }

    if (context === "branch") {
      return new RepositoryProviderError(
        "gitlab_branch_head_unavailable",
        "GitLab could not resolve the current commit for the requested branch.",
        409,
      );
    }

    if (context === "file") {
      return new RepositoryProviderError(
        "gitlab_file_unavailable",
        "GitLab could not read one or more required repository files.",
        404,
      );
    }

    return new RepositoryProviderError(
      "gitlab_tree_unavailable",
      "GitLab could not resolve the repository tree for the requested ref.",
      409,
    );
  }

  if (status === 401 || status === 403) {
    return new RepositoryProviderError(
      "gitlab_repository_forbidden",
      "GitLab requires provider authorization to preview that repository. Paste a repository path snapshot or complete provider auth for private repositories.",
      403,
    );
  }

  if (status === 429) {
    return new RepositoryProviderError(
      "gitlab_rate_limited",
      "GitLab temporarily refused the repository preview request. Try again shortly or paste a repository path snapshot while provider auth is still being wired.",
      503,
    );
  }

  return new RepositoryProviderError(
    "gitlab_preview_failed",
    "GitLab could not provide a repository preview right now.",
    502,
  );
}

async function readGitLabJson<T>(
  locator: ParsedRepositoryLocator,
  path: string,
  context: "project" | "tree" | "branch" | "file",
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<{ data: T; response: Response }> {
  const fetcher = options?.fetcher ?? fetch;

  try {
    const response = await fetcher(`${buildGitLabApiBaseUrl(locator)}${path}`, {
      headers: createGitLabHeaders(),
      signal: createRequestSignal(options?.signal),
    });

    if (!response.ok) {
      throw mapGitLabHttpError(response.status, context);
    }

    return {
      data: (await response.json()) as T,
      response,
    };
  } catch (error) {
    if (error instanceof RepositoryProviderError) {
      throw error;
    }

    if (
      error instanceof Error
      && (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new RepositoryProviderError(
        "gitlab_preview_timeout",
        "GitLab took too long to return a repository preview.",
        504,
      );
    }

    throw new RepositoryProviderError(
      "gitlab_preview_unavailable",
      "GitLab could not be reached to preview the repository tree.",
      502,
    );
  }
}

function assertGitLabLocator(locator: ParsedRepositoryLocator): { projectPath: string } {
  if (locator.provider !== "gitlab" || !locator.owner || !locator.repository) {
    throw new RepositoryProviderError(
      "invalid_gitlab_repository_locator",
      "A valid GitLab repository locator is required for live repository preview.",
      400,
    );
  }

  return {
    projectPath: locator.projectPath,
  };
}

function decodeGitLabFileContent(payload: GitLabFileResponse, path: string): string {
  if (payload.encoding !== "base64" || typeof payload.content !== "string") {
    throw new RepositoryProviderError(
      "gitlab_file_encoding_unsupported",
      `GitLab returned an unsupported encoding for '${path}'.`,
      409,
    );
  }

  return Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
}

export async function resolveGitLabRepositoryMetadata(
  locator: ParsedRepositoryLocator,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryProviderMetadata> {
  const { projectPath } = assertGitLabLocator(locator);
  const { data } = await readGitLabJson<GitLabProjectResponse>(
    locator,
    `/projects/${encodeURIComponent(projectPath)}`,
    "project",
    options,
  );
  const defaultBranch = data.default_branch?.trim();

  if (!defaultBranch) {
    throw new RepositoryProviderError(
      "gitlab_default_branch_unavailable",
      "GitLab could not determine the repository default branch.",
      409,
    );
  }

  return {
    externalId: String(data.id),
    defaultBranch,
    displayName: data.path_with_namespace || data.name_with_namespace || data.name,
    visibility: mapGitLabVisibility(data),
  };
}

export async function readGitLabRepositoryTree(
  locator: ParsedRepositoryLocator,
  options?: {
    branch?: string | undefined;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryTreeEntry[]> {
  assertGitLabLocator(locator);
  const ref = options?.branch?.trim();

  if (!ref) {
    throw new RepositoryProviderError(
      "gitlab_branch_required",
      "A GitLab branch is required to preview a repository tree.",
      400,
    );
  }

  const entries: RepositoryTreeEntry[] = [];
  let page = 1;

  for (let pageCount = 0; pageCount < MAX_GITLAB_TREE_PAGES; pageCount += 1) {
    const query = new URLSearchParams({
      page: String(page),
      per_page: String(GITLAB_TREE_PAGE_SIZE),
      recursive: "true",
      ref,
    });
    const { data, response } = await readGitLabJson<GitLabRepositoryTreeEntryResponse[]>(
      locator,
      `/projects/${encodeGitLabProjectPath(locator)}/repository/tree?${query.toString()}`,
      "tree",
      options,
    );

    entries.push(
      ...data
        .map(mapGitLabTreeEntry)
        .filter((entry): entry is RepositoryTreeEntry => entry !== null),
    );

    const nextPageValue = response.headers.get("x-next-page")?.trim();

    if (!nextPageValue) {
      return entries;
    }

    const nextPage = Number(nextPageValue);

    if (!Number.isInteger(nextPage) || nextPage < 1) {
      throw new RepositoryProviderError(
        "gitlab_tree_pagination_invalid",
        "GitLab returned an invalid repository tree pagination cursor.",
        502,
      );
    }

    page = nextPage;
  }

  throw new RepositoryProviderError(
    "gitlab_tree_pagination_exceeded",
    "GitLab returned more repository tree pages than Savant can safely process in one preview request.",
    409,
  );
}

export async function resolveGitLabBranchHeadCommitSha(
  locator: ParsedRepositoryLocator,
  options?: {
    branch?: string | undefined;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<string> {
  assertGitLabLocator(locator);
  const branch = options?.branch?.trim();

  if (!branch) {
    throw new RepositoryProviderError(
      "gitlab_branch_required",
      "A GitLab branch is required to resolve the current repository head.",
      400,
    );
  }

  const { data } = await readGitLabJson<GitLabBranchResponse>(
    locator,
    `/projects/${encodeGitLabProjectPath(locator)}/repository/branches/${encodeURIComponent(branch)}`,
    "branch",
    options,
  );
  const commitSha = data.commit?.id?.trim();

  if (!commitSha) {
    throw new RepositoryProviderError(
      "gitlab_branch_head_unavailable",
      `GitLab could not resolve the current commit for branch '${branch}'.`,
      409,
    );
  }

  return commitSha;
}

export async function readGitLabRepositoryTextFile(
  locator: ParsedRepositoryLocator,
  options: {
    path: string;
    ref: string;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<{ path: string; sha: string; content: string }> {
  assertGitLabLocator(locator);
  const path = options.path.trim();
  const ref = options.ref.trim();

  if (!path) {
    throw new RepositoryProviderError(
      "gitlab_file_path_required",
      "A GitLab file path is required to read repository content.",
      400,
    );
  }

  if (!ref) {
    throw new RepositoryProviderError(
      "gitlab_ref_required",
      "A GitLab ref is required to read repository content.",
      400,
    );
  }

  const { data } = await readGitLabJson<GitLabFileResponse>(
    locator,
    `/projects/${encodeGitLabProjectPath(locator)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    "file",
    options,
  );
  const sha = data.blob_id?.trim();

  if (!sha) {
    throw new RepositoryProviderError(
      "gitlab_file_sha_unavailable",
      `GitLab did not return a blob reference for '${path}'.`,
      409,
    );
  }

  return {
    path: data.file_path,
    sha,
    content: decodeGitLabFileContent(data, path),
  };
}

export async function readGitLabRepositoryIndexSnapshot(
  locator: ParsedRepositoryLocator,
  options?: {
    branch?: string | undefined;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryProviderIndexSnapshot> {
  const metadata = await resolveGitLabRepositoryMetadata(locator, options);
  const defaultBranch = options?.branch?.trim() || metadata.defaultBranch;
  const commitSha = await resolveGitLabBranchHeadCommitSha(locator, {
    branch: defaultBranch,
    fetcher: options?.fetcher,
    signal: options?.signal,
  });
  const tree = await readGitLabRepositoryTree(locator, {
    branch: commitSha,
    fetcher: options?.fetcher,
    signal: options?.signal,
  });
  const observedPaths = [...new Set(tree.map((entry) => entry.path).filter(Boolean))].sort();
  const skillPackageRoots = inferSkillPackageRoots(observedPaths);
  const textFilePaths = new Set<string>([
    ...tenantSkillRepoContract.requiredRegistryFiles,
    ...skillPackageRoots.flatMap((root) => [`${root}/metadata.yaml`, `${root}/SKILL.md`]),
  ]);
  const fileContents: Array<readonly [string, string]> = [];

  for (const path of [...textFilePaths].filter((candidatePath) => observedPaths.includes(candidatePath))) {
    const file = await readGitLabRepositoryTextFile(locator, {
      path,
      ref: commitSha,
      fetcher: options?.fetcher,
      signal: options?.signal,
    });

    fileContents.push([path, file.content] as const);
  }

  return {
    metadata,
    defaultBranch,
    commitSha,
    observedPaths,
    files: Object.fromEntries(fileContents),
  };
}

export async function readGitLabRepositoryPreview(
  locator: ParsedRepositoryLocator,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryProviderPreview> {
  const metadata = await resolveGitLabRepositoryMetadata(locator, options);
  const tree = await readGitLabRepositoryTree(locator, {
    branch: metadata.defaultBranch,
    fetcher: options?.fetcher,
    signal: options?.signal,
  });

  return {
    metadata,
    observedPaths: [...new Set(tree.map((entry) => entry.path).filter(Boolean))].sort(),
  };
}
