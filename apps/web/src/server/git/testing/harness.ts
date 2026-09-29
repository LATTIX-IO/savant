import { randomBytes, randomUUID } from "node:crypto";

import { parseRepositoryIndexSnapshot } from "../../control-plane/repository-index.ts";
import type { GitActor } from "../access-control.ts";
import { createGitConnectionService } from "../connection-service.ts";
import { createGitCredentialBroker } from "../credential-broker.ts";
import { createGitProviderRegistry } from "../providers/registry.ts";
import { createGitRepositoryService, type RepositoryIndexJob } from "../repository-service.ts";
import { syncRepository, type IndexWriter } from "../repository-sync-service.ts";
import { encryptProviderCredential } from "../secret-vault.ts";
import type { GitConnectionRecord } from "../stores.ts";
import type { ConnectedRepositoryRecord, FetchLike, GitProvider } from "../types.ts";
import { createMemoryGitStores, type MemoryGitState } from "./memory-stores.ts";

type ParsedIndex = ReturnType<typeof parseRepositoryIndexSnapshot>;

export const ORG_A = "00000000-0000-4000-8000-00000000000a";
export const ORG_B = "00000000-0000-4000-8000-00000000000b";

export function createTestEnv(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    GIT_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    APP_BASE_URL: "https://savant.test",
    ...overrides,
  };
}

/** Index writer backed by the in-memory state that uses the real skill parser. */
export function createMemoryIndexWriter(state: MemoryGitState): IndexWriter<ParsedIndex, { skillCount: number }> & { commits: number } {
  const writer = {
    commits: 0,
    validate: (snapshot: Parameters<typeof parseRepositoryIndexSnapshot>[0]) => parseRepositoryIndexSnapshot(snapshot),
    skillCount: (parsed: ParsedIndex) => parsed.skills.length,
    async commit(input: { repositoryId: string; parsed: ParsedIndex; now: Date }) {
      writer.commits += 1;
      // Atomic replace: the old index is swapped only once the staged one is complete.
      const staged = input.parsed.skills.map((skill) => ({ repositoryId: input.repositoryId, skillId: skill.skillId }));
      state.indexedSkills = [...state.indexedSkills.filter((skill) => skill.repositoryId !== input.repositoryId), ...staged];
      const sync = state.syncStates.get(input.repositoryId);
      if (sync) {
        sync.status = input.parsed.warnings.length > 0 || staged.length === 0 ? "warn" : "ok";
        sync.lastIndexedAt = input.now.toISOString();
        sync.lastSuccessfulSyncAt = input.now.toISOString();
        sync.errorCode = null;
        sync.errorMessage = null;
        sync.syncStartedAt = null;
      }
      return { skillCount: staged.length };
    },
  };
  return writer;
}

