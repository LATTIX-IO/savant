import type {
  RepoContractValidationPayload,
  RepoProvisionPayload,
  RepoProvisionRequest,
  RepositoryWriteCommitSummary,
} from "@savant/types";

import {
  connectTenantRepository,
} from "./repository-connect.ts";
import { tryRecordAuditEvent } from "./audit-events.ts";
import {
  RepositoryIndexError,
  indexTenantRepository,
} from "./repository-index.ts";
import {
  resolveRepositoryProviderAccessToken,
  resolveRepositoryProviderConnection,
  RepositoryProviderConnectionError,
} from "./repository-provider-connection.ts";
import { createProviderAuthenticatedFetch } from "./repository-provider-authenticated-fetch.ts";
import { type ParsedRepositoryLocator, parseRepositoryLocator } from "./repository-provider.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";
import { ensureRepositoryWebhookRegistration } from "./repository-webhooks.ts";
import { generateTenantSkillRepoBootstrapTemplate } from "./repository-scaffold.ts";
import { resolveRepositoryWriteAdapter } from "./repository-provider-write-adapter.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";
import {
  assertTenantWriteAccess,
  type TenantWriteAccessStore,
} from "./tenant-write-access.ts";

export class RepositoryProvisionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "RepositoryProvisionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assertProvisionReady(validation: RepoContractValidationPayload) {
  if (validation.ready) {
    return;
  }

  throw new RepositoryProvisionError(
    "repository_provision_contract_not_ready",
    "Repository contract validation must succeed before Savant can provision a repository.",
    409,
    validation.nextSteps.join(" ") || undefined,
  );
}

function assertRepositoryLocator(
  locator: ParsedRepositoryLocator,
): { ownerName: string; repoName: string } {
  if (!locator.owner || !locator.repository) {
    throw new RepositoryProvisionError(
      "invalid_repository_locator",
      "A concrete repository owner and repository name are required before Savant can provision a repository.",
      400,
    );
  }

  return {
    ownerName: locator.owner,
    repoName: locator.repository,
  };
}

function buildBootstrapCommitMessage(request: RepoProvisionRequest): string {
  return `feat(repo): bootstrap ${request.displayName}`;
}

function buildCommitSummary(commit: {
  commitSha: string;
  committedAt: string;
  url: string | null;
  changedPaths: string[];
}): RepositoryWriteCommitSummary {
  return {
    sha: commit.commitSha,
    committedAt: commit.committedAt,
    url: commit.url,
    changedPaths: commit.changedPaths,
  };
}

function resolveProvisionErrorCode(error: unknown): string {
  return error instanceof RepositoryProvisionError
    || error instanceof RepositoryProviderError
    || error instanceof RepositoryProviderConnectionError
    || error instanceof RepositoryIndexError
    ? error.code
    : "unexpected_error";
}

