import type {
  DiscoveredRepository,
  GitConnectionSummary,
  GitProviderDescriptor,
  GitProviderErrorCode,
} from "@savant/types";

import { assertGitPermission, type GitActor } from "./access-control.ts";
import type { GitCredentialBroker } from "./credential-broker.ts";
import { GitProviderError, isConnectionAuthFailure, providerLabel } from "./errors.ts";
import { validateProviderBaseUrl, type HostResolver } from "./host-validation.ts";
import { incrementGitMetric } from "./observability.ts";
import { consumeAuthorizationState, createAuthorizationState, sanitizeReturnPath } from "./oauth-state.ts";
import { resolveGitOAuthRedirectUri } from "./provider-config.ts";
import type { GitProviderRegistry } from "./providers/registry.ts";
import { logGitEvent } from "./redaction.ts";
import { decryptProviderCredential, encryptProviderCredential, isGitCredentialVaultConfigured, type Env } from "./secret-vault.ts";
import type { GitConnectionRecord, GitStores } from "./stores.ts";
import { toLocator } from "./repository-sync-service.ts";
import type { CompletedAuthorization, GitProvider, GitProviderType, ProviderCredential, ProviderRuntimeContext } from "./types.ts";

export type GitConnectionServiceDeps = {
  stores: GitStores;
  registry: GitProviderRegistry;
  broker: GitCredentialBroker;
  env?: Env | undefined;
  context?: ProviderRuntimeContext | undefined;
  resolveHost?: HostResolver | undefined;
  now?: (() => Date) | undefined;
};

export function toConnectionSummary(connection: GitConnectionRecord, repositoryCount: number): GitConnectionSummary {
  // Explicit field list: secrets, secret ids and env var names never leave the server.
  return {
    id: connection.id,
    provider: connection.provider,
    displayName: connection.displayName,
    authType: connection.authType,
    status: connection.status,
    providerHost: connection.providerHost,
    providerAccountName: connection.providerAccountName,
    providerAccountId: connection.providerAccountId,
    scopes: connection.scopes,
    repositoryCount,
    lastValidatedAt: connection.lastValidatedAt,
    lastErrorCode: connection.lastErrorCode,
    lastErrorAt: connection.lastErrorAt,
    createdAt: connection.createdAt,
    isLegacy: connection.authType === "legacy_env",
    credentialStored: connection.authType === "github_app_installation" || connection.secretId !== null || connection.credentialsRef !== null,
  };
}

function defaultReturnPath(workspaceSlug: string | null | undefined): string {
  return workspaceSlug ? `/o/${encodeURIComponent(workspaceSlug)}/settings?section=source-control` : "/settings?section=source-control";
}

function connectionDisplayName(provider: GitProvider, completed: CompletedAuthorization): string {
  const host = completed.host && !["github.com", "gitlab.com", "bitbucket.org", "dev.azure.com"].includes(completed.host)
    ? ` (${completed.host})`
    : "";
  return `${completed.accountName}${host}`.slice(0, 120) || provider.label;
}

