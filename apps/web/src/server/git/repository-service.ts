import { mapRepositorySyncState } from "@savant/types";
import type {
  ConnectedRepositoryResult,
  GitProviderErrorCode,
  RepositorySyncState,
  RepositorySyncStatusPayload,
} from "@savant/types";

import { assertGitPermission, type GitActor } from "./access-control.ts";
import { resolveRepositoryConnection } from "./connection-resolver.ts";
import type { GitCredentialBroker } from "./credential-broker.ts";
import { describeGitRemediation, GitProviderError, providerLabel } from "./errors.ts";
import { logGitEvent } from "./redaction.ts";
import type { GitStores, RepositorySyncRecord } from "./stores.ts";
import type { GitProviderType, ProviderRuntimeContext, RepositoryLocator } from "./types.ts";
import { canonicalRepositoryUrl } from "./url-parsing.ts";

/**
 * Initial-index jobs carry identifiers only — never credentials (spec §8).
 * Implementations dedupe on repositoryId + targetRevision.
 */
export type RepositoryIndexJob = {
  organizationId: string;
  repositoryId: string;
  connectionId: string | null;
  trigger: "initial" | "manual" | "reconciliation";
  targetRevision?: string | null | undefined;
  actorSubject: string;
};

export interface RepositoryIndexScheduler {
  enqueue(job: RepositoryIndexJob): Promise<{ started: boolean; reason?: string | undefined }>;
}

export type SelectedRepository = {
  providerRepositoryId: string;
  /** Discovery hints used to address the repository; identity is verified against the provider id. */
  fullName?: string | undefined;
  owner?: string | undefined;
  name?: string | undefined;
  project?: string | undefined;
};

export function mapSyncState(sync: Pick<RepositorySyncRecord, "status"> | null): RepositorySyncState {
  return mapRepositorySyncState(sync?.status);
}

function locatorFromSelection(provider: GitProviderType, selection: SelectedRepository, host: string): RepositoryLocator | null {
  const segments = (selection.fullName ?? "").split("/").filter(Boolean);
  const name = selection.name ?? segments.at(-1);
  const owner = selection.owner ?? (provider === "azure" ? segments[0] : segments.slice(0, -1).join("/"));
  const project = selection.project ?? (provider === "azure" ? segments[1] : undefined);

  if (!name || !owner) {
    return null;
  }

  return {
    provider,
    host,
    owner,
    ...(project ? { project } : {}),
    name,
    fullName: project ? `${owner}/${project}/${name}` : `${owner}/${name}`,
    providerRepositoryId: selection.providerRepositoryId,
  };
}

