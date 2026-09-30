import { resolveRepositoryConnection } from "../git/connection-resolver.ts";
import { GitProviderError } from "../git/errors.ts";
import { toLocator } from "../git/repository-sync-service.ts";
import type { GitRuntime } from "../git/runtime.ts";

/**
 * Read-only access to a connected repository at its current default-branch
 * commit, for background jobs (safety scans, evaluation generation).
 */
export async function openRepositoryFiles(runtime: GitRuntime, organizationId: string, repositoryId: string, revision?: string | null) {
  const repository = await runtime.stores.repositories.getRepository(organizationId, repositoryId);
  if (!repository) {
    throw new GitProviderError("REPOSITORY_NOT_FOUND", "The repository was not found in this workspace.", { status: 404 });
  }
  const resolution = await resolveRepositoryConnection(runtime.stores, { organizationId, repository });
  const resolved = await runtime.broker.resolve({ organizationId, connectionId: resolution.connection.id });
  const locator = toLocator(repository);
  // A pinned revision (e.g. the indexed commit a governed skill was approved at) skips branch resolution.
  const commitSha = revision?.trim() || await resolved.provider.resolveRevision(resolved.credential, locator, repository.defaultBranch || "main");
  let tree: Map<string, number | undefined> | null = null;

  const listFiles = async (): Promise<Map<string, number | undefined>> => {
    tree ??= new Map((await resolved.provider.listTree(resolved.credential, locator, commitSha, { maxEntries: 50_000 }))
      .filter((entry) => entry.kind === "file")
      .map((entry) => [entry.path, entry.size]));
    return tree;
  };

  return {
    repository,
    commitSha,
    listFiles,
    async read(path: string, maxBytes = 512 * 1024): Promise<string | null> {
      const files = await listFiles();
      if (!files.has(path)) {
        return null;
      }
      return (await resolved.provider.readFile(resolved.credential, locator, commitSha, path, { maxBytes })).toString("utf8");
    },
    /** Reads many files with bounded parallelism; missing files are omitted. */
    async readMany(paths: readonly string[], concurrency = 8, maxBytes = 512 * 1024): Promise<Record<string, string>> {
      const result: Record<string, string> = {};
      let next = 0;
      const files = await listFiles();
      const wanted = paths.filter((path) => files.has(path));
      await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, async () => {
        while (next < wanted.length) {
          const path = wanted[next++] as string;
          result[path] = (await resolved.provider.readFile(resolved.credential, locator, commitSha, path, { maxBytes })).toString("utf8");
        }
      }));
      return result;
    },
  };
}
