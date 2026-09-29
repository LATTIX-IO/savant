import { randomUUID } from "node:crypto";

import { sanitizeGitAuditPayload } from "../redaction.ts";
import type {
  GitAuditEvent,
  GitStores,
  GitConnectionRecord,
  GitConnectionStore,
  GitRepositoryStore,
  OAuthStateRecord,
  StoredSecret,
} from "../stores.ts";
import type { ConnectedRepositoryRecord } from "../types.ts";

/**
 * In-memory implementations of the git stores with the same tenant-scoping
 * semantics as the Postgres implementation. Used by deterministic tests.
 */

export type MemoryIndexedSkill = { repositoryId: string; skillId: string };

export type MemorySyncState = {
  status: string;
  syncMode: string;
  lastIndexedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  syncStartedAt: string | null;
  nextPollAt: string | null;
};

export type MemoryGitState = {
  connections: GitConnectionRecord[];
  secrets: Array<StoredSecret & { organizationId: string; connectionId: string }>;
  oauthStates: OAuthStateRecord[];
  repositories: ConnectedRepositoryRecord[];
  associations: Array<{ organizationId: string; repositoryId: string; connectionId: string; providerRepositoryId: string }>;
  syncStates: Map<string, MemorySyncState>;
  indexedSkills: MemoryIndexedSkill[];
  audit: GitAuditEvent[];
  users: Array<{ organizationId: string; subject: string; id: string }>;
};

