import type { GitProvider } from "@savant/types";

import { isConcreteRepositoryProvider, type ConcreteRepositoryProvider } from "./repository-provider.ts";

export type RepositoryProviderConnectionStatus = "active" | "revoked" | "error";

export type RepositoryProviderConnectionRecord = {
  id: string;
  providerType: ConcreteRepositoryProvider;
  displayName: string;
  installationRef: string | null;
  credentialsRef: string;
  status: RepositoryProviderConnectionStatus;
  createdAt: Date | string;
};

export type ResolveRepositoryProviderConnectionInput = {
  organizationId: string;
  provider: GitProvider;
  connectionId?: string | undefined;
};

export interface RepositoryProviderConnectionStore {
  listConnections(
    input: ResolveRepositoryProviderConnectionInput,
  ): Promise<RepositoryProviderConnectionRecord[]>;
}

export class RepositoryProviderConnectionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "RepositoryProviderConnectionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isConfiguredSecretValue(value: string | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("<") || trimmed.includes("REPLACE") || trimmed.startsWith("placeholder-")) {
    return false;
  }

  return true;
}

function assertConcreteProvider(provider: GitProvider): ConcreteRepositoryProvider {
  if (!isConcreteRepositoryProvider(provider)) {
    throw new RepositoryProviderConnectionError(
      "repository_provider_connection_unsupported",
      `Provider '${provider}' does not support provider-backed connection resolution in the current MVP.`,
      409,
    );
  }

  return provider;
}

async function createDatabaseRepositoryProviderConnectionStore(): Promise<RepositoryProviderConnectionStore> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new RepositoryProviderConnectionError(
      "repository_provider_connection_unconfigured",
      "DATABASE_URL must be configured before provider-backed repository operations can run.",
      503,
    );
  }

  const sql = getControlPlaneDatabase();

  return {
    listConnections: async (input) => {
      const provider = assertConcreteProvider(input.provider);

      return sql<RepositoryProviderConnectionRecord[]>`
        select
          id,
          provider_type as "providerType",
          display_name as "displayName",
          installation_ref as "installationRef",
          credentials_ref as "credentialsRef",
          status,
          created_at as "createdAt"
        from git_provider_connections
        where organization_id = ${input.organizationId}
          and provider_type = ${provider}
          and (${input.connectionId ?? null}::uuid is null or id = ${input.connectionId ?? null}::uuid)
        order by created_at asc
      `;
    },
  };
}

export async function resolveRepositoryProviderConnection(
  input: ResolveRepositoryProviderConnectionInput,
  options?: {
    store?: RepositoryProviderConnectionStore | undefined;
  },
): Promise<RepositoryProviderConnectionRecord> {
  assertConcreteProvider(input.provider);

  const store = options?.store ?? await createDatabaseRepositoryProviderConnectionStore();
  const connections = await store.listConnections(input);

  if (input.connectionId) {
    const match = connections.find((connection) => connection.id === input.connectionId);

    if (!match) {
      throw new RepositoryProviderConnectionError(
        "repository_provider_connection_not_found",
        `Provider connection '${input.connectionId}' was not found for '${input.provider}'.`,
        404,
      );
    }

    if (match.status !== "active") {
      throw new RepositoryProviderConnectionError(
        "repository_provider_connection_inactive",
        `Provider connection '${match.displayName}' is not active.`,
        409,
      );
    }

    return match;
  }

  const activeConnections = connections.filter((connection) => connection.status === "active");

  if (activeConnections.length === 0) {
    throw new RepositoryProviderConnectionError(
      "repository_provider_connection_required",
      `Connect an active ${input.provider} provider connection before Savant can write to repositories.`,
      409,
    );
  }

  if (activeConnections.length > 1) {
    throw new RepositoryProviderConnectionError(
      "repository_provider_connection_ambiguous",
      `Multiple active ${input.provider} provider connections are available. Choose a specific connection before running a write operation.`,
      409,
    );
  }

  return activeConnections[0] as RepositoryProviderConnectionRecord;
}

export function resolveRepositoryProviderSecretFromRef(
  secretRef: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const normalizedRef = secretRef.trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedRef)) {
    throw new RepositoryProviderConnectionError(
      "repository_provider_secret_ref_invalid",
      `Secret reference '${secretRef}' is not a valid environment variable name.`,
      409,
    );
  }

  const value = env[normalizedRef];

  if (!isConfiguredSecretValue(value)) {
    throw new RepositoryProviderConnectionError(
      "repository_provider_secret_unavailable",
      `Secret reference '${normalizedRef}' is not configured in the runtime environment.`,
      503,
    );
  }

  return value.trim();
}

export function resolveRepositoryProviderAccessToken(
  connection: Pick<RepositoryProviderConnectionRecord, "credentialsRef">,
  env: Record<string, string | undefined> = process.env,
): string {
  return resolveRepositoryProviderSecretFromRef(connection.credentialsRef, env);
}