export function createGitConnectionService(deps: GitConnectionServiceDeps) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const { stores, registry, broker } = deps;

  async function audit(actor: GitActor | { organizationId: string; subject: string }, action: string, connectionId: string, payload: Record<string, unknown>) {
    await stores.audit.record({
      organizationId: actor.organizationId,
      actorType: "user",
      actorRef: actor.subject,
      action,
      targetType: "git_provider_connection",
      targetRef: connectionId,
      payload: { connection_id: connectionId, ...payload },
    }).catch((error: unknown) => logGitEvent("error", "audit_write_failed", { action, error }));
  }

  async function requireConnection(organizationId: string, connectionId: string): Promise<GitConnectionRecord> {
    const connection = await stores.connections.getConnection(organizationId, connectionId);
    if (!connection) {
      throw new GitProviderError("CONNECTION_NOT_FOUND", "The provider connection was not found in this workspace.");
    }
    return connection;
  }

  async function summarize(organizationId: string, connections: GitConnectionRecord[]): Promise<GitConnectionSummary[]> {
    const counts = await stores.connections.countRepositories(organizationId, connections.map((connection) => connection.id));
    return connections.map((connection) => toConnectionSummary(connection, counts[connection.id] ?? 0));
  }

  async function persistCredential(connection: GitConnectionRecord, credential: ProviderCredential | null) {
    if (!credential) {
      await stores.connections.deleteSecret(connection.organizationId, connection.id);
      return;
    }

    const encrypted = encryptProviderCredential(credential, {
      purpose: "connection_credential",
      organizationId: connection.organizationId,
      connectionId: connection.id,
    }, env);
    await stores.connections.writeSecret(connection.organizationId, connection.id, {
      encryptedPayload: encrypted.encryptedPayload,
      fingerprint: encrypted.fingerprint,
      keyVersion: encrypted.keyVersion,
      expiresAt: credential.expiresAt ?? null,
    });
  }

  /**
   * Binds existing repositories that have no connection yet (e.g. the
   * LATTIX-IO/lattix-skills recovery case) to a newly authorized connection,
   * only when the provider confirms read access and the match is unique.
   */
  async function reconcileRepositories(connection: GitConnectionRecord, actor: { organizationId: string; subject: string }): Promise<string[]> {
    const unbound = await stores.repositories.listUnboundRepositories(connection.organizationId, connection.provider);
    if (unbound.length === 0) {
      return [];
    }

    const compatibleConnections = (await stores.connections.listConnections(connection.organizationId, { provider: connection.provider }))
      .filter((candidate) => candidate.status === "active");
    const resolved = await broker.resolve({ organizationId: connection.organizationId, connectionId: connection.id }, deps.context);
    const bound: string[] = [];

    for (const repository of unbound) {
      if (connection.providerHost && repository.host && connection.providerHost !== repository.host) {
        continue;
      }

      try {
        const access = await resolved.provider.validateRepositoryAccess(resolved.credential, toLocator(repository), deps.context);
        if (!access.accessible || !access.repository) {
          continue;
        }

        if (repository.providerRepositoryId && repository.providerRepositoryId !== access.repository.providerRepositoryId) {
          // Same name, different repository: never auto-bind.
          continue;
        }

        // Another active connection also able to read it would make this ambiguous;
        // only the connection just authorized is probed, so ambiguity means other
        // candidates exist that are not this one — leave it for the user to choose.
        const otherCandidates = compatibleConnections.filter((candidate) => candidate.id !== connection.id && candidate.authType !== "legacy_env");
        if (otherCandidates.length > 0) {
          continue;
        }

        await stores.repositories.bindRepository(connection.organizationId, repository.id, connection.id, access.repository.providerRepositoryId);
        bound.push(repository.id);
      } catch (error) {
        logGitEvent("warn", "reconciliation_probe_failed", { provider: connection.provider, repository_id: repository.id, error });
      }
    }

    if (bound.length > 0) {
      await audit(actor, "git_provider_connected", connection.id, {
        provider: connection.provider,
        reconciled_repository_count: bound.length,
        reason: "reconciliation",
      });
    }

    return bound;
  }

  return {
    listProviders(): GitProviderDescriptor[] {
      return registry.list().map((provider) => ({
        type: provider.type,
        label: provider.label,
        configured: provider.isConfigured() && isGitCredentialVaultConfigured(env),
        primaryAuth: provider.capabilities.primaryAuth,
        supportsSelfManaged: provider.capabilities.supportsSelfManaged,
        supportsManualToken: provider.capabilities.supportsManualToken,
        hierarchy: provider.hierarchy,
        requestedAccess: provider.requestedAccess,
        configurationHint: isGitCredentialVaultConfigured(env)
          ? provider.configurationHint()
          : "Set GIT_CREDENTIAL_ENCRYPTION_KEY (32-byte key) so provider credentials can be encrypted at rest.",
      }));
    },

    async listConnections(actor: GitActor): Promise<GitConnectionSummary[]> {
      assertGitPermission(actor, "view");
      return summarize(actor.organizationId, await stores.connections.listConnections(actor.organizationId));
    },

    async getConnection(actor: GitActor, connectionId: string): Promise<GitConnectionSummary> {
      assertGitPermission(actor, "view");
      const [summary] = await summarize(actor.organizationId, [await requireConnection(actor.organizationId, connectionId)]);
      return summary as GitConnectionSummary;
    },

    async startAuthorization(actor: GitActor, input: {
      provider: GitProviderType;
      workspaceSlug?: string | null | undefined;
      returnPath?: string | null | undefined;
      host?: string | null | undefined;
      clientId?: string | null | undefined;
      clientSecret?: string | null | undefined;
      reauthorizeConnectionId?: string | null | undefined;
    }): Promise<string> {
      assertGitPermission(actor, input.reauthorizeConnectionId ? "reauthorize_provider" : "connect_provider");
      const provider = registry.get(input.provider);

      if (!isGitCredentialVaultConfigured(env)) {
        throw new GitProviderError("PROVIDER_NOT_CONFIGURED", "GIT_CREDENTIAL_ENCRYPTION_KEY must be configured before connecting Git providers.");
      }

      let host: string | null = null;
      let clientId: string | undefined;
      let clientSecret: string | undefined;

      if (input.reauthorizeConnectionId) {
        const existing = await requireConnection(actor.organizationId, input.reauthorizeConnectionId);
        if (existing.provider !== input.provider) {
          throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "The connection belongs to a different provider.");
        }
        host = existing.providerHost;
      }

      if (input.host?.trim()) {
        if (!provider.capabilities.supportsSelfManaged) {
          throw new GitProviderError("PROVIDER_HOST_REJECTED", `${provider.label} does not support self-managed instances.`);
        }
        const validated = await validateProviderBaseUrl(input.host, { env, resolve: deps.resolveHost });
        host = validated.host;
      }

      const selfManaged = Boolean(host && provider.capabilities.supportsSelfManaged && host !== "gitlab.com");
      if (selfManaged) {
        clientId = input.clientId?.trim() || undefined;
        clientSecret = input.clientSecret?.trim() || undefined;
        if (!clientId || !clientSecret) {
          throw new GitProviderError("PROVIDER_NOT_CONFIGURED", `Enter the OAuth application ID and secret registered on ${host}.`);
        }
      } else if (!provider.isConfigured()) {
        throw new GitProviderError("PROVIDER_NOT_CONFIGURED", provider.configurationHint() ?? `${provider.label} is not configured.`, { provider: provider.type });
      }

      const created = await createAuthorizationState(stores.oauthStates, {
        organizationId: actor.organizationId,
        userSubject: actor.subject,
        provider: provider.type,
        providerHost: host,
        returnPath: sanitizeReturnPath(input.returnPath, defaultReturnPath(input.workspaceSlug)),
        usePkce: provider.capabilities.usesPkce,
        clientId,
        clientSecret,
        reauthorizeConnectionId: input.reauthorizeConnectionId ?? null,
        now: now(),
        env,
      });

      await audit(actor, "git_provider_authorization_started", input.reauthorizeConnectionId ?? "new", {
        provider: provider.type,
        provider_host: host,
        reason: input.reauthorizeConnectionId ? "reauthorize" : "connect",
      });

      return provider.getAuthorizationUrl({
        state: created.state,
        redirectUri: resolveGitOAuthRedirectUri(provider.type, env),
        codeChallenge: created.codeChallenge,
        ...(host ? { host } : {}),
        ...(clientId ? { clientId } : {}),
      });
    },

    /**
     * Completes a provider callback. The organization comes exclusively from
     * the stored state; query parameters never select a tenant.
     */
    async completeAuthorization(input: {
      provider: GitProviderType;
      query: URLSearchParams;
      userSubject: string | null | undefined;
      /** Re-checks that the user still holds the right role in the state's organization. */
      verifyActor?: ((organizationId: string, subject: string) => Promise<GitActor>) | undefined;
    }): Promise<{
      connection: GitConnectionSummary;
      created: boolean;
      returnPath: string;
      /** Repositories to (re)sync now: newly reconciled ones plus those already bound to a reauthorized connection. */
      repositoryIdsToSync: string[];
      organizationId: string;
      actorSubject: string;
    }> {
      const provider = registry.get(input.provider);
      const consumed = await consumeAuthorizationState(stores.oauthStates, {
        state: input.query.get("state"),
        provider: provider.type,
        userSubject: input.userSubject,
        now: now(),
        env,
      });
      const actor = { organizationId: consumed.organizationId, subject: consumed.userSubject };

      if (input.verifyActor) {
        assertGitPermission(
          await input.verifyActor(consumed.organizationId, consumed.userSubject),
          consumed.reauthorizeConnectionId ? "reauthorize_provider" : "connect_provider",
        );
      }

      const completed = await provider.completeAuthorization(input.query, {
        redirectUri: resolveGitOAuthRedirectUri(provider.type, env),
        codeVerifier: consumed.payload.codeVerifier,
        ...(consumed.providerHost ? { host: consumed.providerHost } : {}),
        ...(consumed.payload.clientId ? { clientId: consumed.payload.clientId } : {}),
        ...(consumed.payload.clientSecret ? { clientSecret: consumed.payload.clientSecret } : {}),
      }, deps.context);

      if (consumed.reauthorizeConnectionId) {
        const existing = await requireConnection(consumed.organizationId, consumed.reauthorizeConnectionId);
        const sameAccount = (existing.providerInstallationId ?? existing.providerAccountId) === (completed.installationId ?? completed.accountId);
        if (existing.authType !== "legacy_env" && existing.providerAccountId && !sameAccount) {
          throw new GitProviderError(
            "AUTHORIZATION_STATE_INVALID",
            `Reauthorization used a different ${provider.label} account (${completed.accountName}). Use the original account or connect it as a new connection.`,
          );
        }
      }

      const { connection, created } = await stores.connections.upsertConnection(consumed.organizationId, {
        provider: provider.type,
        displayName: connectionDisplayName(provider, completed),
        authType: completed.authType,
        providerHost: completed.host || null,
        providerAccountId: completed.accountId,
        providerAccountName: completed.accountName,
        providerInstallationId: completed.installationId ?? null,
        providerScope: null,
        scopes: completed.scopes,
        createdBySubject: consumed.userSubject,
        connectionId: consumed.reauthorizeConnectionId ?? undefined,
      });
      await persistCredential(connection, completed.credential);

      incrementGitMetric("git_connection_total", { provider: provider.type, status: "active" });
      await audit(actor, consumed.reauthorizeConnectionId || !created ? "git_provider_reauthorized" : "git_provider_connected", connection.id, {
        provider: provider.type,
        auth_type: completed.authType,
        provider_host: completed.host,
        provider_account_name: completed.accountName,
      });

      let reconciledRepositoryIds: string[] = [];
      try {
        reconciledRepositoryIds = await reconcileRepositories(connection, actor);
      } catch (error) {
        logGitEvent("warn", "reconciliation_failed", { provider: provider.type, connection_id: connection.id, error });
      }

      // Repositories already bound to a reauthorized connection were marked auth_required; retry them.
      const alreadyBound = created ? [] : await stores.repositories.listRepositoryIdsForConnection(consumed.organizationId, connection.id);
      const [summary] = await summarize(consumed.organizationId, [connection]);
      return {
        connection: summary as GitConnectionSummary,
        created,
        returnPath: consumed.returnPath,
        repositoryIdsToSync: [...new Set([...reconciledRepositoryIds, ...alreadyBound])],
        organizationId: consumed.organizationId,
        actorSubject: consumed.userSubject,
      };
    },

    async validateConnection(actor: GitActor, connectionId: string): Promise<{
      connection: GitConnectionSummary;
      healthy: boolean;
      errorCode: GitProviderErrorCode | null;
      message: string;
    }> {
      assertGitPermission(actor, "validate_provider");
      const connection = await requireConnection(actor.organizationId, connectionId);
      const timestamp = now().toISOString();
      let errorCode: GitProviderErrorCode | null = null;
      let message: string;

      try {
        // credential can be obtained → identity can be read → enumeration succeeds
        const resolved = await broker.resolve({ organizationId: actor.organizationId, connectionId }, deps.context);
        const identity = await resolved.provider.getIdentity(resolved.credential, deps.context);
        await resolved.provider.listRepositories(resolved.credential, { pageSize: 1 }, deps.context);
        await stores.connections.updateConnection(actor.organizationId, connectionId, {
          status: "active",
          lastValidatedAt: timestamp,
          lastErrorCode: null,
          lastErrorAt: null,
        });
        message = `Connected as ${identity.login}.`;
      } catch (caught) {
        const error = caught instanceof GitProviderError ? caught : new GitProviderError("PROVIDER_UNAVAILABLE", "Validation failed unexpectedly.");
        errorCode = error.code;
        message = error.message;
        // Transient provider problems do not invalidate the authorization (spec §31).
        const status = isConnectionAuthFailure(error.code)
          ? (error.code === "TOKEN_REVOKED" ? "revoked" : "needs_reauthorization")
          : error.code === "INSUFFICIENT_SCOPE" ? "needs_reauthorization" : error.retryable ? connection.status : "error";
        await stores.connections.updateConnection(actor.organizationId, connectionId, {
          status: connection.status === "disconnected" ? "disconnected" : status,
          lastValidatedAt: timestamp,
          lastErrorCode: error.code,
          lastErrorAt: timestamp,
        });
        await audit(actor, "git_provider_validation_failed", connectionId, { provider: connection.provider, error_code: error.code, status });
      }

      const refreshed = await requireConnection(actor.organizationId, connectionId);
      const [summary] = await summarize(actor.organizationId, [refreshed]);
      return { connection: summary as GitConnectionSummary, healthy: errorCode === null, errorCode, message };
    },

    async disconnectConnection(actor: GitActor, connectionId: string): Promise<{ connection: GitConnectionSummary; repositoriesMarked: number; revokedRemotely: boolean }> {
      assertGitPermission(actor, "disconnect_provider");
      const connection = await requireConnection(actor.organizationId, connectionId);
      const provider = registry.get(connection.provider);
      let revokedRemotely = false;

      if (provider.revokeCredential && connection.authType === "oauth") {
        try {
          const stored = await stores.connections.readSecret(actor.organizationId, connectionId);
          if (stored) {
            const credential = decryptProviderCredential(stored.encryptedPayload, {
              purpose: "connection_credential",
              organizationId: actor.organizationId,
              connectionId,
            }, env);
            await provider.revokeCredential(credential, { ...deps.context, host: connection.providerHost ?? undefined });
            revokedRemotely = true;
          }
        } catch (error) {
          logGitEvent("warn", "remote_revocation_failed", { provider: connection.provider, connection_id: connectionId, error });
        }
      }

      await stores.connections.deleteSecret(actor.organizationId, connectionId);
      const updated = await stores.connections.updateConnection(actor.organizationId, connectionId, { status: "disconnected" });

      // Repository metadata and indexed content are preserved (INV-GIT-12).
      const repositoryIds = await stores.repositories.listRepositoryIdsForConnection(actor.organizationId, connectionId);
      await stores.repositories.markRepositoriesSyncStatus(actor.organizationId, repositoryIds, {
        status: "auth_required",
        code: "TOKEN_REVOKED",
        message: `The ${providerLabel(connection.provider)} connection '${connection.displayName}' was disconnected. Reconnect ${providerLabel(connection.provider)} to resume syncing.`,
      });

      incrementGitMetric("git_connection_total", { provider: connection.provider, status: "disconnected" });
      await audit(actor, "git_provider_disconnected", connectionId, {
        provider: connection.provider,
        revoked_remotely: revokedRemotely,
        repositories_marked_auth_required: repositoryIds.length,
      });

      const [summary] = await summarize(actor.organizationId, [updated ?? connection]);
      return { connection: summary as GitConnectionSummary, repositoriesMarked: repositoryIds.length, revokedRemotely };
    },

    async listDiscoveredRepositories(actor: GitActor, connectionId: string, options: { cursor?: string | undefined; search?: string | undefined }): Promise<{
      items: DiscoveredRepository[];
      nextCursor: string | null;
    }> {
      assertGitPermission(actor, "connect_repository");
      const resolved = await broker.resolve({ organizationId: actor.organizationId, connectionId }, deps.context);
      const page = await resolved.provider.listRepositories(resolved.credential, {
        cursor: options.cursor,
        search: options.search?.trim().slice(0, 100) || undefined,
        pageSize: 50,
      }, deps.context);
      const connected = await stores.repositories.listConnectedProviderIds(
        actor.organizationId,
        resolved.connection.provider,
        page.items.map((item) => item.providerRepositoryId),
      );

      return {
        items: page.items.map((item) => ({
          providerRepositoryId: item.providerRepositoryId,
          name: item.name,
          fullName: item.fullName,
          hierarchy: item.hierarchy,
          defaultBranch: item.defaultBranch,
          isPrivate: item.isPrivate,
          webUrl: item.webUrl,
          connectedRepositoryId: connected[item.providerRepositoryId] ?? null,
        })),
        nextCursor: page.nextCursor,
      };
    },

    /**
     * Advanced manual token flow (spec §41): entered once, validated before
     * save, encrypted immediately, never rendered again.
     */
    async connectManualToken(actor: GitActor, input: {
      provider: GitProviderType;
      token: string;
      displayName?: string | undefined;
      host?: string | undefined;
      organization?: string | undefined;
    }): Promise<{ connection: GitConnectionSummary; warnings: string[] }> {
      assertGitPermission(actor, "connect_provider");
      const provider = registry.get(input.provider);

      if (!provider.capabilities.supportsManualToken) {
        throw new GitProviderError("PROVIDER_NOT_CONFIGURED", `${provider.label} does not support manual tokens.`);
      }
      if (!isGitCredentialVaultConfigured(env)) {
        throw new GitProviderError("PROVIDER_NOT_CONFIGURED", "GIT_CREDENTIAL_ENCRYPTION_KEY must be configured before storing credentials.");
      }

      const token = input.token.trim();
      if (token.length < 8 || token.length > 4096 || /\s/.test(token)) {
        throw new GitProviderError("INVALID_REQUEST", "Enter a valid access token.");
      }

      let host: string | null = null;
      if (input.host?.trim()) {
        if (!provider.capabilities.supportsSelfManaged) {
          throw new GitProviderError("PROVIDER_HOST_REJECTED", `${provider.label} does not support self-managed instances.`);
        }
        host = (await validateProviderBaseUrl(input.host, { env, resolve: deps.resolveHost })).host;
      }

      const accountScope = input.organization?.trim() || null;
      const credential: ProviderCredential = { accessToken: token };
      const runtime = await provider.createRuntimeCredential({
        connectionId: null,
        organizationId: actor.organizationId,
        authType: "pat",
        host,
        installationId: null,
        accountScope,
        credential,
      }, deps.context);

      // Validation occurs before anything is saved.
      const identity = await provider.getIdentity(runtime, deps.context);
      await provider.listRepositories(runtime, { pageSize: 1 }, deps.context);
      const warnings = provider.inspectTokenPrivileges ? await provider.inspectTokenPrivileges(runtime, deps.context).catch(() => []) : [];

      const { connection } = await stores.connections.upsertConnection(actor.organizationId, {
        provider: provider.type,
        displayName: (input.displayName?.trim() || `${identity.login} (token)`).slice(0, 120),
        authType: "pat",
        providerHost: host ?? runtime.host,
        providerAccountId: accountScope ? `${accountScope}:${identity.id}` : identity.id,
        providerAccountName: identity.login,
        providerInstallationId: null,
        providerScope: accountScope,
        scopes: [],
        createdBySubject: actor.subject,
      });
      await persistCredential(connection, credential);
      incrementGitMetric("git_connection_total", { provider: provider.type, status: "active" });
      await audit(actor, "git_provider_connected", connection.id, { provider: provider.type, auth_type: "pat", provider_account_name: identity.login });

      let reconciled: string[] = [];
      try {
        reconciled = await reconcileRepositories(connection, actor);
      } catch (error) {
        logGitEvent("warn", "reconciliation_failed", { provider: provider.type, connection_id: connection.id, error });
      }

      const [summary] = await summarize(actor.organizationId, [await requireConnection(actor.organizationId, connection.id)]);
      return { connection: summary as GitConnectionSummary, warnings: reconciled.length > 0 ? [...warnings, `${reconciled.length} existing repositories were linked to this connection.`] : warnings };
    },

    /** Resolves CONNECTION_AMBIGUOUS by explicitly choosing the connection for a repository. */
    async assignRepositoryConnection(actor: GitActor, repositoryId: string, connectionId: string): Promise<void> {
      assertGitPermission(actor, "configure_repository_access");
      const repository = await stores.repositories.getRepository(actor.organizationId, repositoryId);
      if (!repository) {
        throw new GitProviderError("REPOSITORY_NOT_FOUND", "The repository was not found in this workspace.", { status: 404 });
      }
      const resolved = await broker.resolve({ organizationId: actor.organizationId, connectionId }, deps.context);
      if (resolved.connection.provider !== repository.provider) {
        throw new GitProviderError("CONNECTION_NOT_FOUND", "That connection belongs to a different provider.");
      }
      const access = await resolved.provider.validateRepositoryAccess(resolved.credential, toLocator(repository), deps.context);
      if (!access.accessible || !access.repository) {
        throw new GitProviderError(access.errorCode ?? "REPOSITORY_ACCESS_DENIED", access.message ?? "That connection cannot read this repository.");
      }
      await stores.repositories.bindRepository(actor.organizationId, repositoryId, connectionId, access.repository.providerRepositoryId);
      await stores.audit.record({
        organizationId: actor.organizationId,
        actorType: "user",
        actorRef: actor.subject,
        action: "repository_connection_assigned",
        targetType: "repository",
        targetRef: repositoryId,
        payload: { provider: repository.provider, repository_id: repositoryId, connection_id: connectionId, provider_repository_id: access.repository.providerRepositoryId },
      }).catch(() => undefined);
    },

    reconcileRepositories,
  };
}

export type GitConnectionService = ReturnType<typeof createGitConnectionService>;
