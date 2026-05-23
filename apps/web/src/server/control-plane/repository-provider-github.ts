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

type GitHubRepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  visibility?: "public" | "private" | "internal";
  default_branch: string;
};

type GitHubTreeEntryResponse = {
  path: string;
  type: "blob" | "tree" | "commit";
};

type GitHubTreeResponse = {
  truncated: boolean;
  tree: GitHubTreeEntryResponse[];
};

type GitHubRefResponse = {
  object?: {
    sha?: string;
    type?: string;
  };
};

type GitHubContentResponse = {
  type: "file" | "dir" | "symlink" | "submodule";
  path: string;
  sha: string;
  encoding?: string;
  content?: string;
};

export type GitHubRepositoryIndexSnapshot = RepositoryProviderIndexSnapshot;
export { RepositoryProviderError as RepositoryProviderPreviewError } from "./repository-provider-read.ts";

function createRequestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(5000);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function createGitHubHeaders(): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "savant-control-plane-preview",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function mapGitHubVisibility(payload: GitHubRepositoryResponse): RepositoryProviderMetadata["visibility"] {
  if (payload.visibility === "public" || payload.visibility === "private" || payload.visibility === "internal") {
    return payload.visibility;
  }

  return payload.private ? "private" : "public";
}

function mapGitHubTreeEntry(entry: GitHubTreeEntryResponse): RepositoryTreeEntry | null {
  if (!entry.path || entry.type === "commit") {
    return null;
  }

  return {
    path: entry.path,
    kind: entry.type === "tree" ? "dir" : "file",
  };
}

function mapGitHubHttpError(status: number): RepositoryProviderError {
  if (status === 404) {
    return new RepositoryProviderError(
      "github_repository_unavailable",
      "GitHub could not read that repository preview anonymously. Paste a repository path snapshot or complete provider authorization for private repositories.",
      404,
    );
  }

  if (status === 403) {
    return new RepositoryProviderError(
      "github_rate_limited",
      "GitHub temporarily refused the repository preview request. Try again shortly or paste a repository path snapshot while provider auth is still being wired.",
      503,
    );
  }

  return new RepositoryProviderError(
    "github_preview_failed",
    "GitHub could not provide a repository preview right now.",
    502,
  );
}

function encodeGitHubPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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

