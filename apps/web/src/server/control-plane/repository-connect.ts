import {
  getPreferredRepositorySyncMode,
  getRepositoryProviderReadiness,
  supportsRepositorySyncMode,
} from "@savant/types";
import type {
  RepoConnectPayload,
  RepoConnectRequest,
  RepoContractValidationPayload,
  RepositoryListItem,
  RepositorySyncMode,
} from "@savant/types";

import {
  buildRepositoryProjectionMetadata,
  formatRelativeControlPlaneTime,
  mapRepositorySyncStatus,
} from "./read-model-db.ts";
import { buildRepositoryWebUrl } from "../../lib/repository-links.ts";
import {
  RepositoryProviderConnectionError,
  resolveRepositoryProviderConnection,
} from "./repository-provider-connection.ts";
import {
  type ParsedRepositoryLocator,
  type RepositoryProviderMetadata,
} from "./repository-provider.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";
import {
  assertTenantWriteAccess,
  type TenantWriteAccessStore,
} from "./tenant-write-access.ts";

export class RepositoryConnectError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "RepositoryConnectError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type PersistedRepositoryRecord = {
  id: string;
  providerType: RepoConnectRequest["provider"];
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
};

export type RepositoryConnectPersistenceInput = {
  organizationId: string;
  actorSubject: string;
  connectionId: string | null;
  provider: RepoConnectRequest["provider"];
  ownerName: string;
  repoName: string;
  canonicalCloneUrl: string;
  externalRepoId: string | null;
  defaultBranch: string;
  visibility: RepositoryProviderMetadata["visibility"];
  syncMode: RepositorySyncMode;
  validation: RepoContractValidationPayload;
};

export type RepositoryConnectPersistenceResult = {
  created: boolean;
  repository: PersistedRepositoryRecord;
  syncState: PersistedRepositorySyncState;
};

export interface RepositoryConnectPersistence {
  persistConnection(
    input: RepositoryConnectPersistenceInput,
  ): Promise<RepositoryConnectPersistenceResult>;
}

export type RepositoryConnectionBindingResolver = (
  input: {
    organizationId: string;
    provider: RepoConnectRequest["provider"];
    requestedConnectionId?: string | undefined;
  },
) => Promise<string | null>;

function resolveConnectSyncMode(request: RepoConnectRequest): RepositorySyncMode {
  const requested = request.syncMode;
  const readiness = getRepositoryProviderReadiness(request.provider);

  if (requested) {
    if (!supportsRepositorySyncMode(readiness, requested)) {
      throw new RepositoryConnectError(
        "repository_sync_mode_unsupported",
        requested === "webhook"
          ? readiness.webhookRegistration.message
          : readiness.immediateIndexing.message,
        409,
      );
    }

    return requested;
  }

  return getPreferredRepositorySyncMode(readiness);
}

function assertConnectReady(validation: RepoContractValidationPayload) {
  if (validation.ready) {
    return;
  }

  throw new RepositoryConnectError(
    "repository_contract_not_ready",
    "Repository contract validation must succeed before the repository can be connected.",
    409,
    validation.nextSteps.join(" ") || undefined,
  );
}

function assertRepositoryLocator(
  locator: ParsedRepositoryLocator,
): { ownerName: string; repoName: string } {
  if (!locator.owner || !locator.repository) {
    throw new RepositoryConnectError(
      "invalid_repository_locator",
      "A concrete repository owner and repository name are required before a repository can be connected.",
      400,
    );
  }

  return {
    ownerName: locator.owner,
    repoName: locator.repository,
  };
}

async function defaultResolveRepositoryConnectionBinding(
  input: {
    organizationId: string;
    provider: RepoConnectRequest["provider"];
    requestedConnectionId?: string | undefined;
  },
): Promise<string | null> {
  try {
    const connection = await resolveRepositoryProviderConnection({
      organizationId: input.organizationId,
      provider: input.provider,
      connectionId: input.requestedConnectionId,
    });

    return connection.id;
  } catch (error) {
    if (error instanceof RepositoryProviderConnectionError) {
      if (input.requestedConnectionId) {
        throw new RepositoryConnectError(
          error.code,
          error.message,
          error.status,
          error.details,
        );
      }

      if (
        error.code === "repository_provider_connection_required"
        || error.code === "repository_provider_connection_ambiguous"
        || error.code === "repository_provider_connection_unsupported"
      ) {
        return null;
      }
    }

    throw error;
  }
}

