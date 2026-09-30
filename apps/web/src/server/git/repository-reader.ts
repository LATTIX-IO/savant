import { tenantSkillRepoContract } from "@savant/schemas/tenant-skill-repo-contract";

import { GitProviderError } from "./errors.ts";
import { withGitSpan, type SpanHandle } from "./observability.ts";
import type { Env } from "./secret-vault.ts";
import type {
  GitProvider,
  ProviderRepository,
  ProviderRuntimeContext,
  RepositoryLocator,
  RuntimeCredential,
} from "./types.ts";

/**
 * Provider-independent repository reader used by the skill indexer. It reads
 * only what skill ingestion needs — tree, registry files, and skill manifests —
 * instead of cloning (spec §32). The provider contract still allows a future
 * shallow-clone implementation behind the same interface.
 */

export type RepositoryReadLimits = {
  maxTreeEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxSkillCount: number;
  maxDepth: number;
  readConcurrency: number;
};

function readPositiveInt(env: Env, key: string, fallback: number): number {
  const value = Number(env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function readRepositoryReadLimits(env: Env = process.env): RepositoryReadLimits {
  return {
    maxTreeEntries: readPositiveInt(env, "GIT_SYNC_MAX_TREE_ENTRIES", 50_000),
    maxFileBytes: readPositiveInt(env, "GIT_SYNC_MAX_FILE_BYTES", 1024 * 1024),
    maxTotalBytes: readPositiveInt(env, "GIT_SYNC_MAX_TOTAL_BYTES", 25 * 1024 * 1024),
    maxSkillCount: readPositiveInt(env, "GIT_SYNC_MAX_SKILLS", 1_000),
    maxDepth: readPositiveInt(env, "GIT_SYNC_MAX_DEPTH", 12),
    readConcurrency: Math.min(readPositiveInt(env, "GIT_SYNC_READ_CONCURRENCY", 8), 32),
  };
}

/** Skill package roots per the tenant skill repository contract layout. */
export function inferSkillPackageRoots(paths: readonly string[]): string[] {
  const discovered = new Set<string>();

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);

    if (parts[0] === "tier1" && parts[1] === "standards" && parts[2]) {
      discovered.add(parts.slice(0, 3).join("/"));
    } else if (parts[0] === "tier2" && parts[1] === "methodology" && parts[2] && parts[3]) {
      discovered.add(parts.slice(0, 4).join("/"));
    } else if (parts[0] === "tier3" && (parts[1] === "personal" || parts[1] === "workflow") && parts[2] && parts[3]) {
      discovered.add(parts.slice(0, 4).join("/"));
    }
  }

  return [...discovered].sort();
}

export type RepositorySnapshot = {
  repository: ProviderRepository;
  defaultBranch: string;
  commitSha: string;
  observedPaths: string[];
  files: Record<string, string>;
  skillRootCount: number;
  bytesRead: number;
};

export async function readRepositorySnapshot(input: {
  provider: GitProvider;
  credential: RuntimeCredential;
  locator: RepositoryLocator;
  ref?: string | null | undefined;
  limits?: RepositoryReadLimits | undefined;
  context?: ProviderRuntimeContext | undefined;
  span?: SpanHandle | null | undefined;
}): Promise<RepositorySnapshot> {
  const { provider, credential, context } = input;
  const limits = input.limits ?? readRepositoryReadLimits();
  const parent = input.span ?? null;

  const access = await withGitSpan("provider.repository.validate", { provider: provider.type }, async () =>
    provider.validateRepositoryAccess(credential, input.locator, context), parent);

  if (!access.accessible || !access.repository) {
    throw new GitProviderError(
      access.errorCode ?? "REPOSITORY_ACCESS_DENIED",
      access.message ?? `${provider.label} authorization does not provide access to ${input.locator.fullName}.`,
      { provider: provider.type },
    );
  }

  const repository = access.repository;
  // Re-address by the provider's current name so renamed repositories keep syncing.
  const locator: RepositoryLocator = {
    ...input.locator,
    owner: repository.owner,
    name: repository.name,
    fullName: repository.fullName,
    ...(repository.project ? { project: repository.project } : {}),
    providerRepositoryId: repository.providerRepositoryId,
  };
  const defaultBranch = input.ref?.trim() || repository.defaultBranch || await provider.getDefaultBranch(credential, locator, context);
  const commitSha = await provider.resolveRevision(credential, locator, defaultBranch, context);

  const tree = await withGitSpan("provider.tree.read", { provider: provider.type, revision: commitSha }, async (span) => {
    const entries = await provider.listTree(credential, locator, commitSha, {
      ...context,
      maxEntries: limits.maxTreeEntries,
      maxDepth: limits.maxDepth,
    });
    span.setAttribute("entry_count", entries.length);
    return entries;
  }, parent);

  if (tree.length > limits.maxTreeEntries) {
    throw new GitProviderError("INDEX_FAILED", `${repository.fullName} has more than ${limits.maxTreeEntries} tree entries.`, { status: 413 });
  }

  const observedPaths = [...new Set(tree.filter((entry) => entry.path.split("/").length <= limits.maxDepth).map((entry) => entry.path))].sort();
  const observed = new Set(observedPaths);

  return withGitSpan("skill.discovery", { provider: provider.type }, async (span) => {
    const skillRoots = inferSkillPackageRoots(observedPaths);
    if (skillRoots.length > limits.maxSkillCount) {
      throw new GitProviderError("INDEX_FAILED", `${repository.fullName} declares more than ${limits.maxSkillCount} skills.`, { status: 413 });
    }

    const wanted = [
      ...tenantSkillRepoContract.requiredRegistryFiles,
      ...skillRoots.flatMap((root) => [
        `${root}/metadata.yaml`,
        `${root}/SKILL.md`,
        // Evaluation assets for the import-time baseline.
        `${root}/eval/dataset.yaml`,
        `${root}/eval/rubric.yaml`,
        `${root}/eval/baseline.json`,
      ]),
    ].filter((path, index, all) => observed.has(path) && all.indexOf(path) === index);

    const contents = new Map<string, string>();
    let bytesRead = 0;
    let next = 0;

    // Bounded parallelism keeps large repositories within serverless time
    // limits without bursting provider rate limits.
    async function worker() {
      while (next < wanted.length) {
        const path = wanted[next++] as string;
        const content = await provider.readFile(credential, locator, commitSha, path, { ...context, maxBytes: limits.maxFileBytes });
        bytesRead += content.length;
        if (bytesRead > limits.maxTotalBytes) {
          throw new GitProviderError("INDEX_FAILED", `Reading ${repository.fullName} exceeded the ${limits.maxTotalBytes}-byte sync budget.`, { status: 413 });
        }
        contents.set(path, content.toString("utf8"));
      }
    }

    await Promise.all(Array.from({ length: Math.min(limits.readConcurrency, wanted.length) }, () => worker()));

    // Deterministic key order regardless of completion order.
    const files: Record<string, string> = {};
    for (const path of wanted) {
      const content = contents.get(path);
      if (content !== undefined) {
        files[path] = content;
      }
    }

    span.setAttribute("file_count", Object.keys(files).length);
    span.setAttribute("skill_count", skillRoots.length);

    return {
      repository,
      defaultBranch,
      commitSha,
      observedPaths,
      files,
      skillRootCount: skillRoots.length,
      bytesRead,
    };
  }, parent);
}
