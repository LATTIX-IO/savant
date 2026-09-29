import { resolveRepositoryConnection } from "./connection-resolver.ts";
import type { GitCredentialBroker } from "./credential-broker.ts";
import { describeGitRemediation, GitProviderError, isConnectionAuthFailure } from "./errors.ts";
import { incrementGitMetric, observeGitMetric, withGitSpan } from "./observability.ts";
import { readRepositorySnapshot, type RepositoryReadLimits, type RepositorySnapshot } from "./repository-reader.ts";
import { logGitEvent } from "./redaction.ts";
import type { GitAuditSink, GitConnectionStore, GitRepositoryStore } from "./stores.ts";
import type {
  ConnectedRepositoryRecord,
  GitProviderErrorCode,
  ProviderRuntimeContext,
  RepositoryLocator,
} from "./types.ts";

/**
 * Repository sync pipeline (spec §18):
 *
 *   load repository → resolve exact connection → CredentialBroker.resolve()
 *   → validateRepositoryAccess → resolve ref → read tree → discover skills
 *   → validate skill definitions → atomically replace the index → indexedAt
 *
 * A failed sync records its error on the sync state only; the previously
 * committed index is never touched (INV-GIT-07). Repository existence and
 * indexing outcome stay separate (INV-GIT-06).
 */

export type SyncTrigger = "initial" | "manual" | "poll" | "webhook" | "reconciliation";

export type SyncActor = { type: "user" | "system"; ref: string };

/** The snapshot shape the existing index parser consumes. */
export type IndexSnapshotInput = {
  metadata: { externalId: string; defaultBranch: string; displayName: string; visibility: "private" | "public" | "internal" | "unknown" };
  defaultBranch: string;
  commitSha: string;
  observedPaths: string[];
  files: Record<string, string>;
};

export type IndexWriter<TParsed, TResult> = {
  /** Validates skill definitions; throwing here leaves the old index intact. */
  validate(snapshot: IndexSnapshotInput): TParsed;
  /** Atomically replaces the repository's index with the staged one and sets indexedAt. */
  commit(input: {
    organizationId: string;
    repositoryId: string;
    actor: SyncActor;
    snapshot: IndexSnapshotInput;
    parsed: TParsed;
    now: Date;
  }): Promise<TResult>;
  skillCount(parsed: TParsed): number;
};

export type RepositorySyncDeps<TParsed, TResult> = {
  connections: GitConnectionStore;
  repositories: GitRepositoryStore;
  broker: GitCredentialBroker;
  audit: GitAuditSink;
  writer: IndexWriter<TParsed, TResult>;
  /**
   * Anonymous read for public repositories that have no provider connection.
   * Never used when a connection exists (INV-GIT-01).
   */
  readAnonymousSnapshot?: ((repository: ConnectedRepositoryRecord, context?: ProviderRuntimeContext) => Promise<IndexSnapshotInput>) | undefined;
  limits?: RepositoryReadLimits | undefined;
  context?: ProviderRuntimeContext | undefined;
  staleSyncAfterMs?: number | undefined;
};

export type RepositorySyncResult<TResult> = {
  repositoryId: string;
  result: TResult;
  skillCount: number;
  commitSha: string;
  connectionId: string | null;
  durationMs: number;
};

const DEFAULT_STALE_SYNC_MS = 10 * 60 * 1000;

export function toLocator(repository: ConnectedRepositoryRecord): RepositoryLocator {
  return {
    provider: repository.provider,
    host: repository.host ?? "",
    owner: repository.owner,
    ...(repository.project ? { project: repository.project } : {}),
    name: repository.name,
    fullName: repository.fullName,
    ...(repository.providerRepositoryId ? { providerRepositoryId: repository.providerRepositoryId } : {}),
  };
}

export function normalizeSyncError(error: unknown): GitProviderError {
  if (error instanceof GitProviderError) {
    return error;
  }

  if (error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string") {
    const code = (error as { code: string }).code;
    // Index-parser and persistence failures keep their message but map to INDEX_FAILED.
    return new GitProviderError("INDEX_FAILED", error.message, { details: code, status: 500 });
  }

  return new GitProviderError("INDEX_FAILED", "Repository indexing failed unexpectedly.", { status: 500 });
}

