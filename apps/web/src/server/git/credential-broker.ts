import { GitProviderError, isConnectionAuthFailure, providerLabel } from "./errors.ts";
import { withGitSpan, type SpanHandle } from "./observability.ts";
import type { GitProviderRegistry } from "./providers/registry.ts";
import { logGitEvent } from "./redaction.ts";
import { decryptProviderCredential, encryptProviderCredential, type Env } from "./secret-vault.ts";
import type { GitAuditSink, GitConnectionRecord, GitConnectionStore } from "./stores.ts";
import type { CredentialAccess, GitProvider, ProviderCredential, ProviderRuntimeContext, RuntimeCredential } from "./types.ts";

/**
 * The only path from a connection id to a usable credential (spec §8).
 * Indexing code never reads secrets directly. The broker enforces that the
 * connection belongs to the requesting organization (INV-GIT-03), decrypts or
 * mints the credential, refreshes it when needed, and returns an ephemeral
 * RuntimeCredential that redacts itself on serialization.
 */

const REFRESH_SKEW_MS = 2 * 60 * 1000;
const ENV_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ResolvedCredential = {
  credential: RuntimeCredential;
  connection: GitConnectionRecord;
  provider: GitProvider;
};

export interface GitCredentialBroker {
  resolve(
    input: { organizationId: string; connectionId: string; access?: CredentialAccess | undefined },
    context?: ProviderRuntimeContext,
    parentSpan?: SpanHandle | null,
  ): Promise<ResolvedCredential>;
}

function readLegacyEnvCredential(connection: GitConnectionRecord, env: Env): ProviderCredential {
  const ref = connection.credentialsRef?.trim();

  if (!ref || !ENV_REF_PATTERN.test(ref)) {
    throw new GitProviderError("AUTH_REQUIRED", `The legacy credential reference for '${connection.displayName}' is invalid. Reauthorize ${providerLabel(connection.provider)}.`, {
      provider: connection.provider,
    });
  }

  const value = env[ref]?.trim();
  if (!value || value.startsWith("<") || value.includes("REPLACE") || value.startsWith("placeholder-")) {
    throw new GitProviderError(
      "AUTH_REQUIRED",
      `The deployment-managed credential for '${connection.displayName}' is not configured. Reauthorize using the Savant ${providerLabel(connection.provider)} integration.`,
      { provider: connection.provider },
    );
  }

  return { accessToken: value };
}

function needsRefresh(credential: ProviderCredential, nowMs: number): boolean {
  if (!credential.expiresAt || !credential.refreshToken) {
    return false;
  }
  return Date.parse(credential.expiresAt) - REFRESH_SKEW_MS <= nowMs;
}

export function createGitCredentialBroker(deps: {
  connections: GitConnectionStore;
  registry: GitProviderRegistry;
  audit?: GitAuditSink | undefined;
  env?: Env | undefined;
  now?: (() => number) | undefined;
}): GitCredentialBroker {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;

  async function markAuthFailure(connection: GitConnectionRecord, error: GitProviderError) {
    const status = error.code === "TOKEN_REVOKED" ? "revoked" : "needs_reauthorization";
    await deps.connections.updateConnection(connection.organizationId, connection.id, {
      status,
      lastErrorCode: error.code,
      lastErrorAt: new Date(now()).toISOString(),
    });
    await deps.audit?.record({
      organizationId: connection.organizationId,
      actorType: "system",
      actorRef: "git-credential-broker",
      action: "git_provider_validation_failed",
      targetType: "git_provider_connection",
      targetRef: connection.id,
      payload: { provider: connection.provider, connection_id: connection.id, error_code: error.code, status },
    }).catch(() => undefined);
  }

  async function loadStoredCredential(connection: GitConnectionRecord, provider: GitProvider, context?: ProviderRuntimeContext): Promise<ProviderCredential | null> {
    if (connection.authType === "github_app_installation") {
      return null;
    }

    if (connection.authType === "legacy_env") {
      return readLegacyEnvCredential(connection, env);
    }

    const binding = { purpose: "connection_credential" as const, organizationId: connection.organizationId, connectionId: connection.id };
    const stored = await deps.connections.readSecret(connection.organizationId, connection.id);
    if (!stored) {
      throw new GitProviderError("AUTH_REQUIRED", `No stored credential exists for '${connection.displayName}'. Reauthorize ${providerLabel(connection.provider)}.`, {
        provider: connection.provider,
      });
    }

    const credential = decryptProviderCredential(stored.encryptedPayload, binding, env);
    if (!needsRefresh(credential, now()) || !provider.refreshCredential) {
      return credential;
    }

    // Serialize refresh across instances; re-read after taking the lock since
    // another request may already have rotated the refresh token.
    return deps.connections.withSecretLock(connection.organizationId, connection.id, async (locked) => {
      const latest = await locked.readSecret(connection.organizationId, connection.id);
      const current = latest ? decryptProviderCredential(latest.encryptedPayload, binding, env) : credential;
      if (!needsRefresh(current, now())) {
        return current;
      }

      const refreshed = await provider.refreshCredential!(current, { ...context, host: connection.providerHost ?? undefined });
      const merged: ProviderCredential = {
        ...current,
        ...refreshed,
        refreshToken: refreshed.refreshToken ?? current.refreshToken,
      };
      const encrypted = encryptProviderCredential(merged, binding, env);
      await locked.writeSecret(connection.organizationId, connection.id, {
        encryptedPayload: encrypted.encryptedPayload,
        fingerprint: encrypted.fingerprint,
        keyVersion: encrypted.keyVersion,
        expiresAt: merged.expiresAt ?? null,
      });
      logGitEvent("info", "credential_refreshed", { provider: connection.provider, connection_id: connection.id });
      return merged;
    });
  }

  return {
    async resolve(input, context, parentSpan = null) {
      return withGitSpan("git.credential.resolve", { connection_id: input.connectionId, organization_id: input.organizationId }, async (span) => {
        const connection = await deps.connections.getConnection(input.organizationId, input.connectionId);

        // A connection owned by another organization is indistinguishable from a missing one.
        if (!connection || connection.organizationId !== input.organizationId) {
          throw new GitProviderError("CONNECTION_NOT_FOUND", "The provider connection was not found in this workspace.");
        }

        span.setAttribute("provider", connection.provider);
        const label = providerLabel(connection.provider);

        if (connection.status === "disconnected" || connection.status === "revoked") {
          throw new GitProviderError("TOKEN_REVOKED", `The ${label} connection '${connection.displayName}' was ${connection.status}. Reconnect ${label}.`, {
            provider: connection.provider,
          });
        }

        if (connection.status === "needs_reauthorization") {
          throw new GitProviderError("AUTH_REQUIRED", `The ${label} connection '${connection.displayName}' needs to be reauthorized.`, {
            provider: connection.provider,
          });
        }

        const provider = deps.registry.get(connection.provider);

        try {
          const stored = await loadStoredCredential(connection, provider, context);
          const credential = await provider.createRuntimeCredential({
            connectionId: connection.id,
            organizationId: connection.organizationId,
            authType: connection.authType,
            host: connection.providerHost,
            installationId: connection.providerInstallationId,
            accountScope: connection.providerScope,
            credential: stored,
            access: input.access ?? "read",
          }, context);

          return { credential, connection, provider };
        } catch (error) {
          if (error instanceof GitProviderError && isConnectionAuthFailure(error.code)) {
            await markAuthFailure(connection, error);
          }
          throw error;
        }
      }, parentSpan);
    },
  };
}
