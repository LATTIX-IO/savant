import { getRepositoryProviderReadiness } from "@savant/types";
import type {
  RepoSyncPayload,
  RepoSyncReason,
  RepoSyncRequest,
  RepositorySyncMode,
} from "@savant/types";

import { buildConnectedRepositoryListItem } from "./repository-connect.ts";
import { serializeControlPlaneTimestamp } from "./read-model-db.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";
import {
  assertTenantWriteAccess,
  type TenantWriteAccessStore,
} from "./tenant-write-access.ts";

export class RepositorySyncError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "RepositorySyncError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type PersistedRepositoryRecord = {
  id: string;
  providerType: string;
  ownerName: string;
  repoName: string;
  canonicalCloneUrl: string | null;
  defaultBranch: string;
  repositoryStatus: string;
  updatedAt: Date | string;
};

type PersistedRepositorySyncState = {
  syncMode: RepositorySyncMode;
  status: string;
  lastIndexedAt: Date | string | null;
  lastSuccessfulSyncAt: Date | string | null;
  lastWebhookAt: Date | string | null;
  nextPollAt: Date | string | null;
};

type RepositorySyncRow = PersistedRepositoryRecord & {
  syncMode: RepositorySyncMode | null;
  syncStatus: string | null;
  lastIndexedAt: Date | string | null;
  lastSuccessfulSyncAt: Date | string | null;
  lastWebhookAt: Date | string | null;
  nextPollAt: Date | string | null;
};

export type RepositorySyncPersistenceInput = {
  organizationId: string;
  actorSubject: string;
  repositoryId: string;
  reason: RepoSyncReason;
  requestedAt: Date;
};

export type RepositorySyncPersistenceResult = {
  accepted: boolean;
  message: string;
  requestedAt: Date | string;
  repository: PersistedRepositoryRecord;
  syncState: PersistedRepositorySyncState;
};

export interface RepositorySyncPersistence {
  requestSync(
    input: RepositorySyncPersistenceInput,
  ): Promise<RepositorySyncPersistenceResult>;
}

function resolveSyncReason(request: RepoSyncRequest): RepoSyncReason {
  return request.reason ?? "manual";
}

function buildRequestedSyncMessage(reason: RepoSyncReason): string {
  return reason === "initial_connect"
    ? "Initial repository sync requested."
    : "Repository sync requested.";
}