export function buildConnectedRepositoryListItem(
  repository: PersistedRepositoryRecord,
  syncState: PersistedRepositorySyncState,
  now = new Date(),
  skillCount = 0,
): RepositoryListItem {
  const lastActivityAt =
    syncState.lastSuccessfulSyncAt ??
    syncState.lastWebhookAt ??
    syncState.lastIndexedAt ??
    repository.updatedAt;

  return {
    id: repository.id,
    provider: repository.providerType,
    providerReadiness: getRepositoryProviderReadiness(repository.providerType),
    name: `${repository.ownerName}/${repository.repoName}`,
    webUrl: buildRepositoryWebUrl({
      provider: repository.providerType,
      name: `${repository.ownerName}/${repository.repoName}`,
      canonicalCloneUrl: repository.canonicalCloneUrl,
    }),
    branch: repository.defaultBranch,
    skills: skillCount,
    lastSync: formatRelativeControlPlaneTime(lastActivityAt, now),
    status: mapRepositorySyncStatus(repository.repositoryStatus, syncState.status),
    projection: buildRepositoryProjectionMetadata({
      last_indexed_at: syncState.lastIndexedAt,
      last_successful_sync_at: syncState.lastSuccessfulSyncAt,
      last_webhook_at: syncState.lastWebhookAt,
    }),
  };
}

async function createDatabaseRepositoryConnectPersistence(): Promise<RepositoryConnectPersistence> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new RepositoryConnectError(
      "repository_persistence_unconfigured",
      "DATABASE_URL must be configured before repositories can be connected.",
      503,
    );
  }

  const sql = getControlPlaneDatabase();

  return {
    persistConnection: async (input) => sql.begin(async (tx) => {
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
        throw new RepositoryConnectError(
          "tenant_actor_not_found",
          "The current authenticated user could not be resolved inside the selected workspace.",
          403,
        );
      }

      const existingRows = await tx<{ id: string }[]>`
        select id
        from repositories
        where organization_id = ${input.organizationId}
          and provider_type = ${input.provider}
          and lower(owner_name) = lower(${input.ownerName})
          and lower(repo_name) = lower(${input.repoName})
        limit 1
      `;

      const existingId = existingRows[0]?.id;
      const repositoryRows = existingId
        ? await tx<PersistedRepositoryRecord[]>`
            update repositories
            set
              connection_id = coalesce(${input.connectionId}, repositories.connection_id),
              external_repo_id = coalesce(${input.externalRepoId}, repositories.external_repo_id),
              owner_name = ${input.ownerName},
              repo_name = ${input.repoName},
              default_branch = ${input.defaultBranch},
              visibility = case
                when ${input.visibility} = 'unknown' then repositories.visibility
                else ${input.visibility}
              end,
              canonical_clone_url = ${input.canonicalCloneUrl},
              status = 'connected',
              created_by = coalesce(repositories.created_by, ${actorUserId}),
              updated_at = now()
            where id = ${existingId}
            returning
              id,
              provider_type as "providerType",
              owner_name as "ownerName",
              repo_name as "repoName",
              canonical_clone_url as "canonicalCloneUrl",
              default_branch as "defaultBranch",
              status as "repositoryStatus",
              updated_at as "updatedAt"
          `
        : await tx<PersistedRepositoryRecord[]>`
            insert into repositories (
              organization_id,
              connection_id,
              provider_type,
              external_repo_id,
              owner_name,
              repo_name,
              default_branch,
              visibility,
              canonical_clone_url,
              status,
              created_by
            )
            values (
              ${input.organizationId},
              ${input.connectionId},
              ${input.provider},
              ${input.externalRepoId},
              ${input.ownerName},
              ${input.repoName},
              ${input.defaultBranch},
              ${input.visibility},
              ${input.canonicalCloneUrl},
              'connected',
              ${actorUserId}
            )
            returning
              id,
              provider_type as "providerType",
              owner_name as "ownerName",
              repo_name as "repoName",
              canonical_clone_url as "canonicalCloneUrl",
              default_branch as "defaultBranch",
              status as "repositoryStatus",
              updated_at as "updatedAt"
          `;

      const repository = repositoryRows[0];

      if (!repository) {
        throw new RepositoryConnectError(
          "repository_connect_failed",
          "The repository could not be persisted in the control plane.",
          500,
        );
      }

      const nextPollAt = input.syncMode === "poll"
        ? new Date(Date.now() + 5 * 60 * 1000)
        : null;

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
          ${repository.id},
          ${input.syncMode},
          'idle',
          ${nextPollAt},
          null,
          null
        )
        on conflict (repository_id) do update
        set
          sync_mode = excluded.sync_mode,
          status = case
            when repository_sync_state.status = 'error' then 'idle'
            else repository_sync_state.status
          end,
          next_poll_at = excluded.next_poll_at,
          error_code = null,
          error_message = null
        returning
          sync_mode as "syncMode",
          status,
          last_indexed_at as "lastIndexedAt",
          last_successful_sync_at as "lastSuccessfulSyncAt",
          last_webhook_at as "lastWebhookAt"
      `;

      const syncState = syncStateRows[0];

      if (!syncState) {
        throw new RepositoryConnectError(
          "repository_sync_state_failed",
          "The repository sync state could not be persisted in the control plane.",
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
          ${existingId ? "repository_connection_updated" : "repository_connected"},
          'repository',
          ${repository.id},
          ${tx.json({
            provider: input.provider,
            ownerName: input.ownerName,
            repoName: input.repoName,
            syncMode: input.syncMode,
            observedPathCount: input.validation.summary.observedPathCount,
            discoveredSkillPackageCount: input.validation.summary.discoveredSkillPackageCount,
          })}
        )
      `;

      return {
        created: !existingId,
        repository,
        syncState,
      } satisfies RepositoryConnectPersistenceResult;
    }),
  };
}

