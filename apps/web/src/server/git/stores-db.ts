import type { TransactionSql } from "postgres";

import type { ControlPlaneSql } from "../control-plane/database.ts";
import { GitProviderError } from "./errors.ts";
import { sanitizeGitAuditPayload } from "./redaction.ts";
import type {
  GitAuditSink,
  GitConnectionRecord,
  GitConnectionStore,
  GitRepositoryStore,
  GitStores,
  OAuthStateRecord,
  OAuthStateStore,
  RepositorySyncRecord,
  StoredSecret,
} from "./stores.ts";
import type { ConnectedRepositoryRecord, GitProviderType } from "./types.ts";

type Sql = ControlPlaneSql | TransactionSql;

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type ConnectionRow = {
  id: string;
  organization_id: string;
  provider_type: GitProviderType;
  display_name: string;
  auth_type: GitConnectionRecord["authType"];
  status: GitConnectionRecord["status"];
  provider_host: string | null;
  provider_account_id: string | null;
  provider_account_name: string | null;
  provider_installation_id: string | null;
  provider_scope: string | null;
  secret_id: string | null;
  credentials_ref: string | null;
  scopes: unknown;
  last_validated_at: Date | null;
  last_error_code: string | null;
  last_error_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapConnection(row: ConnectionRow): GitConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider_type,
    displayName: row.display_name,
    authType: row.auth_type,
    status: row.status,
    providerHost: row.provider_host,
    providerAccountId: row.provider_account_id,
    providerAccountName: row.provider_account_name,
    providerInstallationId: row.provider_installation_id,
    providerScope: row.provider_scope,
    secretId: row.secret_id,
    credentialsRef: row.credentials_ref,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    lastValidatedAt: iso(row.last_validated_at),
    lastErrorCode: row.last_error_code,
    lastErrorAt: iso(row.last_error_at),
    createdBy: row.created_by,
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
  };
}

const CONNECTION_COLUMNS = `
  id, organization_id, provider_type, display_name, auth_type, status, provider_host,
  provider_account_id, provider_account_name, provider_installation_id, provider_scope,
  secret_id, credentials_ref, scopes, last_validated_at, last_error_code, last_error_at,
  created_by, created_at, updated_at
`;