export async function provisionTenantRepository(input: {
  context: ResolvedTenantContext;
  request: RepoProvisionRequest;
  validation: RepoContractValidationPayload;
  locator: ParsedRepositoryLocator;
  now?: Date | undefined;
}, options?: {
  writeAccessStore?: TenantWriteAccessStore | undefined;
}): Promise<RepoProvisionPayload> {
  if (!input.context.identity) {
    throw new RepositoryProvisionError(
      "auth_required",
      "Sign in before provisioning a repository.",
      401,
    );
  }

  await assertTenantWriteAccess(
    {
      context: input.context,
      operation: "provision repositories",
    },
    {
      store: options?.writeAccessStore,
    },
  );

  assertProvisionReady(input.validation);

  const { ownerName, repoName } = assertRepositoryLocator(input.locator);
  const now = input.now ?? new Date();
  const provisionTargetRef = `${input.request.provider}:${input.locator.projectPath}`;

  await tryRecordAuditEvent({
    organizationId: input.context.tenant.organizationId,
    actorSubject: input.context.identity.subject,
    category: "repo",
    action: "repository_provision_requested",
    targetType: "repository",
    targetRef: provisionTargetRef,
    payload: {
      provider: input.request.provider,
      ownerName,
      repoName,
      defaultBranch: input.request.defaultBranch,
      visibility: input.request.visibility ?? "private",
      syncMode: input.request.syncMode ?? "poll",
      requestedConnectionId: input.request.connectionId ?? null,
    },
  });

  try {
    const connection = await resolveRepositoryProviderConnection({
      organizationId: input.context.tenant.organizationId,
      provider: input.request.provider,
      connectionId: input.request.connectionId,
    });
    const accessToken = resolveRepositoryProviderAccessToken(connection);
    const fetcher = createProviderAuthenticatedFetch(input.request.provider, accessToken);
    const adapter = resolveRepositoryWriteAdapter(input.request.provider, { fetcher });
    const bootstrap = generateTenantSkillRepoBootstrapTemplate(input.request);
    const metadata = await adapter.createRepository({
      owner: ownerName,
      name: input.locator.repository ?? input.request.displayName,
      defaultBranch: input.request.defaultBranch,
      description: `${input.request.displayName} Savant skill repository`,
      visibility: input.request.visibility ?? "private",
      baseUrl: new URL(input.locator.normalizedUrl).origin,
    });
    const provisionedLocator = parseRepositoryLocator({
      provider: input.request.provider,
      repoUrl: metadata.normalizedUrl,
    });

    if (!provisionedLocator) {
      throw new RepositoryProvisionError(
        "repository_locator_invalid",
        "The provisioned repository URL could not be parsed after creation.",
        502,
      );
    }

    const commit = await adapter.createCommit(provisionedLocator, {
      branch: input.request.defaultBranch,
      message: buildBootstrapCommitMessage(input.request),
      files: bootstrap.files,
    });
    const connected = await connectTenantRepository({
      context: input.context,
      request: {
        provider: input.request.provider,
        repoUrl: provisionedLocator.normalizedUrl,
        defaultBranch: input.request.defaultBranch,
        displayName: input.request.displayName,
        syncMode: input.request.syncMode,
      },
      validation: input.validation,
      locator: provisionedLocator,
      metadata,
      connectionId: connection.id,
      now,
    }, {
      writeAccessStore: options?.writeAccessStore,
    });

    const warnings: string[] = [];

    if (input.request.syncMode === "webhook") {
      const registration = await ensureRepositoryWebhookRegistration({
        organizationId: input.context.tenant.organizationId,
        repositoryId: connected.repository.id,
        provider: input.request.provider,
        locator: provisionedLocator,
        connectionId: connection.id,
        now,
      });

      if (registration.warning) {
        warnings.push(registration.warning);
      }
    }

    let repository = connected.repository;
    let indexedSkillCount = 0;

    try {
      const indexed = await indexTenantRepository({
        context: input.context,
        repositoryId: connected.repository.id,
        requestedAt: now,
        now,
      });

      repository = indexed.repository;
      indexedSkillCount = indexed.indexedSkillCount;
      warnings.push(...indexed.warnings);
    } catch (error) {
      if (
        error instanceof RepositoryIndexError
        || error instanceof RepositoryProviderError
        || error instanceof RepositoryProviderConnectionError
      ) {
        warnings.push(`Bootstrap commit succeeded, but inline indexing did not complete: ${error.message}`);
      } else {
        throw error;
      }
    }

    await tryRecordAuditEvent({
      organizationId: input.context.tenant.organizationId,
      actorSubject: input.context.identity.subject,
      category: "repo",
      action: "repository_provision_succeeded",
      targetType: "repository",
      targetRef: connected.repository.id,
      payload: {
        provider: input.request.provider,
        ownerName,
        repoName: provisionedLocator.repository ?? repoName,
        connectionId: connection.id,
        commitSha: commit.commitSha,
        indexedSkillCount,
        warningCount: warnings.length,
      },
    });

    return {
      repository,
      commit: buildCommitSummary(commit),
      indexedSkillCount,
      warnings,
    };
  } catch (error) {
    await tryRecordAuditEvent({
      organizationId: input.context.tenant.organizationId,
      actorSubject: input.context.identity.subject,
      category: "repo",
      action: "repository_provision_failed",
      targetType: "repository",
      targetRef: provisionTargetRef,
      payload: {
        provider: input.request.provider,
        ownerName,
        repoName,
        errorCode: resolveProvisionErrorCode(error),
      },
    });

    throw error;
  }
}