export function createGitTestHarness(options: {
  providers: GitProvider[];
  env?: Record<string, string | undefined> | undefined;
  fetcher?: FetchLike | undefined;
}) {
  const env = options.env ?? createTestEnv();
  const stores = createMemoryGitStores();
  const { state } = stores;
  const registry = createGitProviderRegistry(options.providers);
  const broker = createGitCredentialBroker({ connections: stores.connections, registry, audit: stores.audit, env });
  const context = options.fetcher ? { fetcher: options.fetcher } : undefined;
  const connections = createGitConnectionService({ stores, registry, broker, env, context, resolveHost: async () => ["203.0.113.10"] });
  const writer = createMemoryIndexWriter(state);
  const jobs: RepositoryIndexJob[] = [];

  const scheduler = {
    async enqueue(job: RepositoryIndexJob) {
      jobs.push(job);
      return { started: true };
    },
  };

  const repositories = createGitRepositoryService({ stores, broker, scheduler, context });

  function actor(organizationId: string, role: GitActor["role"] = "admin", subject = `auth0|admin-${organizationId.slice(-1)}`): GitActor {
    if (!state.users.some((user) => user.organizationId === organizationId && user.subject === subject)) {
      state.users.push({ organizationId, subject, id: randomUUID() });
    }
    return { organizationId, subject, role };
  }

  async function sync(organizationId: string, repositoryId: string, trigger: "initial" | "manual" = "manual", extra?: { readAnonymousSnapshot?: Parameters<typeof syncRepository>[0]["readAnonymousSnapshot"] }) {
    return syncRepository({
      connections: stores.connections,
      repositories: stores.repositories,
      broker,
      audit: stores.audit,
      writer,
      context,
      ...(extra?.readAnonymousSnapshot ? { readAnonymousSnapshot: extra.readAnonymousSnapshot } : {}),
    }, {
      organizationId,
      repositoryId,
      actor: { type: "user", ref: "auth0|admin" },
      trigger,
    });
  }

  /** Runs queued index jobs the way the after-response scheduler would. */
  async function drainJobs() {
    const results: Array<{ job: RepositoryIndexJob; error?: unknown }> = [];
    while (jobs.length > 0) {
      const job = jobs.shift() as RepositoryIndexJob;
      try {
        await sync(job.organizationId, job.repositoryId, job.trigger === "initial" ? "initial" : "manual");
        results.push({ job });
      } catch (error) {
        results.push({ job, error });
      }
    }
    return results;
  }

  function seedConnection(input: Partial<GitConnectionRecord> & Pick<GitConnectionRecord, "organizationId" | "provider" | "authType">): GitConnectionRecord {
    const timestamp = new Date().toISOString();
    const connection: GitConnectionRecord = {
      id: randomUUID(),
      displayName: `${input.provider} connection`,
      status: "active",
      providerHost: null,
      providerAccountId: randomUUID(),
      providerAccountName: "seeded",
      providerInstallationId: null,
      providerScope: null,
      secretId: null,
      credentialsRef: null,
      scopes: [],
      lastValidatedAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      createdBy: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...input,
    };
    state.connections.push(connection);
    return connection;
  }

  function seedTokenSecret(connection: GitConnectionRecord, credential: { accessToken: string; refreshToken?: string; expiresAt?: string }) {
    const encrypted = encryptProviderCredential(credential, { purpose: "connection_credential", organizationId: connection.organizationId, connectionId: connection.id }, env);
    const id = randomUUID();
    state.secrets.push({ id, organizationId: connection.organizationId, connectionId: connection.id, encryptedPayload: encrypted.encryptedPayload, fingerprint: encrypted.fingerprint, keyVersion: encrypted.keyVersion, expiresAt: credential.expiresAt ?? null });
    connection.secretId = id;
  }

  function seedRepository(input: Partial<ConnectedRepositoryRecord> & Pick<ConnectedRepositoryRecord, "organizationId" | "owner" | "name">, sync?: { status?: string; lastIndexedAt?: string | null }): ConnectedRepositoryRecord {
    const repository: ConnectedRepositoryRecord = {
      id: randomUUID(),
      provider: "github",
      providerRepositoryId: null,
      providerConnectionId: null,
      host: null,
      project: null,
      fullName: `${input.owner}/${input.name}`,
      defaultBranch: "main",
      canonicalUrl: `https://github.com/${input.owner}/${input.name}`,
      visibility: "private",
      ...input,
    };
    state.repositories.push(repository);
    state.syncStates.set(repository.id, {
      status: sync?.status ?? "idle",
      syncMode: "manual",
      lastIndexedAt: sync?.lastIndexedAt ?? null,
      lastSuccessfulSyncAt: sync?.lastIndexedAt ?? null,
      errorCode: null,
      errorMessage: null,
      syncStartedAt: null,
      nextPollAt: null,
    });
    return repository;
  }

  return { env, stores, state, registry, broker, connections, repositories, writer, jobs, actor, sync, drainJobs, seedConnection, seedTokenSecret, seedRepository };
}