function createConnectionStore(sql: Sql, root: ControlPlaneSql): GitConnectionStore {
  const store: GitConnectionStore = {
    async listConnections(organizationId, filter) {
      const rows = await sql<ConnectionRow[]>`
        select ${sql.unsafe(CONNECTION_COLUMNS)}
        from git_provider_connections
        where organization_id = ${organizationId}
          and (${filter?.provider ?? null}::text is null or provider_type = ${filter?.provider ?? null})
          and (${filter?.includeDisconnected ?? false} or status <> 'disconnected')
          and provider_type in ('github', 'gitlab', 'bitbucket', 'azure')
        order by created_at asc
      `;
      return rows.map(mapConnection);
    },

    async getConnection(organizationId, connectionId) {
      if (!isUuid(connectionId)) {
        return null;
      }
      const rows = await sql<ConnectionRow[]>`
        select ${sql.unsafe(CONNECTION_COLUMNS)}
        from git_provider_connections
        where organization_id = ${organizationId} and id = ${connectionId}
        limit 1
      `;
      return rows[0] ? mapConnection(rows[0]) : null;
    },

    async upsertConnection(organizationId, input) {
      const actorLookup = sql`(
        select id from users
        where organization_id = ${organizationId} and external_subject = ${input.createdBySubject}
        limit 1
      )`;

      if (input.connectionId) {
        const rows = await sql<ConnectionRow[]>`
          update git_provider_connections
          set
            display_name = ${input.displayName},
            auth_type = ${input.authType},
            provider_host = ${input.providerHost},
            provider_account_id = ${input.providerAccountId},
            provider_account_name = ${input.providerAccountName},
            provider_installation_id = ${input.providerInstallationId},
            provider_scope = ${input.providerScope},
            scopes = ${sql.json(input.scopes)},
            status = 'active',
            -- credentials_ref is kept: repository write operations still use the
            -- deployment-managed credential of a converted legacy connection.
            last_error_code = null,
            last_error_at = null,
            last_validated_at = now(),
            disconnected_at = null,
            updated_at = now()
          where organization_id = ${organizationId} and id = ${input.connectionId}
          returning ${sql.unsafe(CONNECTION_COLUMNS)}
        `;
        if (!rows[0]) {
          throw new GitProviderError("CONNECTION_NOT_FOUND", "The connection being reauthorized no longer exists.");
        }
        return { connection: mapConnection(rows[0]), created: false };
      }

      const accountKey = input.providerInstallationId ?? input.providerAccountId;
      const existing = accountKey
        ? await sql<{ id: string }[]>`
            select id from git_provider_connections
            where organization_id = ${organizationId}
              and provider_type = ${input.provider}
              and coalesce(provider_host, '') = ${input.providerHost ?? ""}
              and coalesce(provider_installation_id, provider_account_id) = ${accountKey}
              and status <> 'disconnected'
            limit 1
          `
        : [];

      if (existing[0]) {
        return store.upsertConnection(organizationId, { ...input, connectionId: existing[0].id });
      }

      const rows = await sql<ConnectionRow[]>`
        insert into git_provider_connections (
          organization_id, provider_type, display_name, auth_type, provider_host,
          provider_account_id, provider_account_name, provider_installation_id, provider_scope,
          scopes, status, last_validated_at, created_by
        )
        values (
          ${organizationId}, ${input.provider}, ${input.displayName}, ${input.authType}, ${input.providerHost},
          ${input.providerAccountId}, ${input.providerAccountName}, ${input.providerInstallationId}, ${input.providerScope},
          ${sql.json(input.scopes)}, 'active', now(), ${actorLookup}
        )
        returning ${sql.unsafe(CONNECTION_COLUMNS)}
      `;
      return { connection: mapConnection(rows[0] as ConnectionRow), created: true };
    },

    async updateConnection(organizationId, connectionId, patch) {
      const rows = await sql<ConnectionRow[]>`
        update git_provider_connections
        set
          status = coalesce(${patch.status ?? null}, status),
          last_validated_at = case when ${patch.lastValidatedAt !== undefined} then ${patch.lastValidatedAt ?? null}::timestamptz else last_validated_at end,
          last_error_code = case when ${patch.lastErrorCode !== undefined} then ${patch.lastErrorCode ?? null} else last_error_code end,
          last_error_at = case when ${patch.lastErrorAt !== undefined} then ${patch.lastErrorAt ?? null}::timestamptz else last_error_at end,
          disconnected_at = case when ${patch.status === "disconnected"} then now() else disconnected_at end,
          updated_at = now()
        where organization_id = ${organizationId} and id = ${connectionId}
        returning ${sql.unsafe(CONNECTION_COLUMNS)}
      `;
      return rows[0] ? mapConnection(rows[0]) : null;
    },

    async countRepositories(organizationId, connectionIds) {
      if (connectionIds.length === 0) {
        return {};
      }
      const rows = await sql<{ connection_id: string; count: number }[]>`
        select connection_id, count(*)::int as count
        from repositories
        where organization_id = ${organizationId} and connection_id = any(${connectionIds}::uuid[])
        group by connection_id
      `;
      return Object.fromEntries(rows.map((row) => [row.connection_id, row.count]));
    },

    async readSecret(organizationId, connectionId) {
      const rows = await sql<{ id: string; encrypted_payload: string; secret_fingerprint: string; key_version: number; expires_at: Date | null }[]>`
        select id, encrypted_payload, secret_fingerprint, key_version, expires_at
        from git_provider_secrets
        where organization_id = ${organizationId} and connection_id = ${connectionId}
        limit 1
      `;
      const row = rows[0];
      return row
        ? { id: row.id, encryptedPayload: row.encrypted_payload, fingerprint: row.secret_fingerprint, keyVersion: row.key_version, expiresAt: iso(row.expires_at) }
        : null;
    },

    async writeSecret(organizationId, connectionId, secret) {
      const rows = await sql<{ id: string }[]>`
        insert into git_provider_secrets (organization_id, connection_id, encrypted_payload, secret_fingerprint, key_version, expires_at)
        select ${organizationId}, id, ${secret.encryptedPayload}, ${secret.fingerprint}, ${secret.keyVersion}, ${secret.expiresAt}
        from git_provider_connections
        where organization_id = ${organizationId} and id = ${connectionId}
        on conflict (connection_id) do update
        set
          encrypted_payload = excluded.encrypted_payload,
          secret_fingerprint = excluded.secret_fingerprint,
          key_version = excluded.key_version,
          expires_at = excluded.expires_at,
          updated_at = now()
        returning id
      `;
      const id = rows[0]?.id;
      if (!id) {
        throw new GitProviderError("CONNECTION_NOT_FOUND", "The connection for this credential was not found.");
      }
      await sql`
        update git_provider_connections set secret_id = ${id}, updated_at = now()
        where organization_id = ${organizationId} and id = ${connectionId}
      `;
      return { id, ...secret };
    },

    async deleteSecret(organizationId, connectionId) {
      await sql`
        update git_provider_connections set secret_id = null, updated_at = now()
        where organization_id = ${organizationId} and id = ${connectionId}
      `;
      await sql`
        delete from git_provider_secrets
        where organization_id = ${organizationId} and connection_id = ${connectionId}
      `;
    },

    async withSecretLock(organizationId, connectionId, fn) {
      return root.begin(async (tx) => {
        await tx`
          select id from git_provider_connections
          where organization_id = ${organizationId} and id = ${connectionId}
          for update
        `;
        return fn(createConnectionStore(tx, root));
      }) as Promise<Awaited<ReturnType<typeof fn>>>;
    },
  };

  return store;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function createOAuthStateStore(sql: ControlPlaneSql): OAuthStateStore {
  return {
    async insert(record) {
      await sql`
        insert into git_oauth_states (
          state_hash, organization_id, user_subject, provider_type, provider_host,
          return_path, encrypted_payload, reauthorize_connection_id, expires_at
        )
        values (
          ${record.stateHash}, ${record.organizationId}, ${record.userSubject}, ${record.provider}, ${record.providerHost},
          ${record.returnPath}, ${record.encryptedPayload}, ${record.reauthorizeConnectionId}, ${record.expiresAt}
        )
      `;
      // Opportunistic cleanup of long-expired state.
      await sql`delete from git_oauth_states where expires_at < now() - interval '1 day'`;
    },

    async consume(stateHash, consumedAt) {
      const rows = await sql<{
        state_hash: string;
        organization_id: string;
        user_subject: string;
        provider_type: GitProviderType;
        provider_host: string | null;
        return_path: string;
        encrypted_payload: string | null;
        reauthorize_connection_id: string | null;
        expires_at: Date;
        consumed_at: Date;
      }[]>`
        update git_oauth_states
        set consumed_at = ${consumedAt}
        where state_hash = ${stateHash} and consumed_at is null
        returning state_hash, organization_id, user_subject, provider_type, provider_host, return_path,
          encrypted_payload, reauthorize_connection_id, expires_at, consumed_at
      `;
      const row = rows[0];
      return row
        ? {
            stateHash: row.state_hash,
            organizationId: row.organization_id,
            userSubject: row.user_subject,
            provider: row.provider_type,
            providerHost: row.provider_host,
            returnPath: row.return_path,
            encryptedPayload: row.encrypted_payload,
            reauthorizeConnectionId: row.reauthorize_connection_id,
            expiresAt: iso(row.expires_at) as string,
            consumedAt: iso(row.consumed_at),
          } satisfies OAuthStateRecord
        : null;
    },
  };
}

type RepositoryRow = {
  id: string;
  organization_id: string;
  provider_type: GitProviderType;
  external_repo_id: string | null;
  connection_id: string | null;
  provider_host: string | null;
  owner_name: string;
  provider_project: string | null;
  repo_name: string;
  default_branch: string;
  canonical_clone_url: string | null;
  visibility: string;
};

const REPOSITORY_COLUMNS = `
  repositories.id, repositories.organization_id, repositories.provider_type, repositories.external_repo_id,
  repositories.connection_id, repositories.provider_host, repositories.owner_name, repositories.provider_project,
  repositories.repo_name, repositories.default_branch, repositories.canonical_clone_url, repositories.visibility
`;

function mapRepository(row: RepositoryRow): ConnectedRepositoryRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider_type,
    providerRepositoryId: row.external_repo_id,
    providerConnectionId: row.connection_id,
    host: row.provider_host,
    owner: row.owner_name,
    project: row.provider_project,
    name: row.repo_name,
    fullName: row.provider_project ? `${row.owner_name}/${row.provider_project}/${row.repo_name}` : `${row.owner_name}/${row.repo_name}`,
    defaultBranch: row.default_branch,
    canonicalUrl: row.canonical_clone_url,
    visibility: row.visibility,
  };
}