export function createGitRepositoryService(deps: {
  stores: GitStores;
  broker: GitCredentialBroker;
  scheduler: RepositoryIndexScheduler;
  context?: ProviderRuntimeContext | undefined;
}) {
  const { stores, broker, scheduler } = deps;

  return {
    /**
     * Repository connect transaction (spec §15): validate membership and
     * connection, resolve the credential, validate read access, read
     * metadata, persist repository + association, audit, and enqueue the
     * initial index. Idempotent on (organization, provider, provider repo id).
     */
    async connectSelectedRepositories(actor: GitActor, input: { connectionId: string; repositories: SelectedRepository[] }): Promise<{
      connected: ConnectedRepositoryResult[];
      failed: Array<{ providerRepositoryId: string; errorCode: GitProviderErrorCode; message: string }>;
    }> {
      assertGitPermission(actor, "connect_repository");

      if (input.repositories.length === 0 || input.repositories.length > 100) {
        throw new GitProviderError("INVALID_REQUEST", "Select between 1 and 100 repositories to connect.");
      }

      const resolved = await broker.resolve({ organizationId: actor.organizationId, connectionId: input.connectionId }, deps.context);
      const { provider, credential, connection } = resolved;
      const connected: ConnectedRepositoryResult[] = [];
      const failed: Array<{ providerRepositoryId: string; errorCode: GitProviderErrorCode; message: string }> = [];
      const seen = new Set<string>();

      for (const selection of input.repositories) {
        const providerRepositoryId = selection.providerRepositoryId?.trim();
        if (!providerRepositoryId || seen.has(providerRepositoryId)) {
          continue;
        }
        seen.add(providerRepositoryId);

        try {
          const locator = locatorFromSelection(connection.provider, { ...selection, providerRepositoryId }, credential.host)
            ?? { provider: connection.provider, host: credential.host, owner: "", name: "", fullName: providerRepositoryId, providerRepositoryId };
          const access = await provider.validateRepositoryAccess(credential, locator, deps.context);

          if (!access.accessible || !access.repository) {
            throw new GitProviderError(access.errorCode ?? "REPOSITORY_ACCESS_DENIED", access.message ?? `${provider.label} authorization cannot read that repository.`);
          }

          const repository = access.repository;
          if (repository.providerRepositoryId !== providerRepositoryId) {
            // The hints pointed at a different repository than the one selected.
            throw new GitProviderError("REPOSITORY_NOT_FOUND", "The selected repository no longer matches the provider's records. Refresh the list.");
          }

          const { repository: saved, created } = await stores.repositories.upsertRepository(actor.organizationId, {
            provider: connection.provider,
            providerRepositoryId,
            connectionId: connection.id,
            host: repository.host,
            owner: repository.owner,
            project: repository.project ?? null,
            name: repository.name,
            defaultBranch: repository.defaultBranch ?? "main",
            visibility: repository.isPrivate ? "private" : "public",
            canonicalUrl: canonicalRepositoryUrl({ ...locator, owner: repository.owner, name: repository.name, ...(repository.project ? { project: repository.project } : {}) }),
            actorSubject: actor.subject,
          });

          await stores.audit.record({
            organizationId: actor.organizationId,
            actorType: "user",
            actorRef: actor.subject,
            action: created ? "repository_connected" : "repository_connection_updated",
            targetType: "repository",
            targetRef: saved.id,
            payload: {
              provider: connection.provider,
              connection_id: connection.id,
              repository_id: saved.id,
              provider_repository_id: providerRepositoryId,
              repository_name: repository.fullName,
            },
          }).catch(() => undefined);

          // Connecting always causes an initial indexing attempt (INV-GIT-05);
          // indexing success is reported separately through sync state.
          let indexing: ConnectedRepositoryResult["indexing"];
          try {
            indexing = await scheduler.enqueue({
              organizationId: actor.organizationId,
              repositoryId: saved.id,
              connectionId: connection.id,
              trigger: "initial",
              targetRevision: repository.defaultBranch,
              actorSubject: actor.subject,
            });
          } catch (error) {
            logGitEvent("error", "initial_index_enqueue_failed", { repository_id: saved.id, error });
            indexing = { started: false, reason: "Initial indexing could not be scheduled. Use Sync to retry." };
          }

          connected.push({
            repository: {
              id: saved.id,
              name: repository.fullName,
              provider: connection.provider,
              providerRepositoryId,
              connectionId: connection.id,
              syncState: indexing.started ? "indexing" : "pending",
              created,
            },
            indexing,
          });
        } catch (error) {
          const normalized = error instanceof GitProviderError ? error : new GitProviderError("INDEX_FAILED", "The repository could not be connected.");
          failed.push({ providerRepositoryId, errorCode: normalized.code, message: normalized.message });
        }
      }

      return { connected, failed };
    },

    /** Repository removal is independent of provider removal (spec §22). */
    async removeRepository(actor: GitActor, repositoryId: string): Promise<{ removedSkillCount: number }> {
      assertGitPermission(actor, "disconnect_repository");
      const repository = await stores.repositories.getRepository(actor.organizationId, repositoryId);
      if (!repository) {
        throw new GitProviderError("REPOSITORY_NOT_FOUND", "The repository was not found in this workspace.", { status: 404 });
      }

      const removed = await stores.repositories.deleteRepository(actor.organizationId, repositoryId);
      if (!removed) {
        throw new GitProviderError("REPOSITORY_NOT_FOUND", "The repository was not found in this workspace.", { status: 404 });
      }

      await stores.audit.record({
        organizationId: actor.organizationId,
        actorType: "user",
        actorRef: actor.subject,
        action: "repository_disconnected",
        targetType: "repository",
        targetRef: repositoryId,
        payload: {
          provider: repository.provider,
          repository_id: repositoryId,
          connection_id: repository.providerConnectionId,
          provider_repository_id: repository.providerRepositoryId,
          skill_count: removed.removedSkillCount,
          repository_name: repository.fullName,
        },
      }).catch(() => undefined);

      return removed;
    },

    async getSyncStatus(actor: GitActor, repositoryId: string): Promise<RepositorySyncStatusPayload> {
      assertGitPermission(actor, "view");
      const repository = await stores.repositories.getRepository(actor.organizationId, repositoryId);
      if (!repository) {
        throw new GitProviderError("REPOSITORY_NOT_FOUND", "The repository was not found in this workspace.", { status: 404 });
      }

      const sync = await stores.repositories.getSyncState(actor.organizationId, repositoryId);
      let connection: RepositorySyncStatusPayload["connection"] = null;
      let resolutionError: GitProviderError | null = null;

      try {
        const resolution = await resolveRepositoryConnection(stores, { organizationId: actor.organizationId, repository });
        connection = {
          id: resolution.connection.id,
          provider: resolution.connection.provider,
          displayName: resolution.connection.displayName,
          status: resolution.connection.status,
          isLegacy: resolution.connection.authType === "legacy_env",
        };
      } catch (error) {
        resolutionError = error instanceof GitProviderError ? error : null;
      }

      const errorCode = sync?.errorCode ?? (resolutionError && repository.visibility !== "public" ? resolutionError.code : null);
      const syncState = mapSyncState(sync);

      return {
        repositoryId,
        syncState,
        indexedAt: sync?.lastIndexedAt ?? null,
        lastSyncAt: sync?.lastSuccessfulSyncAt ?? null,
        skillCount: sync?.skillCount ?? 0,
        errorCode,
        message: syncState === "ready" || syncState === "indexing" ? null : (sync?.errorMessage ?? resolutionError?.message ?? null),
        remediation: syncState === "ready" || syncState === "indexing"
          ? (connection?.isLegacy ? `This repository uses a deployment-managed credential. Reauthorize using the Savant ${providerLabel(repository.provider)} integration.` : null)
          : describeGitRemediation({ code: errorCode, provider: repository.provider, repositoryName: repository.fullName }),
        connection,
      };
    },
  };
}

export type GitRepositoryService = ReturnType<typeof createGitRepositoryService>;
