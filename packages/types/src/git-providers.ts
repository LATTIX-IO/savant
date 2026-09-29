import type { ControlPlaneResponseMeta } from "./control-plane";

/**
 * Git provider identifiers used by the managed source-control integration.
 * `azure` is Azure DevOps Services / Azure Repos; it matches the identifier the
 * repositories table already stores.
 */
export type GitProviderType = "github" | "gitlab" | "bitbucket" | "azure";

export type GitConnectionAuthType =
  | "github_app_installation"
  | "oauth"
  | "access_token"
  | "pat"
  | "legacy_env";

export type GitConnectionStatus =
  | "active"
  | "needs_reauthorization"
  | "revoked"
  | "error"
  | "disconnected";

export type GitProviderErrorCode =
  | "AUTH_REQUIRED"
  | "TOKEN_EXPIRED"
  | "TOKEN_REVOKED"
  | "INSUFFICIENT_SCOPE"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_ACCESS_DENIED"
  | "CONNECTION_NOT_FOUND"
  | "CONNECTION_REQUIRED"
  | "CONNECTION_AMBIGUOUS"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "INDEX_FAILED"
  | "SYNC_ALREADY_RUNNING"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_HOST_REJECTED"
  | "AUTHORIZATION_STATE_INVALID"
  | "PERMISSION_DENIED"
  | "INVALID_REQUEST";

/** Repository indexing state, distinct from provider connection state. */
export type RepositorySyncState =
  | "pending"
  | "indexing"
  | "ready"
  | "failed"
  | "auth_required"
  | "access_revoked";

/** Maps the stored repository_sync_state.status to the user-facing indexing state. */
export function mapRepositorySyncState(status: string | null | undefined): RepositorySyncState {
  switch (status) {
    case "indexing":
      return "indexing";
    case "ok":
    case "warn":
      return "ready";
    case "error":
      return "failed";
    case "auth_required":
      return "auth_required";
    case "access_revoked":
      return "access_revoked";
    default:
      return "pending";
  }
}

export interface GitProviderDescriptor {
  type: GitProviderType;
  label: string;
  /** Whether the platform has the OAuth/App configuration needed for the primary flow. */
  configured: boolean;
  primaryAuth: "github_app_installation" | "oauth";
  supportsSelfManaged: boolean;
  supportsManualToken: boolean;
  hierarchy: string[];
  requestedAccess: string[];
  configurationHint: string | null;
}

export interface GitConnectionSummary {
  id: string;
  provider: GitProviderType;
  displayName: string;
  authType: GitConnectionAuthType;
  status: GitConnectionStatus;
  providerHost: string | null;
  providerAccountName: string | null;
  providerAccountId: string | null;
  scopes: string[];
  repositoryCount: number;
  lastValidatedAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  isLegacy: boolean;
  credentialStored: boolean;
}

export interface DiscoveredRepository {
  providerRepositoryId: string;
  name: string;
  fullName: string;
  /** Provider hierarchy from the outermost container inward, excluding the repository. */
  hierarchy: string[];
  defaultBranch: string | null;
  isPrivate: boolean;
  webUrl: string | null;
  /** Savant repository id when this provider repository is already connected. */
  connectedRepositoryId: string | null;
}

export interface GitProviderListResponse {
  data: GitProviderDescriptor[];
  meta: ControlPlaneResponseMeta;
}

export interface GitConnectionListResponse {
  data: GitConnectionSummary[];
  meta: ControlPlaneResponseMeta & { count: number };
}

export interface GitConnectionResponse {
  data: GitConnectionSummary;
  meta: ControlPlaneResponseMeta;
}

export interface GitConnectionValidationResponse {
  data: {
    connection: GitConnectionSummary;
    healthy: boolean;
    errorCode: GitProviderErrorCode | null;
    message: string;
  };
  meta: ControlPlaneResponseMeta;
}

export interface GitDiscoveredRepositoryListResponse {
  data: DiscoveredRepository[];
  meta: ControlPlaneResponseMeta & { nextCursor: string | null; count: number };
}

export interface GitAuthorizeRequest {
  returnPath?: string | undefined;
  /** Self-managed GitLab only. */
  host?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

export interface GitAuthorizeResponse {
  data: { authorizationUrl: string };
  meta: ControlPlaneResponseMeta;
}

export interface GitManualTokenConnectRequest {
  provider: GitProviderType;
  token: string;
  displayName?: string | undefined;
  host?: string | undefined;
  /** Azure DevOps organization name, required for Azure PATs. */
  organization?: string | undefined;
}

export interface GitManualTokenConnectResponse {
  data: {
    connection: GitConnectionSummary;
    message: string;
    warnings: string[];
  };
  meta: ControlPlaneResponseMeta;
}

export interface RepositoryConnectSelectionRequest {
  connectionId: string;
  repositories: Array<{ providerRepositoryId: string }>;
}

export interface ConnectedRepositoryResult {
  repository: {
    id: string;
    name: string;
    provider: GitProviderType;
    providerRepositoryId: string;
    connectionId: string;
    syncState: RepositorySyncState;
    created: boolean;
  };
  indexing: { started: boolean; reason?: string | undefined };
}

export interface RepositoryConnectSelectionResponse {
  data: {
    connected: ConnectedRepositoryResult[];
    failed: Array<{ providerRepositoryId: string; errorCode: GitProviderErrorCode; message: string }>;
  };
  meta: ControlPlaneResponseMeta;
}

export interface RepositorySyncStatusPayload {
  repositoryId: string;
  syncState: RepositorySyncState;
  indexedAt: string | null;
  lastSyncAt: string | null;
  skillCount: number;
  errorCode: string | null;
  message: string | null;
  remediation: string | null;
  connection: {
    id: string;
    provider: GitProviderType;
    displayName: string;
    status: GitConnectionStatus;
    isLegacy: boolean;
  } | null;
}

export interface RepositorySyncStatusResponse {
  data: RepositorySyncStatusPayload;
  meta: ControlPlaneResponseMeta;
}
