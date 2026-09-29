import { GitProviderError, providerLabel } from "./errors.ts";
import type { GitConnectionRecord, GitConnectionStore, GitRepositoryStore } from "./stores.ts";
import type { ConnectedRepositoryRecord } from "./types.ts";

/**
 * Deterministic repository → provider connection resolution (spec §17, INV-GIT-11):
 *
 *   1. repositories.connection_id
 *   2. repository_connections explicit association
 *   3. legacy migration fallback: exactly one compatible organization connection
 *   4. otherwise CONNECTION_REQUIRED (none) or CONNECTION_AMBIGUOUS (several)
 *
 * Savant never picks "the first" of several credentials.
 */

export type ConnectionResolution = {
  connection: GitConnectionRecord;
  source: "explicit" | "association" | "legacy_fallback";
};

function isCompatible(connection: GitConnectionRecord, repository: ConnectedRepositoryRecord): boolean {
  if (connection.provider !== repository.provider || connection.organizationId !== repository.organizationId) {
    return false;
  }

  // A self-managed GitLab connection can only read repositories on its own host.
  if (connection.providerHost && repository.host && connection.providerHost.toLowerCase() !== repository.host.toLowerCase()) {
    return false;
  }

  return true;
}

export async function resolveRepositoryConnection(
  deps: { connections: GitConnectionStore; repositories: GitRepositoryStore },
  input: { organizationId: string; repository: ConnectedRepositoryRecord },
): Promise<ConnectionResolution> {
  const { organizationId, repository } = input;
  const label = providerLabel(repository.provider);

  if (repository.organizationId !== organizationId) {
    throw new GitProviderError("CONNECTION_NOT_FOUND", "The repository was not found in this workspace.", { status: 404 });
  }

  const explicitId = repository.providerConnectionId ?? (await deps.repositories.getAssociation(organizationId, repository.id))?.connectionId ?? null;

  if (explicitId) {
    const connection = await deps.connections.getConnection(organizationId, explicitId);

    if (!connection || !isCompatible(connection, repository)) {
      throw new GitProviderError(
        "CONNECTION_NOT_FOUND",
        `The ${label} connection associated with ${repository.fullName} no longer exists. Reconnect ${label} and choose this repository again.`,
      );
    }

    return { connection, source: repository.providerConnectionId ? "explicit" : "association" };
  }

  const candidates = (await deps.connections.listConnections(organizationId, { provider: repository.provider }))
    .filter((connection) => connection.status === "active" && isCompatible(connection, repository));

  if (candidates.length === 1) {
    return { connection: candidates[0] as GitConnectionRecord, source: "legacy_fallback" };
  }

  if (candidates.length > 1) {
    throw new GitProviderError(
      "CONNECTION_AMBIGUOUS",
      `Several ${label} connections could access ${repository.fullName}. Choose which ${label} connection should access this repository.`,
    );
  }

  throw new GitProviderError(
    "CONNECTION_REQUIRED",
    `No ${label} connection is available for ${repository.fullName}. Connect ${label} in Settings → Source control.`,
  );
}
