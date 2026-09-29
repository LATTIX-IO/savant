import type {
  GitConnectionAuthType,
  GitConnectionStatus,
  GitProviderErrorCode,
  GitProviderType,
  RepositorySyncState,
} from "@savant/types";

export type { GitConnectionAuthType, GitConnectionStatus, GitProviderErrorCode, GitProviderType, RepositorySyncState };

export const GIT_PROVIDER_TYPES: readonly GitProviderType[] = ["github", "gitlab", "bitbucket", "azure"];

export function isGitProviderType(value: string): value is GitProviderType {
  return (GIT_PROVIDER_TYPES as readonly string[]).includes(value);
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Credential material as persisted (encrypted) for a connection. Installation
 * based connections persist no token at all; their runtime credential is minted
 * on demand.
 */
export interface ProviderCredential {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  /** ISO timestamp. */
  expiresAt?: string | undefined;
  tokenType?: string | undefined;
  scopes?: string[] | undefined;
  /** Per-instance OAuth client (self-managed GitLab). */
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

/**
 * Ephemeral credential handed to provider adapters for one unit of work. It is
 * never serialized into logs, audit payloads, API responses, or job payloads;
 * `toJSON` and the Node inspect hook both redact it.
 */
export interface RuntimeCredential {
  readonly provider: GitProviderType;
  readonly connectionId: string | null;
  readonly organizationId: string | null;
  /** API base, e.g. https://api.github.com or https://gitlab.example.com/api/v4. */
  readonly apiBaseUrl: string;
  /** Web host, e.g. github.com or gitlab.example.com. */
  readonly host: string;
  readonly scheme: "bearer" | "token" | "basic";
  readonly accessToken: string | null;
  /** Azure DevOps organization scope for PAT connections. */
  readonly accountScope?: string | undefined;
  /** GitHub App installation the token was minted for. */
  readonly installationId?: string | undefined;
  readonly expiresAt?: string | undefined;
}

const REDACTED_CREDENTIAL = "[REDACTED_RUNTIME_CREDENTIAL]";

export function createRuntimeCredential(input: {
  provider: GitProviderType;
  connectionId: string | null;
  organizationId: string | null;
  apiBaseUrl: string;
  host: string;
  scheme?: RuntimeCredential["scheme"] | undefined;
  accessToken: string | null;
  accountScope?: string | undefined;
  installationId?: string | undefined;
  expiresAt?: string | undefined;
}): RuntimeCredential {
  const credential: RuntimeCredential = {
    provider: input.provider,
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    apiBaseUrl: input.apiBaseUrl.replace(/\/+$/, ""),
    host: input.host,
    scheme: input.scheme ?? "bearer",
    accessToken: input.accessToken,
    ...(input.accountScope ? { accountScope: input.accountScope } : {}),
    ...(input.installationId ? { installationId: input.installationId } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };

  Object.defineProperty(credential, "toJSON", {
    enumerable: false,
    value: () => ({ provider: credential.provider, connectionId: credential.connectionId, accessToken: REDACTED_CREDENTIAL }),
  });
  Object.defineProperty(credential, Symbol.for("nodejs.util.inspect.custom"), {
    enumerable: false,
    value: () => `RuntimeCredential(${credential.provider}, ${credential.connectionId ?? "anonymous"})`,
  });
  // The token is non-enumerable so spreads, Object.entries and structured
  // logging never pick it up by accident.
  Object.defineProperty(credential, "accessToken", {
    enumerable: false,
    value: input.accessToken,
    writable: false,
  });

  return Object.freeze(credential);
}

export interface ProviderIdentity {
  id: string;
  login: string;
  displayName: string;
  /** Additional provider-specific identifiers (Azure tenant/object id, etc.). */
  attributes?: Record<string, string> | undefined;
}

export interface ProviderAccount {
  id: string;
  name: string;
  kind: "user" | "organization" | "group" | "workspace" | "azure_organization";
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Normalized repository address. Provider IDs remain canonical; the path
 * segments are used for API addressing and display.
 */
export interface RepositoryLocator {
  provider: GitProviderType;
  host: string;
  /** GitHub owner, GitLab namespace path, Bitbucket workspace, Azure organization. */
  owner: string;
  /** Azure project or Bitbucket project key when known. */
  project?: string | undefined;
  name: string;
  fullName: string;
  providerRepositoryId?: string | undefined;
}

export interface ProviderRepository {
  providerRepositoryId: string;
  provider: GitProviderType;
  host: string;
  owner: string;
  namespace?: string | undefined;
  project?: string | undefined;
  name: string;
  fullName: string;
  hierarchy: string[];
  defaultBranch: string | null;
  webUrl: string | null;
  cloneUrl: string | null;
  isPrivate: boolean;
}

export interface RepositoryAccessResult {
  accessible: boolean;
  repository?: ProviderRepository | undefined;
  errorCode?: GitProviderErrorCode | undefined;
  message?: string | undefined;
}

export interface RepositoryTreeEntry {
  path: string;
  kind: "file" | "dir";
  size?: number | undefined;
}

export interface AuthorizationRequest {
  state: string;
  redirectUri: string;
  codeChallenge?: string | undefined;
  /** Self-managed host or Azure tenant when applicable. */
  host?: string | undefined;
  clientId?: string | undefined;
}

export interface AuthorizationCodeExchange {
  code: string;
  redirectUri: string;
  codeVerifier?: string | undefined;
  host?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

/**
 * Result of completing a provider authorization callback: what the connection
 * should record and the credential to encrypt (if any).
 */
export interface CompletedAuthorization {
  authType: GitConnectionAuthType;
  credential: ProviderCredential | null;
  identity: ProviderIdentity;
  accountId: string;
  accountName: string;
  installationId?: string | undefined;
  host: string;
  scopes: string[];
}

export interface GitProviderCapabilities {
  primaryAuth: "github_app_installation" | "oauth";
  supportsRefresh: boolean;
  supportsRevocation: boolean;
  supportsSelfManaged: boolean;
  supportsManualToken: boolean;
  usesPkce: boolean;
}

export interface ProviderRuntimeContext {
  fetcher?: FetchLike | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * The provider adapter contract. All provider-specific authentication and
 * repository API knowledge terminates behind this interface (INV-GIT-10).
 */
export interface GitProvider {
  readonly type: GitProviderType;
  readonly label: string;
  readonly capabilities: GitProviderCapabilities;
  readonly hierarchy: string[];
  readonly requestedAccess: string[];

  isConfigured(): boolean;
  configurationHint(): string | null;

  getAuthorizationUrl(request: AuthorizationRequest): Promise<string>;

  /**
   * Completes the provider callback. For OAuth providers this exchanges the
   * code; for GitHub Apps it verifies the installation belongs to the user.
   */
  completeAuthorization(
    callback: URLSearchParams,
    exchange: Omit<AuthorizationCodeExchange, "code">,
    context?: ProviderRuntimeContext,
  ): Promise<CompletedAuthorization>;

  refreshCredential?(
    credential: ProviderCredential,
    context?: ProviderRuntimeContext & { host?: string | undefined },
  ): Promise<ProviderCredential>;

  revokeCredential?(
    credential: ProviderCredential,
    context?: ProviderRuntimeContext & { host?: string | undefined },
  ): Promise<void>;

  /** Builds the runtime credential for a stored connection. */
  createRuntimeCredential(input: {
    connectionId: string | null;
    organizationId: string | null;
    authType: GitConnectionAuthType;
    host: string | null;
    installationId: string | null;
    accountScope?: string | null | undefined;
    credential: ProviderCredential | null;
  }, context?: ProviderRuntimeContext): Promise<RuntimeCredential>;

  getIdentity(credential: RuntimeCredential, context?: ProviderRuntimeContext): Promise<ProviderIdentity>;

  listAccounts?(credential: RuntimeCredential, context?: ProviderRuntimeContext): Promise<ProviderAccount[]>;

  listRepositories(
    credential: RuntimeCredential,
    options?: { cursor?: string | undefined; search?: string | undefined; pageSize?: number | undefined },
    context?: ProviderRuntimeContext,
  ): Promise<Paginated<ProviderRepository>>;

  getRepository(
    credential: RuntimeCredential,
    repository: RepositoryLocator,
    context?: ProviderRuntimeContext,
  ): Promise<ProviderRepository>;

  validateRepositoryAccess(
    credential: RuntimeCredential,
    repository: RepositoryLocator,
    context?: ProviderRuntimeContext,
  ): Promise<RepositoryAccessResult>;

  readFile(
    credential: RuntimeCredential,
    repository: RepositoryLocator,
    revision: string,
    path: string,
    context?: ProviderRuntimeContext & { maxBytes?: number | undefined },
  ): Promise<Buffer>;

  listTree(
    credential: RuntimeCredential,
    repository: RepositoryLocator,
    revision: string,
    context?: ProviderRuntimeContext & { maxEntries?: number | undefined; maxDepth?: number | undefined },
  ): Promise<RepositoryTreeEntry[]>;

  getDefaultBranch(
    credential: RuntimeCredential,
    repository: RepositoryLocator,
    context?: ProviderRuntimeContext,
  ): Promise<string>;

  resolveRevision(
    credential: RuntimeCredential,
    repository: RepositoryLocator,
    ref: string,
    context?: ProviderRuntimeContext,
  ): Promise<string>;

  /** Parses a provider URL (HTTPS or SSH) into a locator, or null when it is not this provider's. */
  parseRepositoryUrl(url: string, host?: string | undefined): RepositoryLocator | null;

  /** Returns scope warnings for a manually supplied token (e.g. write access granted). */
  inspectTokenPrivileges?(credential: RuntimeCredential, context?: ProviderRuntimeContext): Promise<string[]>;
}

/** Repository row fields the git subsystem reads (normalized). */
export interface ConnectedRepositoryRecord {
  id: string;
  organizationId: string;
  provider: GitProviderType;
  providerRepositoryId: string | null;
  providerConnectionId: string | null;
  host: string | null;
  owner: string;
  project: string | null;
  name: string;
  fullName: string;
  defaultBranch: string;
  canonicalUrl: string | null;
  visibility: string;
}
