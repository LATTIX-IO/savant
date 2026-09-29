import type {
  ConnectedRepositoryRecord,
  GitConnectionAuthType,
  GitConnectionStatus,
  GitProviderType,
} from "./types.ts";

/**
 * Persistence contracts for the git subsystem. Every method takes the
 * authenticated organization id and every implementation MUST constrain its
 * queries by it (INV-GIT-03); a connection or repository id from another
 * organization behaves exactly like a missing one.
 */

export type GitConnectionRecord = {
  id: string;
  organizationId: string;
  provider: GitProviderType;
  displayName: string;
  authType: GitConnectionAuthType;
  status: GitConnectionStatus;
  providerHost: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  providerInstallationId: string | null;
  providerScope: string | null;
  secretId: string | null;
  credentialsRef: string | null;
  scopes: string[];
  lastValidatedAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoredSecret = {
  id: string;
  encryptedPayload: string;
  fingerprint: string;
  keyVersion: number;
  expiresAt: string | null;
};

export type ConnectionUpsertInput = {
  provider: GitProviderType;
  displayName: string;
  authType: GitConnectionAuthType;
  providerHost: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  providerInstallationId: string | null;
  providerScope: string | null;
  scopes: string[];
  createdBySubject: string;
  /** When set, this exact connection is updated (reauthorization). */
  connectionId?: string | undefined;
};

export type ConnectionStatusPatch = {
  status?: GitConnectionStatus | undefined;
  lastValidatedAt?: string | null | undefined;
  lastErrorCode?: string | null | undefined;
  lastErrorAt?: string | null | undefined;
};

export interface GitConnectionStore {
  listConnections(organizationId: string, filter?: { provider?: GitProviderType | undefined; includeDisconnected?: boolean | undefined }): Promise<GitConnectionRecord[]>;
  getConnection(organizationId: string, connectionId: string): Promise<GitConnectionRecord | null>;
  upsertConnection(organizationId: string, input: ConnectionUpsertInput): Promise<{ connection: GitConnectionRecord; created: boolean }>;
  updateConnection(organizationId: string, connectionId: string, patch: ConnectionStatusPatch): Promise<GitConnectionRecord | null>;
  countRepositories(organizationId: string, connectionIds: string[]): Promise<Record<string, number>>;

  readSecret(organizationId: string, connectionId: string): Promise<StoredSecret | null>;
  writeSecret(organizationId: string, connectionId: string, secret: Omit<StoredSecret, "id">): Promise<StoredSecret>;
  deleteSecret(organizationId: string, connectionId: string): Promise<void>;
  /**
   * Serializes credential refresh for one connection across instances (row
   * lock), so rotating refresh tokens are not raced.
   */
  withSecretLock<T>(organizationId: string, connectionId: string, fn: (store: GitConnectionStore) => Promise<T>): Promise<T>;
}

export type OAuthStateRecord = {
  stateHash: string;
  organizationId: string;
  userSubject: string;
  provider: GitProviderType;
  providerHost: string | null;
  returnPath: string;
  encryptedPayload: string | null;
  reauthorizeConnectionId: string | null;
  expiresAt: string;
  consumedAt: string | null;
};

export interface OAuthStateStore {
  insert(record: Omit<OAuthStateRecord, "consumedAt">): Promise<void>;
  /** Atomically marks the state consumed and returns it; null when unknown or already used. */
  consume(stateHash: string, consumedAt: string): Promise<OAuthStateRecord | null>;
}

export type RepositorySyncRecord = {
  status: string;
  syncMode: string;
  lastIndexedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  syncStartedAt: string | null;
  skillCount: number;
};

export type RepositoryUpsertInput = {
  provider: GitProviderType;
  providerRepositoryId: string;
  connectionId: string;
  host: string;
  owner: string;
  project: string | null;
  name: string;
  defaultBranch: string;
  visibility: "private" | "public" | "internal";
  canonicalUrl: string;
  actorSubject: string;
};

export interface GitRepositoryStore {
  getRepository(organizationId: string, repositoryId: string): Promise<ConnectedRepositoryRecord | null>;
  findRepositoryByProviderId(organizationId: string, provider: GitProviderType, providerRepositoryId: string): Promise<ConnectedRepositoryRecord | null>;
  findRepositoryByName(organizationId: string, provider: GitProviderType, owner: string, name: string): Promise<ConnectedRepositoryRecord | null>;
  getAssociation(organizationId: string, repositoryId: string): Promise<{ connectionId: string; providerRepositoryId: string } | null>;
  /** Writes repositories.connection_id + external id and the repository_connections row together. */
  bindRepository(organizationId: string, repositoryId: string, connectionId: string, providerRepositoryId: string): Promise<void>;
  /** Idempotent on (organization, provider, provider repository id). */
  upsertRepository(organizationId: string, input: RepositoryUpsertInput): Promise<{ repository: ConnectedRepositoryRecord; created: boolean }>;
  listUnboundRepositories(organizationId: string, provider: GitProviderType): Promise<ConnectedRepositoryRecord[]>;
  listRepositoryIdsForConnection(organizationId: string, connectionId: string): Promise<string[]>;
  listConnectedProviderIds(organizationId: string, provider: GitProviderType, providerRepositoryIds: string[]): Promise<Record<string, string>>;
  getSyncState(organizationId: string, repositoryId: string): Promise<RepositorySyncRecord | null>;
  /**
   * Claims the repository for syncing. Returns false when another sync holds
   * a fresh claim (coalescing / SYNC_ALREADY_RUNNING).
   */
  claimSync(organizationId: string, repositoryId: string, input: { now: string; staleAfterMs: number; targetRevision: string | null }): Promise<boolean>;
  /** Records a sync outcome that did not produce a new index; the previous index is untouched (INV-GIT-07). */
  recordSyncFailure(organizationId: string, repositoryId: string, input: { status: "error" | "auth_required" | "access_revoked"; code: string; message: string; nextPollAt: string | null }): Promise<void>;
  markRepositoriesSyncStatus(organizationId: string, repositoryIds: string[], input: { status: "auth_required" | "access_revoked"; code: string; message: string }): Promise<void>;
  /** Removes the repository and the indexed skills that belong exclusively to it. */
  deleteRepository(organizationId: string, repositoryId: string): Promise<{ removedSkillCount: number } | null>;
}

export type GitAuditEvent = {
  organizationId: string;
  actorType: "user" | "system";
  actorRef: string;
  action: string;
  targetType: "git_provider_connection" | "repository";
  targetRef: string;
  payload: Record<string, unknown>;
};

export interface GitAuditSink {
  record(event: GitAuditEvent): Promise<void>;
}

export type GitStores = {
  connections: GitConnectionStore;
  oauthStates: OAuthStateStore;
  repositories: GitRepositoryStore;
  audit: GitAuditSink;
};