function decodeGitHubFileContent(payload: GitHubContentResponse, path: string): string {
  if (payload.type !== "file") {
    throw new RepositoryProviderError(
      "github_file_unavailable",
      `GitHub did not return a regular file for '${path}'.`,
      409,
    );
  }

  if (payload.encoding !== "base64" || typeof payload.content !== "string") {
    throw new RepositoryProviderError(
      "github_file_encoding_unsupported",
      `GitHub returned an unsupported encoding for '${path}'.`,
      409,
    );
  }

  return Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function readGitHubJson<T>(
  path: string,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<T> {
  const fetcher = options?.fetcher ?? fetch;

  try {
    const response = await fetcher(`https://api.github.com${path}`, {
      headers: createGitHubHeaders(),
      signal: createRequestSignal(options?.signal),
    });

    if (!response.ok) {
      throw mapGitHubHttpError(response.status);
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
        "github_preview_timeout",
        "GitHub took too long to return a repository preview.",
        504,
      );
    }

    throw new RepositoryProviderError(
      "github_preview_unavailable",
      "GitHub could not be reached to preview the repository tree.",
      502,
    );
  }
}

function assertGitHubLocator(locator: ParsedRepositoryLocator): {
  owner: string;
  repository: string;
} {
  if (locator.provider !== "github" || !locator.owner || !locator.repository) {
    throw new RepositoryProviderError(
      "invalid_github_repository_locator",
      "A valid GitHub repository locator is required for live repository preview.",
      400,
    );
  }

  return {
    owner: locator.owner,
    repository: locator.repository,
  };
}

export async function resolveGitHubRepositoryMetadata(
  locator: ParsedRepositoryLocator,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryProviderMetadata> {
  const { owner, repository } = assertGitHubLocator(locator);
  const payload = await readGitHubJson<GitHubRepositoryResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    options,
  );

  return {
    externalId: String(payload.id),
    defaultBranch: payload.default_branch,
    displayName: payload.full_name || payload.name,
    visibility: mapGitHubVisibility(payload),
  };
}

export async function readGitHubRepositoryTree(
  locator: ParsedRepositoryLocator,
  options?: {
    branch?: string | undefined;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryTreeEntry[]> {
  const { owner, repository } = assertGitHubLocator(locator);
  const branch = options?.branch?.trim();

  if (!branch) {
    throw new RepositoryProviderError(
      "github_branch_required",
      "A GitHub branch is required to preview a repository tree.",
      400,
    );
  }

  const payload = await readGitHubJson<GitHubTreeResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    options,
  );

  if (payload.truncated) {
    throw new RepositoryProviderError(
      "github_tree_truncated",
      "GitHub returned a truncated repository tree preview. Paste a repository path snapshot or continue after provider-backed sync is available.",
      409,
    );
  }

  return payload.tree
    .map(mapGitHubTreeEntry)
    .filter((entry): entry is RepositoryTreeEntry => entry !== null);
}

export async function resolveGitHubBranchHeadCommitSha(
  locator: ParsedRepositoryLocator,
  options?: {
    branch?: string | undefined;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<string> {
  const { owner, repository } = assertGitHubLocator(locator);
  const branch = options?.branch?.trim();

  if (!branch) {
    throw new RepositoryProviderError(
      "github_branch_required",
      "A GitHub branch is required to resolve the current repository head.",
      400,
    );
  }

  const payload = await readGitHubJson<GitHubRefResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodeURIComponent(branch)}`,
    options,
  );

  if (payload.object?.type !== "commit" || typeof payload.object.sha !== "string" || !payload.object.sha.trim()) {
    throw new RepositoryProviderError(
      "github_branch_head_unavailable",
      `GitHub could not resolve the current commit for branch '${branch}'.`,
      409,
    );
  }

  return payload.object.sha;
}

export async function readGitHubRepositoryTextFile(
  locator: ParsedRepositoryLocator,
  options: {
    path: string;
    ref: string;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<{ path: string; sha: string; content: string }> {
  const { owner, repository } = assertGitHubLocator(locator);
  const path = options.path.trim();
  const ref = options.ref.trim();

  if (!path) {
    throw new RepositoryProviderError(
      "github_file_path_required",
      "A GitHub file path is required to read repository content.",
      400,
    );
  }

  if (!ref) {
    throw new RepositoryProviderError(
      "github_ref_required",
      "A GitHub ref is required to read repository content.",
      400,
    );
  }

  const payload = await readGitHubJson<GitHubContentResponse | GitHubContentResponse[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodeGitHubPath(path)}?ref=${encodeURIComponent(ref)}`,
    options,
  );

  if (Array.isArray(payload)) {
    throw new RepositoryProviderError(
      "github_file_unavailable",
      `GitHub returned a directory listing instead of file content for '${path}'.`,
      409,
    );
  }

  return {
    path: payload.path,
    sha: payload.sha,
    content: decodeGitHubFileContent(payload, path),
  };
}

export async function readGitHubRepositoryIndexSnapshot(
  locator: ParsedRepositoryLocator,
  options?: {
    branch?: string | undefined;
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryProviderIndexSnapshot> {
  const metadata = await resolveGitHubRepositoryMetadata(locator, options);
  const defaultBranch = options?.branch?.trim() || metadata.defaultBranch;
  const commitSha = await resolveGitHubBranchHeadCommitSha(locator, {
    branch: defaultBranch,
    fetcher: options?.fetcher,
    signal: options?.signal,
  });
  const tree = await readGitHubRepositoryTree(locator, {
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
    const file = await readGitHubRepositoryTextFile(locator, {
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

export async function readGitHubRepositoryPreview(
  locator: ParsedRepositoryLocator,
  options?: {
    fetcher?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<RepositoryProviderPreview> {
  const metadata = await resolveGitHubRepositoryMetadata(locator, options);
  const tree = await readGitHubRepositoryTree(locator, {
    branch: metadata.defaultBranch,
    fetcher: options?.fetcher,
    signal: options?.signal,
  });

  return {
    metadata,
    observedPaths: [...new Set(tree.map((entry) => entry.path).filter(Boolean))].sort(),
  };
}