async function createDatabaseRepositorySyncPersistence(): Promise<RepositorySyncPersistence> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new RepositorySyncError(
      "repository_sync_unconfigured",
      "DATABASE_URL must be configured before repository sync can be requested.",
      503,
    );
  }

  const sql = getControlPlaneDatabase();

  return {
    requestSync: async (input) => sql.begin(async (tx) => {
      const actorRows = await tx<{ id: string }[]>`
        select id
        from users
        where organization_id = ${input.organizationId}
          and external_subject = ${input.actorSubject}
          and status = 'active'
        limit 1
      `;

      const actorUserId = actorRows[0]?.id;

      if (!actorUserId) {
        throw new RepositorySyncError(
          "tenant_actor_not_found",
          "The current authenticated user could not be resolved inside the selected workspace.",
          403,
        );
      }

      const repositoryRows = await tx<RepositorySyncRow[]>`
        select
          repositories.id,
          repositories.provider_type as "providerType",
          repositories.owner_name as "ownerName",
          repositories.repo_name as "repoName",
          repositories.canonical_clone_url as "canonicalCloneUrl",
          repositories.default_branch as "defaultBranch",
          repositories.status as "repositoryStatus",
          repositories.updated_at as "updatedAt",
          repository_sync_state.sync_mode as "syncMode",
          repository_sync_state.status as "syncStatus",
          repository_sync_state.last_indexed_at as "lastIndexedAt",
          repository_sync_state.last_successful_sync_at as "lastSuccessfulSyncAt",
          repository_sync_state.last_webhook_at as "lastWebhookAt",
          repository_sync_state.next_poll_at as "nextPollAt"
        from repositories
        left join repository_sync_state on repository_sync_state.repository_id = repositories.id
        where repositories.organization_id = ${input.organizationId}
          and repositories.id = ${input.repositoryId}
        limit 1
      `;

      const repositoryRow = repositoryRows[0];

      if (!repositoryRow) {
        throw new RepositorySyncError(
          "repository_not_found",
          `Repository '${input.repositoryId}' was not found.`,
          404,
        );
      }

      if (repositoryRow.repositoryStatus === "disabled") {
        throw new RepositorySyncError(
          "repository_sync_disabled",
          "Repository sync cannot be requested while the repository is disabled.",
          409,
        );
      }

      const providerReadiness = getRepositoryProviderReadiness(repositoryRow.providerType);

      if (!providerReadiness.indexingSupported) {
        throw new RepositorySyncError(
          "repository_sync_provider_unavailable",
          providerReadiness.immediateIndexing.message,
          409,
        );
      }

      const syncMode = repositoryRow.syncMode ?? "manual";

      if (repositoryRow.syncStatus === "indexing") {
        return {
          accepted: false,
          message: "A sync is already in progress for this repository.",
          requestedAt: input.requestedAt,
          repository: {
            id: repositoryRow.id,
            providerType: repositoryRow.providerType,
            ownerName: repositoryRow.ownerName,
            repoName: repositoryRow.repoName,
            canonicalCloneUrl: repositoryRow.canonicalCloneUrl,
            defaultBranch: repositoryRow.defaultBranch,
            repositoryStatus: repositoryRow.repositoryStatus,
            updatedAt: repositoryRow.updatedAt,
          },
          syncState: {
            syncMode,
            status: repositoryRow.syncStatus,
            lastIndexedAt: repositoryRow.lastIndexedAt,
            lastSuccessfulSyncAt: repositoryRow.lastSuccessfulSyncAt,
            lastWebhookAt: repositoryRow.lastWebhookAt,
            nextPollAt: repositoryRow.nextPollAt,
          },
        } satisfies RepositorySyncPersistenceResult;
      }

      const syncStateRows = await tx<PersistedRepositorySyncState[]>`
        insert into repository_sync_state (
          repository_id,
          sync_mode,
          status,
          next_poll_at,
          error_code,
          error_message
        )
        values (
          ${repositoryRow.id},
          ${syncMode},
          'idle',
          ${input.requestedAt},
          null,
          null
        )
        on conflict (repository_id) do update
        set
          next_poll_at = excluded.next_poll_at
        returning
          sync_mode as "syncMode",
          status,
          last_indexed_at as "lastIndexedAt",
          last_successful_sync_at as "lastSuccessfulSyncAt",
          last_webhook_at as "lastWebhookAt",
          next_poll_at as "nextPollAt"
      `;

      const syncState = syncStateRows[0];

      if (!syncState) {
        throw new RepositorySyncError(
          "repository_sync_state_failed",
          "The repository sync request could not be recorded in the control plane.",
          500,
        );
      }

      await tx`
        insert into audit_events (
          organization_id,
          actor_type,
          actor_ref,
          category,
          action,
          target_type,
          target_ref,
          payload_redacted
        )
        values (
          ${input.organizationId},
          'user',
          ${input.actorSubject},
          'repo',
          ${input.reason === 'initial_connect' ? 'repository_initial_sync_requested' : 'repository_sync_requested'},
          'repository',
          ${repositoryRow.id},
          ${tx.json({
            provider: repositoryRow.providerType,
            ownerName: repositoryRow.ownerName,
            repoName: repositoryRow.repoName,
            syncMode: syncState.syncMode,
            requestedAt: input.requestedAt.toISOString(),
            reason: input.reason,
          })}
        )
      `;

      return {
        accepted: true,
        message: buildRequestedSyncMessage(input.reason),
        requestedAt: input.requestedAt,
        repository: {
          id: repositoryRow.id,
          providerType: repositoryRow.providerType,
          ownerName: repositoryRow.ownerName,
          repoName: repositoryRow.repoName,
          canonicalCloneUrl: repositoryRow.canonicalCloneUrl,
          defaultBranch: repositoryRow.defaultBranch,
          repositoryStatus: repositoryRow.repositoryStatus,
          updatedAt: repositoryRow.updatedAt,
        },
        syncState,
      } satisfies RepositorySyncPersistenceResult;
    }),
  };
}

export async function requestTenantRepositorySync(
  input: {
    context: ResolvedTenantContext;
    repositoryId: string;
    request: RepoSyncRequest;
    now?: Date | undefined;
  },
  options?: {
    persistence?: RepositorySyncPersistence | undefined;
    writeAccessStore?: TenantWriteAccessStore | undefined;
  },
): Promise<RepoSyncPayload> {
  if (!input.context.identity) {
    throw new RepositorySyncError(
      "auth_required",
      "Sign in before requesting repository sync.",
      401,
    );
  }

  await assertTenantWriteAccess(
    {
      context: input.context,
      operation: "request repository sync",
    },
    {
      store: options?.writeAccessStore,
    },
  );

  const requestedAt = input.now ?? new Date();
  const persistence = options?.persistence ?? await createDatabaseRepositorySyncPersistence();
  const persisted = await persistence.requestSync({
    organizationId: input.context.tenant.organizationId,
    actorSubject: input.context.identity.subject,
    repositoryId: input.repositoryId,
    reason: resolveSyncReason(input.request),
    requestedAt,
  });

  return {
    accepted: persisted.accepted,
    repository: buildConnectedRepositoryListItem(
      persisted.repository,
      persisted.syncState,
      requestedAt,
    ),
    syncMode: persisted.syncState.syncMode,
    requestedAt: serializeControlPlaneTimestamp(persisted.requestedAt) ?? requestedAt.toISOString(),
    nextPollAt: serializeControlPlaneTimestamp(persisted.syncState.nextPollAt),
    indexedSkillCount: 0,
    warnings: [],
    message: persisted.message,
  };
}