export function createMemoryGitState(): MemoryGitState {
  return {
    connections: [],
    secrets: [],
    oauthStates: [],
    repositories: [],
    associations: [],
    syncStates: new Map(),
    indexedSkills: [],
    audit: [],
    users: [],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createMemoryGitStores(state: MemoryGitState = createMemoryGitState()): GitStores & { state: MemoryGitState } {
  const connections: GitConnectionStore = {
    async listConnections(organizationId, filter) {
      return state.connections
        .filter((connection) => connection.organizationId === organizationId)
        .filter((connection) => !filter?.provider || connection.provider === filter.provider)
        .filter((connection) => filter?.includeDisconnected || connection.status !== "disconnected")
        .map((connection) => ({ ...connection }));
    },

    async getConnection(organizationId, connectionId) {
      const found = state.connections.find((connection) => connection.organizationId === organizationId && connection.id === connectionId);
      return found ? { ...found } : null;
    },

    async upsertConnection(organizationId, input) {
      const accountKey = input.providerInstallationId ?? input.providerAccountId;
      const existing = input.connectionId
        ? state.connections.find((connection) => connection.organizationId === organizationId && connection.id === input.connectionId)
        : state.connections.find((connection) =>
            connection.organizationId === organizationId
            && connection.provider === input.provider
            && (connection.providerHost ?? "") === (input.providerHost ?? "")
            && accountKey != null
            && (connection.providerInstallationId ?? connection.providerAccountId) === accountKey
            && connection.status !== "disconnected");

      if (input.connectionId && !existing) {
        throw new Error("connection not found");
      }

      const timestamp = nowIso();
      if (existing) {
        Object.assign(existing, {
          displayName: input.displayName,
          authType: input.authType,
          providerHost: input.providerHost,
          providerAccountId: input.providerAccountId,
          providerAccountName: input.providerAccountName,
          providerInstallationId: input.providerInstallationId,
          providerScope: input.providerScope,
          scopes: input.scopes,
          status: "active",
          lastErrorCode: null,
          lastErrorAt: null,
          lastValidatedAt: timestamp,
          updatedAt: timestamp,
        } satisfies Partial<GitConnectionRecord>);
        return { connection: { ...existing }, created: false };
      }

      const connection: GitConnectionRecord = {
        id: randomUUID(),
        organizationId,
        provider: input.provider,
        displayName: input.displayName,
        authType: input.authType,
        status: "active",
        providerHost: input.providerHost,
        providerAccountId: input.providerAccountId,
        providerAccountName: input.providerAccountName,
        providerInstallationId: input.providerInstallationId,
        providerScope: input.providerScope,
        secretId: null,
        credentialsRef: null,
        scopes: input.scopes,
        lastValidatedAt: timestamp,
        lastErrorCode: null,
        lastErrorAt: null,
        createdBy: state.users.find((user) => user.organizationId === organizationId && user.subject === input.createdBySubject)?.id ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.connections.push(connection);
      return { connection: { ...connection }, created: true };
    },

    async updateConnection(organizationId, connectionId, patch) {
      const found = state.connections.find((connection) => connection.organizationId === organizationId && connection.id === connectionId);
      if (!found) {
        return null;
      }
      if (patch.status !== undefined) found.status = patch.status;
      if (patch.lastValidatedAt !== undefined) found.lastValidatedAt = patch.lastValidatedAt;
      if (patch.lastErrorCode !== undefined) found.lastErrorCode = patch.lastErrorCode;
      if (patch.lastErrorAt !== undefined) found.lastErrorAt = patch.lastErrorAt;
      found.updatedAt = nowIso();
      return { ...found };
    },

    async countRepositories(organizationId, connectionIds) {
      const counts: Record<string, number> = {};
      for (const repository of state.repositories) {
        if (repository.organizationId === organizationId && repository.providerConnectionId && connectionIds.includes(repository.providerConnectionId)) {
          counts[repository.providerConnectionId] = (counts[repository.providerConnectionId] ?? 0) + 1;
        }
      }
      return counts;
    },

    async readSecret(organizationId, connectionId) {
      const found = state.secrets.find((secret) => secret.organizationId === organizationId && secret.connectionId === connectionId);
      return found ? { id: found.id, encryptedPayload: found.encryptedPayload, fingerprint: found.fingerprint, keyVersion: found.keyVersion, expiresAt: found.expiresAt } : null;
    },

    async writeSecret(organizationId, connectionId, secret) {
      const connection = state.connections.find((candidate) => candidate.organizationId === organizationId && candidate.id === connectionId);
      if (!connection) {
        throw new Error("connection not found");
      }
      const existing = state.secrets.find((candidate) => candidate.organizationId === organizationId && candidate.connectionId === connectionId);
      if (existing) {
        Object.assign(existing, secret);
        connection.secretId = existing.id;
        return { id: existing.id, ...secret };
      }
      const stored = { id: randomUUID(), organizationId, connectionId, ...secret };
      state.secrets.push(stored);
      connection.secretId = stored.id;
      return { id: stored.id, ...secret };
    },

    async deleteSecret(organizationId, connectionId) {
      state.secrets = state.secrets.filter((secret) => !(secret.organizationId === organizationId && secret.connectionId === connectionId));
      const connection = state.connections.find((candidate) => candidate.organizationId === organizationId && candidate.id === connectionId);
      if (connection) {
        connection.secretId = null;
      }
    },

    async withSecretLock(_organizationId, _connectionId, fn) {
      return fn(connections);
    },
  };

  const repositories: GitRepositoryStore = {
    async getRepository(organizationId, repositoryId) {
      const found = state.repositories.find((repository) => repository.organizationId === organizationId && repository.id === repositoryId);
      return found ? { ...found } : null;
    },

    async findRepositoryByProviderId(organizationId, provider, providerRepositoryId) {
      const found = state.repositories.find((repository) =>
        repository.organizationId === organizationId && repository.provider === provider && repository.providerRepositoryId === providerRepositoryId);
      return found ? { ...found } : null;
    },

    async findRepositoryByName(organizationId, provider, owner, name) {
      const found = state.repositories.find((repository) =>
        repository.organizationId === organizationId
        && repository.provider === provider
        && repository.owner.toLowerCase() === owner.toLowerCase()
        && repository.name.toLowerCase() === name.toLowerCase());
      return found ? { ...found } : null;
    },

    async getAssociation(organizationId, repositoryId) {
      const found = state.associations.find((association) => association.organizationId === organizationId && association.repositoryId === repositoryId);
      return found ? { connectionId: found.connectionId, providerRepositoryId: found.providerRepositoryId } : null;
    },

    async bindRepository(organizationId, repositoryId, connectionId, providerRepositoryId) {
      const repository = state.repositories.find((candidate) => candidate.organizationId === organizationId && candidate.id === repositoryId);
      const connection = state.connections.find((candidate) => candidate.organizationId === organizationId && candidate.id === connectionId);
      if (!repository || !connection || connection.provider !== repository.provider) {
        throw new Error("repository or connection not found in organization");
      }
      state.associations = state.associations.filter((association) => association.repositoryId !== repositoryId);
      state.associations.push({ organizationId, repositoryId, connectionId, providerRepositoryId });
      repository.providerConnectionId = connectionId;
      repository.providerRepositoryId = providerRepositoryId;
    },

    async upsertRepository(organizationId, input) {
      const existing = state.repositories.find((repository) =>
        repository.organizationId === organizationId
        && repository.provider === input.provider
        && (repository.providerRepositoryId === input.providerRepositoryId
          || (repository.owner.toLowerCase() === input.owner.toLowerCase() && repository.name.toLowerCase() === input.name.toLowerCase())));
      const fields = {
        provider: input.provider,
        providerRepositoryId: input.providerRepositoryId,
        providerConnectionId: input.connectionId,
        host: input.host,
        owner: input.owner,
        project: input.project,
        name: input.name,
        fullName: input.project ? `${input.owner}/${input.project}/${input.name}` : `${input.owner}/${input.name}`,
        defaultBranch: input.defaultBranch,
        canonicalUrl: input.canonicalUrl,
        visibility: input.visibility,
      };

      let repository: ConnectedRepositoryRecord;
      const created = !existing;
      if (existing) {
        Object.assign(existing, fields);
        repository = existing;
      } else {
        repository = { id: randomUUID(), organizationId, ...fields };
        state.repositories.push(repository);
      }

      state.associations = state.associations.filter((association) => association.repositoryId !== repository.id);
      state.associations.push({ organizationId, repositoryId: repository.id, connectionId: input.connectionId, providerRepositoryId: input.providerRepositoryId });
      if (!state.syncStates.has(repository.id)) {
        state.syncStates.set(repository.id, {
          status: "idle",
          syncMode: "manual",
          lastIndexedAt: null,
          lastSuccessfulSyncAt: null,
          errorCode: null,
          errorMessage: null,
          syncStartedAt: null,
          nextPollAt: null,
        });
      }
      return { repository: { ...repository }, created };
    },

    async listUnboundRepositories(organizationId, provider) {
      return state.repositories
        .filter((repository) => repository.organizationId === organizationId && repository.provider === provider && !repository.providerConnectionId)
        .filter((repository) => !state.associations.some((association) => association.repositoryId === repository.id))
        .map((repository) => ({ ...repository }));
    },

    async listRepositoryIdsForConnection(organizationId, connectionId) {
      const ids = new Set<string>();
      for (const repository of state.repositories) {
        if (repository.organizationId === organizationId && repository.providerConnectionId === connectionId) {
          ids.add(repository.id);
        }
      }
      for (const association of state.associations) {
        if (association.organizationId === organizationId && association.connectionId === connectionId) {
          ids.add(association.repositoryId);
        }
      }
      return [...ids];
    },

    async listConnectedProviderIds(organizationId, provider, providerRepositoryIds) {
      return Object.fromEntries(
        state.repositories
          .filter((repository) => repository.organizationId === organizationId && repository.provider === provider && repository.providerRepositoryId && providerRepositoryIds.includes(repository.providerRepositoryId))
          .map((repository) => [repository.providerRepositoryId as string, repository.id]),
      );
    },

    async getSyncState(organizationId, repositoryId) {
      const repository = state.repositories.find((candidate) => candidate.organizationId === organizationId && candidate.id === repositoryId);
      const sync = repository ? state.syncStates.get(repositoryId) : undefined;
      return sync
        ? {
            status: sync.status,
            syncMode: sync.syncMode,
            lastIndexedAt: sync.lastIndexedAt,
            lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt,
            errorCode: sync.errorCode,
            errorMessage: sync.errorMessage,
            syncStartedAt: sync.syncStartedAt,
            skillCount: state.indexedSkills.filter((skill) => skill.repositoryId === repositoryId).length,
          }
        : null;
    },

    async claimSync(organizationId, repositoryId, input) {
      const repository = state.repositories.find((candidate) => candidate.organizationId === organizationId && candidate.id === repositoryId);
      if (!repository) {
        return false;
      }
      const sync = state.syncStates.get(repositoryId) ?? {
        status: "idle", syncMode: "manual", lastIndexedAt: null, lastSuccessfulSyncAt: null,
        errorCode: null, errorMessage: null, syncStartedAt: null, nextPollAt: null,
      };
      const fresh = sync.status === "indexing"
        && sync.syncStartedAt != null
        && Date.parse(sync.syncStartedAt) >= Date.parse(input.now) - input.staleAfterMs;
      if (fresh) {
        return false;
      }
      sync.status = "indexing";
      sync.syncStartedAt = input.now;
      state.syncStates.set(repositoryId, sync);
      return true;
    },

    async recordSyncFailure(organizationId, repositoryId, input) {
      const repository = state.repositories.find((candidate) => candidate.organizationId === organizationId && candidate.id === repositoryId);
      const sync = repository ? state.syncStates.get(repositoryId) : undefined;
      if (sync) {
        sync.status = input.status;
        sync.errorCode = input.code;
        sync.errorMessage = input.message;
        sync.nextPollAt = input.nextPollAt;
        sync.syncStartedAt = null;
      }
    },

    async markRepositoriesSyncStatus(organizationId, repositoryIds, input) {
      for (const repositoryId of repositoryIds) {
        await repositories.recordSyncFailure(organizationId, repositoryId, { ...input, nextPollAt: null });
      }
    },

    async deleteRepository(organizationId, repositoryId) {
      const index = state.repositories.findIndex((candidate) => candidate.organizationId === organizationId && candidate.id === repositoryId);
      if (index < 0) {
        return null;
      }
      state.repositories.splice(index, 1);
      const removedSkillCount = state.indexedSkills.filter((skill) => skill.repositoryId === repositoryId).length;
      state.indexedSkills = state.indexedSkills.filter((skill) => skill.repositoryId !== repositoryId);
      state.associations = state.associations.filter((association) => association.repositoryId !== repositoryId);
      state.syncStates.delete(repositoryId);
      return { removedSkillCount };
    },
  };

  return {
    state,
    connections,
    oauthStates: {
      async insert(record) {
        state.oauthStates.push({ ...record, consumedAt: null });
      },
      async consume(stateHash, consumedAt) {
        const found = state.oauthStates.find((record) => record.stateHash === stateHash && record.consumedAt === null);
        if (!found) {
          return null;
        }
        found.consumedAt = consumedAt;
        return { ...found };
      },
    },
    repositories,
    audit: {
      async record(event) {
        // Mirror the database sink: only allowlisted, redacted payload keys are kept.
        state.audit.push({ ...event, payload: sanitizeGitAuditPayload(event.payload) });
      },
    },
  };
}