/** Which sync-state status a failure produces; provider connection state is tracked separately. */
export function syncFailureStatus(code: GitProviderErrorCode): "error" | "auth_required" | "access_revoked" {
  if (code === "TOKEN_REVOKED") {
    return "access_revoked";
  }

  if (
    isConnectionAuthFailure(code)
    || code === "REPOSITORY_ACCESS_DENIED"
    || code === "INSUFFICIENT_SCOPE"
    || code === "CONNECTION_REQUIRED"
    || code === "CONNECTION_AMBIGUOUS"
    || code === "CONNECTION_NOT_FOUND"
  ) {
    return "auth_required";
  }

  return "error";
}

function toIndexSnapshot(snapshot: RepositorySnapshot): IndexSnapshotInput {
  return {
    metadata: {
      externalId: snapshot.repository.providerRepositoryId,
      defaultBranch: snapshot.defaultBranch,
      displayName: snapshot.repository.fullName,
      visibility: snapshot.repository.isPrivate ? "private" : "public",
    },
    defaultBranch: snapshot.defaultBranch,
    commitSha: snapshot.commitSha,
    observedPaths: snapshot.observedPaths,
    files: snapshot.files,
  };
}

export async function syncRepository<TParsed, TResult>(
  deps: RepositorySyncDeps<TParsed, TResult>,
  input: {
    organizationId: string;
    repositoryId: string;
    actor: SyncActor;
    trigger: SyncTrigger;
    ref?: string | null | undefined;
    now?: Date | undefined;
  },
): Promise<RepositorySyncResult<TResult>> {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const initial = input.trigger === "initial";
  const actions = initial
    ? { started: "repository_index_started", succeeded: "repository_index_succeeded", failed: "repository_index_failed" }
    : { started: "repository_sync_started", succeeded: "repository_sync_succeeded", failed: "repository_sync_failed" };

  return withGitSpan("repository.sync", { repository_id: input.repositoryId, organization_id: input.organizationId }, async (span) => {
    const repository = await deps.repositories.getRepository(input.organizationId, input.repositoryId);
    if (!repository) {
      throw new GitProviderError("REPOSITORY_NOT_FOUND", `Repository '${input.repositoryId}' was not found.`, { status: 404 });
    }
    span.setAttribute("provider", repository.provider);

    const claimed = await deps.repositories.claimSync(input.organizationId, repository.id, {
      now: now.toISOString(),
      staleAfterMs: deps.staleSyncAfterMs ?? DEFAULT_STALE_SYNC_MS,
      targetRevision: input.ref ?? null,
    });
    if (!claimed) {
      throw new GitProviderError("SYNC_ALREADY_RUNNING", `A sync is already running for ${repository.fullName}.`, { provider: repository.provider });
    }

    const auditBase = {
      organizationId: input.organizationId,
      actorType: input.actor.type,
      actorRef: input.actor.ref,
      targetType: "repository" as const,
      targetRef: repository.id,
    };
    await deps.audit.record({
      ...auditBase,
      action: actions.started,
      payload: { provider: repository.provider, repository_id: repository.id, trigger: input.trigger },
    }).catch(() => undefined);

    let connectionId: string | null = null;

    try {
      let snapshot: IndexSnapshotInput;
      let bindAfterSuccess: { connectionId: string; providerRepositoryId: string } | null = null;

      const resolution = await withGitSpan("git.connection.resolve", { provider: repository.provider }, async () => {
        try {
          return await resolveRepositoryConnection(deps, { organizationId: input.organizationId, repository });
        } catch (error) {
          if (
            error instanceof GitProviderError
            && error.code === "CONNECTION_REQUIRED"
            && repository.visibility === "public"
            && deps.readAnonymousSnapshot
          ) {
            return null;
          }
          throw error;
        }
      }, span);

      if (resolution) {
        connectionId = resolution.connection.id;
        span.setAttribute("connection_id", connectionId);
        const resolved = await deps.broker.resolve({ organizationId: input.organizationId, connectionId }, deps.context, span);
        const read = await readRepositorySnapshot({
          provider: resolved.provider,
          credential: resolved.credential,
          locator: toLocator(repository),
          ref: input.ref ?? repository.defaultBranch,
          limits: deps.limits,
          context: deps.context,
          span,
        });
        snapshot = toIndexSnapshot(read);

        // Make a fallback or stale association explicit once access is proven (INV-GIT-02).
        if (
          resolution.source !== "explicit"
          || repository.providerRepositoryId !== read.repository.providerRepositoryId
        ) {
          bindAfterSuccess = { connectionId, providerRepositoryId: read.repository.providerRepositoryId };
        }
      } else {
        snapshot = await deps.readAnonymousSnapshot!(repository, deps.context);
      }

      const parsed = await withGitSpan("skill.validation", { provider: repository.provider }, async () => deps.writer.validate(snapshot), span);
      const skillCount = deps.writer.skillCount(parsed);
      const result = await withGitSpan(
        "skill.index.commit",
        { provider: repository.provider, skill_count: skillCount },
        async () => deps.writer.commit({ organizationId: input.organizationId, repositoryId: repository.id, actor: input.actor, snapshot, parsed, now }),
        span,
      );

      if (bindAfterSuccess) {
        await deps.repositories.bindRepository(input.organizationId, repository.id, bindAfterSuccess.connectionId, bindAfterSuccess.providerRepositoryId);
      }

      const durationMs = Date.now() - startedAt;
      incrementGitMetric("git_repository_sync_total", { provider: repository.provider, result: "success" });
      observeGitMetric("git_repository_sync_duration_seconds", { provider: repository.provider }, durationMs / 1000);
      observeGitMetric("git_repository_indexed_skills", { provider: repository.provider }, skillCount);
      await deps.audit.record({
        ...auditBase,
        action: actions.succeeded,
        payload: {
          provider: repository.provider,
          repository_id: repository.id,
          connection_id: connectionId,
          provider_repository_id: bindAfterSuccess?.providerRepositoryId ?? repository.providerRepositoryId,
          skill_count: skillCount,
          duration_ms: durationMs,
          commit_sha: snapshot.commitSha,
          trigger: input.trigger,
        },
      }).catch(() => undefined);

      return { repositoryId: repository.id, result, skillCount, commitSha: snapshot.commitSha, connectionId, durationMs };
    } catch (caught) {
      const error = normalizeSyncError(caught);
      const status = syncFailureStatus(error.code);
      // Connection-resolution errors already say what to do; don't repeat it.
      const remediation = error.code.startsWith("CONNECTION_")
        ? null
        : describeGitRemediation({ code: error.code, provider: repository.provider, repositoryName: repository.fullName });
      const message = status === "error"
        ? error.message
        : `Repository connected, but Savant could not read it. ${error.message}${remediation ? ` ${remediation}` : ""}`;

      await deps.repositories.recordSyncFailure(input.organizationId, repository.id, {
        status,
        code: error.code,
        message,
        nextPollAt: error.retryable ? new Date(now.getTime() + 5 * 60 * 1000).toISOString() : null,
      });

      const durationMs = Date.now() - startedAt;
      incrementGitMetric("git_repository_sync_total", { provider: repository.provider, result: status });
      observeGitMetric("git_repository_sync_duration_seconds", { provider: repository.provider }, durationMs / 1000);
      logGitEvent("warn", "repository_sync_failed", {
        provider: repository.provider,
        repository_id: repository.id,
        connection_id: connectionId,
        error_code: error.code,
      });

      if (status !== "error") {
        await deps.audit.record({
          ...auditBase,
          action: "repository_access_failed",
          payload: { provider: repository.provider, repository_id: repository.id, connection_id: connectionId, error_code: error.code },
        }).catch(() => undefined);
      }
      await deps.audit.record({
        ...auditBase,
        action: actions.failed,
        payload: {
          provider: repository.provider,
          repository_id: repository.id,
          connection_id: connectionId,
          error_code: error.code,
          duration_ms: durationMs,
          trigger: input.trigger,
        },
      }).catch(() => undefined);

      throw new GitProviderError(error.code, message, { provider: repository.provider, status: error.status, retryAfterMs: error.retryAfterMs });
    }
  });
}