export async function connectTenantRepository(
  input: {
    context: ResolvedTenantContext;
    request: RepoConnectRequest;
    validation: RepoContractValidationPayload;
    locator: ParsedRepositoryLocator;
    metadata?: RepositoryProviderMetadata | undefined;
    connectionId?: string | undefined;
    now?: Date | undefined;
  },
  options?: {
    persistence?: RepositoryConnectPersistence | undefined;
    writeAccessStore?: TenantWriteAccessStore | undefined;
    resolveConnectionBinding?: RepositoryConnectionBindingResolver | undefined;
  },
): Promise<RepoConnectPayload> {
  if (!input.context.identity) {
    throw new RepositoryConnectError(
      "auth_required",
      "Sign in before connecting a repository.",
      401,
    );
  }

  await assertTenantWriteAccess(
    {
      context: input.context,
      operation: "connect or update repositories",
    },
    {
      store: options?.writeAccessStore,
    },
  );

  assertConnectReady(input.validation);

  const syncMode = resolveConnectSyncMode(input.request);
  const { ownerName, repoName } = assertRepositoryLocator(input.locator);
  const connectionId = input.connectionId
    ?? await (options?.resolveConnectionBinding ?? defaultResolveRepositoryConnectionBinding)({
      organizationId: input.context.tenant.organizationId,
      provider: input.request.provider,
      requestedConnectionId: input.request.connectionId,
    });
  const persistence = options?.persistence ?? await createDatabaseRepositoryConnectPersistence();
  const persisted = await persistence.persistConnection({
    organizationId: input.context.tenant.organizationId,
    actorSubject: input.context.identity.subject,
    connectionId,
    provider: input.request.provider,
    ownerName,
    repoName,
    canonicalCloneUrl: input.locator.normalizedUrl,
    externalRepoId: input.metadata?.externalId ?? null,
    defaultBranch: input.request.defaultBranch,
    visibility: input.metadata?.visibility ?? "unknown",
    syncMode,
    validation: input.validation,
  });

  return {
    created: persisted.created,
    repository: buildConnectedRepositoryListItem(
      persisted.repository,
      persisted.syncState,
      input.now ?? new Date(),
    ),
    warnings: [],
  };
}