function createRepositoryStore(sql: ControlPlaneSql): GitRepositoryStore {
  const store: GitRepositoryStore = {
    async getRepository(organizationId, repositoryId) {
      if (!isUuid(repositoryId)) {
        return null;
      }
      const rows = await sql<RepositoryRow[]>`
        select ${sql.unsafe(REPOSITORY_COLUMNS)} from repositories
        where organization_id = ${organizationId} and id = ${repositoryId}
        limit 1
      `;
      return rows[0] ? mapRepository(rows[0]) : null;
    },

    async findRepositoryByProviderId(organizationId, provider, providerRepositoryId) {
      const rows = await sql<RepositoryRow[]>`
        select ${sql.unsafe(REPOSITORY_COLUMNS)} from repositories
        where organization_id = ${organizationId} and provider_type = ${provider} and external_repo_id = ${providerRepositoryId}
        limit 1
      `;
      return rows[0] ? mapRepository(rows[0]) : null;
    },

    async findRepositoryByName(organizationId, provider, owner, name) {
      const rows = await sql<RepositoryRow[]>`
        select ${sql.unsafe(REPOSITORY_COLUMNS)} from repositories
        where organization_id = ${organizationId} and provider_type = ${provider}
          and lower(owner_name) = lower(${owner}) and lower(repo_name) = lower(${name})
        limit 1
      `;
      return rows[0] ? mapRepository(rows[0]) : null;
    },

    async getAssociation(organizationId, repositoryId) {
      const rows = await sql<{ connection_id: string; provider_repository_id: string }[]>`
        select connection_id, provider_repository_id from repository_connections
        where organization_id = ${organizationId} and repository_id = ${repositoryId}
        limit 1
      `;
      return rows[0] ? { connectionId: rows[0].connection_id, providerRepositoryId: rows[0].provider_repository_id } : null;
    },

    async bindRepository(organizationId, repositoryId, connectionId, providerRepositoryId) {
      await sql.begin(async (tx) => {
        // Both ids must belong to this organization; the insert selects them under that constraint.
        const bound = await tx<{ id: string }[]>`
          insert into repository_connections (organization_id, repository_id, connection_id, provider_repository_id)
          select ${organizationId}, repositories.id, git_provider_connections.id, ${providerRepositoryId}
          from repositories
          join git_provider_connections
            on git_provider_connections.organization_id = repositories.organization_id
           and git_provider_connections.provider_type = repositories.provider_type
          where repositories.organization_id = ${organizationId}
            and repositories.id = ${repositoryId}
            and git_provider_connections.id = ${connectionId}
          on conflict (repository_id) do update
          set connection_id = excluded.connection_id,
              provider_repository_id = excluded.provider_repository_id,
              updated_at = now()
          returning id
        `;
        if (!bound[0]) {
          throw new GitProviderError("CONNECTION_NOT_FOUND", "The repository or connection was not found in this workspace.");
        }
        await tx`
          update repositories
          set connection_id = ${connectionId}, external_repo_id = ${providerRepositoryId}, updated_at = now()
          where organization_id = ${organizationId} and id = ${repositoryId}
        `;
      });
    },

    async upsertRepository(organizationId, input) {
      return sql.begin(async (tx) => {
        const existing = await tx<RepositoryRow[]>`
          select ${tx.unsafe(REPOSITORY_COLUMNS)} from repositories
          where organization_id = ${organizationId} and provider_type = ${input.provider}
            and (
              external_repo_id = ${input.providerRepositoryId}
              or (lower(owner_name) = lower(${input.owner}) and lower(repo_name) = lower(${input.name}))
            )
          order by (external_repo_id = ${input.providerRepositoryId}) desc nulls last
          limit 1
          for update
        `;
        const actor = tx`(
          select id from users where organization_id = ${organizationId} and external_subject = ${input.actorSubject} limit 1
        )`;
        let row: RepositoryRow | undefined;
        const created = !existing[0];

        if (existing[0]) {
          [row] = await tx<RepositoryRow[]>`
            update repositories
            set
              connection_id = ${input.connectionId},
              external_repo_id = ${input.providerRepositoryId},
              provider_host = ${input.host},
              owner_name = ${input.owner},
              provider_project = ${input.project},
              repo_name = ${input.name},
              default_branch = ${input.defaultBranch},
              visibility = ${input.visibility},
              canonical_clone_url = ${input.canonicalUrl},
              status = 'connected',
              updated_at = now()
            where id = ${existing[0].id}
            returning ${tx.unsafe(REPOSITORY_COLUMNS)}
          `;
        } else {
          [row] = await tx<RepositoryRow[]>`
            insert into repositories (
              organization_id, connection_id, provider_type, external_repo_id, provider_host, owner_name,
              provider_project, repo_name, default_branch, visibility, canonical_clone_url, status, created_by
            )
            values (
              ${organizationId}, ${input.connectionId}, ${input.provider}, ${input.providerRepositoryId}, ${input.host}, ${input.owner},
              ${input.project}, ${input.name}, ${input.defaultBranch}, ${input.visibility}, ${input.canonicalUrl}, 'connected', ${actor}
            )
            returning ${tx.unsafe(REPOSITORY_COLUMNS)}
          `;
        }

        if (!row) {
          throw new GitProviderError("INDEX_FAILED", "The repository could not be persisted.", { status: 500 });
        }

        await tx`
          insert into repository_connections (organization_id, repository_id, connection_id, provider_repository_id)
          values (${organizationId}, ${row.id}, ${input.connectionId}, ${input.providerRepositoryId})
          on conflict (repository_id) do update
          set connection_id = excluded.connection_id, provider_repository_id = excluded.provider_repository_id, updated_at = now()
        `;
        await tx`
          insert into repository_sync_state (repository_id, sync_mode, status)
          values (${row.id}, 'manual', 'idle')
          on conflict (repository_id) do nothing
        `;

        return { repository: mapRepository(row), created };
      });
    },

    async listUnboundRepositories(organizationId, provider) {
      const rows = await sql<RepositoryRow[]>`
        select ${sql.unsafe(REPOSITORY_COLUMNS)} from repositories
        left join repository_connections on repository_connections.repository_id = repositories.id
        where repositories.organization_id = ${organizationId}
          and repositories.provider_type = ${provider}
          and repositories.connection_id is null
          and repository_connections.id is null
      `;
      return rows.map(mapRepository);
    },

    async listRepositoryIdsForConnection(organizationId, connectionId) {
      const rows = await sql<{ id: string }[]>`
        select distinct repositories.id from repositories
        left join repository_connections on repository_connections.repository_id = repositories.id
        where repositories.organization_id = ${organizationId}
          and (repositories.connection_id = ${connectionId} or repository_connections.connection_id = ${connectionId})
      `;
      return rows.map((row) => row.id);
    },

    async listConnectedProviderIds(organizationId, provider, providerRepositoryIds) {
      if (providerRepositoryIds.length === 0) {
        return {};
      }
      const rows = await sql<{ id: string; external_repo_id: string }[]>`
        select id, external_repo_id from repositories
        where organization_id = ${organizationId} and provider_type = ${provider}
          and external_repo_id = any(${providerRepositoryIds}::text[])
      `;
      return Object.fromEntries(rows.map((row) => [row.external_repo_id, row.id]));
    },

    async getSyncState(organizationId, repositoryId) {
      const rows = await sql<{
        status: string;
        sync_mode: string;
        last_indexed_at: Date | null;
        last_successful_sync_at: Date | null;
        error_code: string | null;
        error_message: string | null;
        sync_started_at: Date | null;
        skill_count: number;
      }[]>`
        select
          repository_sync_state.status, repository_sync_state.sync_mode, repository_sync_state.last_indexed_at,
          repository_sync_state.last_successful_sync_at, repository_sync_state.error_code, repository_sync_state.error_message,
          repository_sync_state.sync_started_at,
          (select count(*)::int from indexed_skills where indexed_skills.repository_id = repositories.id) as skill_count
        from repositories
        join repository_sync_state on repository_sync_state.repository_id = repositories.id
        where repositories.organization_id = ${organizationId} and repositories.id = ${repositoryId}
        limit 1
      `;
      const row = rows[0];
      return row
        ? ({
            status: row.status,
            syncMode: row.sync_mode,
            lastIndexedAt: iso(row.last_indexed_at),
            lastSuccessfulSyncAt: iso(row.last_successful_sync_at),
            errorCode: row.error_code,
            errorMessage: row.error_message,
            syncStartedAt: iso(row.sync_started_at),
            skillCount: row.skill_count,
          } satisfies RepositorySyncRecord)
        : null;
    },

    async claimSync(organizationId, repositoryId, input) {
      await sql`
        insert into repository_sync_state (repository_id, sync_mode, status)
        select id, 'manual', 'idle' from repositories where organization_id = ${organizationId} and id = ${repositoryId}
        on conflict (repository_id) do nothing
      `;
      const staleBefore = new Date(Date.parse(input.now) - input.staleAfterMs).toISOString();
      const rows = await sql<{ repository_id: string }[]>`
        update repository_sync_state
        set status = 'indexing', sync_started_at = ${input.now}, sync_target_revision = ${input.targetRevision}
        from repositories
        where repositories.id = repository_sync_state.repository_id
          and repositories.organization_id = ${organizationId}
          and repository_sync_state.repository_id = ${repositoryId}
          and (
            repository_sync_state.status <> 'indexing'
            or repository_sync_state.sync_started_at is null
            or repository_sync_state.sync_started_at < ${staleBefore}
          )
        returning repository_sync_state.repository_id
      `;
      return rows.length > 0;
    },

    async recordSyncFailure(organizationId, repositoryId, input) {
      await sql`
        update repository_sync_state
        set status = ${input.status}, error_code = ${input.code}, error_message = ${input.message.slice(0, 500)},
            next_poll_at = ${input.nextPollAt}, sync_started_at = null
        from repositories
        where repositories.id = repository_sync_state.repository_id
          and repositories.organization_id = ${organizationId}
          and repository_sync_state.repository_id = ${repositoryId}
      `;
    },

    async markRepositoriesSyncStatus(organizationId, repositoryIds, input) {
      if (repositoryIds.length === 0) {
        return;
      }
      await sql`
        update repository_sync_state
        set status = ${input.status}, error_code = ${input.code}, error_message = ${input.message.slice(0, 500)}, sync_started_at = null
        from repositories
        where repositories.id = repository_sync_state.repository_id
          and repositories.organization_id = ${organizationId}
          and repository_sync_state.repository_id = any(${repositoryIds}::uuid[])
      `;
    },

    async deleteRepository(organizationId, repositoryId) {
      return sql.begin(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          select id from repositories where organization_id = ${organizationId} and id = ${repositoryId} for update
        `;
        if (!rows[0]) {
          return null;
        }
        // indexed_skills (and their versions/dependencies) cascade from the repository row.
        const skills = await tx<{ count: number }[]>`
          select count(*)::int as count from indexed_skills where repository_id = ${repositoryId}
        `;
        await tx`delete from repositories where organization_id = ${organizationId} and id = ${repositoryId}`;
        return { removedSkillCount: skills[0]?.count ?? 0 };
      });
    },
  };

  return store;
}

function createAuditSink(sql: ControlPlaneSql): GitAuditSink {
  return {
    async record(event) {
      await sql`
        insert into audit_events (organization_id, actor_type, actor_ref, category, action, target_type, target_ref, payload_redacted)
        values (
          ${event.organizationId}, ${event.actorType}, ${event.actorRef},
          ${event.targetType === "repository" ? "repo" : "integration"},
          ${event.action}, ${event.targetType}, ${event.targetRef},
          ${sql.json(sanitizeGitAuditPayload(event.payload))}
        )
      `;
    },
  };
}

export async function createDatabaseGitStores(): Promise<GitStores> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("../control-plane/database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new GitProviderError("PROVIDER_NOT_CONFIGURED", "DATABASE_URL must be configured before Git providers can be connected.", {
      status: 503,
    });
  }

  const sql = getControlPlaneDatabase();

  return {
    connections: createConnectionStore(sql, sql),
    oauthStates: createOAuthStateStore(sql),
    repositories: createRepositoryStore(sql),
    audit: createAuditSink(sql),
  };
}

export type { StoredSecret };
