import type {
  SkillListItem,
  SkillSourcePayload,
  SkillSourceResponse,
  SkillSourceUpdatePayload,
  SkillSourceUpdateRequest,
} from "@savant/types";

import {
  buildFallbackSkillSourceContent,
  MAX_SKILL_SOURCE_LENGTH,
} from "../../lib/skill-builder.ts";
import { findSkillByIdentifier } from "../../lib/skill-paths.ts";

import { tryRecordAuditEvent } from "./audit-events.ts";
import { createControlPlaneMeta } from "./control-plane-response.ts";
import { indexTenantRepository, RepositoryIndexError } from "./repository-index.ts";
import {
  RepositoryProviderConnectionError,
  resolveRepositoryProviderAccessToken,
  resolveRepositoryProviderConnection,
  type RepositoryProviderConnectionRecord,
} from "./repository-provider-connection.ts";
import { createProviderAuthenticatedFetch } from "./repository-provider-authenticated-fetch.ts";
import { readGitHubRepositoryTextFile } from "./repository-provider-github.ts";
import { readGitLabRepositoryTextFile } from "./repository-provider-gitlab.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";
import { parseRepositoryLocator } from "./repository-provider.ts";
import { resolveRepositoryWriteAdapter } from "./repository-provider-write-adapter.ts";
import { readOptionalString } from "./request-validation.ts";
import { readSkillsFromDatabase, type TenantReadContext } from "./read-model-db.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";
import {
  assertTenantWriteAccess,
  TenantWriteAccessError,
} from "./tenant-write-access.ts";

export class SkillSourceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "SkillSourceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type JsonObject = Record<string, unknown>;

type SkillSourceQueryRow = {
  repositoryId: string;
  providerType: SkillListItem["repoProvider"];
  defaultBranch: string | null;
  connectionId: string | null;
  canonicalCloneUrl: string | null;
  sourcePath: string;
  sourceCommitSha: string | null;
};

type LoadedSkillSourceRecord = {
  skill: SkillListItem;
  sourceRow: SkillSourceQueryRow | null;
};

function buildTenantReadContext(context: ResolvedTenantContext): TenantReadContext {
  return {
    identity: context.identity
      ? {
          subject: context.identity.subject,
          email: context.identity.email,
          displayName: context.identity.displayName,
        }
      : null,
    tenant: context.tenant,
    memberships: context.memberships,
    isDevelopmentFallback: context.isDevelopmentFallback,
  };
}

function toFallbackSourcePayload(
  skill: SkillListItem,
  options?: { saveDisabledReason?: string | undefined },
): SkillSourcePayload {
  return {
    skillId: skill.id,
    skillUuid: skill.skillUuid,
    name: skill.name,
    repository: skill.repo,
    repoProvider: skill.repoProvider,
    branch: skill.branch,
    sourcePath: skill.projection.sourcePath ?? "SKILL.md",
    sourceCommitSha: skill.projection.sourceCommitSha,
    contentSha: null,
    content: buildFallbackSkillSourceContent({
      skillId: skill.id,
      skillUuid: skill.skillUuid,
      name: skill.name,
      description: skill.description,
      tier: skill.tier,
      owner: skill.owner,
      team: skill.team,
      repo: skill.repo,
      repoProvider: skill.repoProvider,
      branch: skill.branch,
      ref: skill.ref,
      candidateRef: skill.candidateRef,
    }),
    mode: "fallback",
    canSave: false,
    ...(options?.saveDisabledReason
      ? { saveDisabledReason: options.saveDisabledReason }
      : {
          saveDisabledReason: "Live SKILL.md editing requires an indexed repository with a supported provider-backed connection.",
        }),
  };
}

function supportsLiveSkillSource(provider: SkillListItem["repoProvider"]): boolean {
  return provider === "github" || provider === "gitlab";
}

async function loadControlPlaneDatabase() {
  const { getControlPlaneDatabase } = await import("./database.ts");
  return getControlPlaneDatabase();
}

async function loadSkillSourceRecord(
  context: ResolvedTenantContext,
  id: string,
): Promise<LoadedSkillSourceRecord | null> {
  const skills = (await readSkillsFromDatabase(buildTenantReadContext(context))).data;
  const skill = findSkillByIdentifier(skills, id);

  if (!skill) {
    return null;
  }

  if (context.isDevelopmentFallback) {
    return {
      skill,
      sourceRow: null,
    };
  }

  const sql = await loadControlPlaneDatabase();
  const rows = await sql<SkillSourceQueryRow[]>`
    select distinct on (indexed_skills.skill_id)
      repositories.id as "repositoryId",
      repositories.provider_type as "providerType",
      coalesce(indexed_skills.default_branch, repositories.default_branch) as "defaultBranch",
      repositories.connection_id as "connectionId",
      repositories.canonical_clone_url as "canonicalCloneUrl",
      indexed_skills.source_path as "sourcePath",
      indexed_skills.source_commit_sha as "sourceCommitSha"
    from indexed_skills
    inner join repositories on repositories.id = indexed_skills.repository_id
    where indexed_skills.organization_id = ${context.tenant.organizationId}
      and indexed_skills.skill_id = ${skill.id}
    order by indexed_skills.skill_id, indexed_skills.last_indexed_at desc
    limit 1
  `;

  return {
    skill,
    sourceRow: rows[0] ?? null,
  };
}

async function resolveSkillSourceConnection(
  context: ResolvedTenantContext,
  sourceRow: SkillSourceQueryRow,
): Promise<{
  connection: RepositoryProviderConnectionRecord | null;
  saveDisabledReason?: string | undefined;
}> {
  if (!supportsLiveSkillSource(sourceRow.providerType)) {
    return {
      connection: null,
      saveDisabledReason: `Live repository-backed skill editing is not wired for ${sourceRow.providerType} repositories yet.`,
    };
  }

  if (!sourceRow.canonicalCloneUrl) {
    return {
      connection: null,
      saveDisabledReason: "A canonical repository URL is required before Savant can edit SKILL.md.",
    };
  }

  try {
    return {
      connection: await resolveRepositoryProviderConnection({
        organizationId: context.tenant.organizationId,
        provider: sourceRow.providerType,
        connectionId: sourceRow.connectionId ?? undefined,
      }),
    };
  } catch (error) {
    if (error instanceof RepositoryProviderConnectionError) {
      return {
        connection: null,
        saveDisabledReason: error.message,
      };
    }

    throw error;
  }
}

async function readLiveSkillSourceFile(input: {
  sourceRow: SkillSourceQueryRow;
  connection: RepositoryProviderConnectionRecord | null;
}): Promise<{ content: string; sha: string; branch: string; sourceCommitSha: string | null }> {
  const { sourceRow, connection } = input;

  if (!sourceRow.canonicalCloneUrl) {
    throw new SkillSourceError(
      "skill_source_locator_missing",
      "A canonical repository URL is required before Savant can load SKILL.md.",
      409,
    );
  }

  const locator = parseRepositoryLocator({
    provider: sourceRow.providerType,
    repoUrl: sourceRow.canonicalCloneUrl,
  });

  if (!locator) {
    throw new SkillSourceError(
      "skill_source_locator_invalid",
      "The connected repository URL could not be parsed for skill source reads.",
      409,
    );
  }

  const branch = sourceRow.defaultBranch?.trim() || "main";
  const ref = sourceRow.sourceCommitSha?.trim() || branch;
  const fetcher = connection
    ? createProviderAuthenticatedFetch(locator.provider, resolveRepositoryProviderAccessToken(connection))
    : undefined;

  switch (locator.provider) {
    case "github": {
      const file = await readGitHubRepositoryTextFile(locator, {
        path: sourceRow.sourcePath,
        ref,
        ...(fetcher ? { fetcher } : {}),
      });

      return {
        content: file.content,
        sha: file.sha,
        branch,
        sourceCommitSha: sourceRow.sourceCommitSha,
      };
    }
    case "gitlab": {
      const file = await readGitLabRepositoryTextFile(locator, {
        path: sourceRow.sourcePath,
        ref,
        ...(fetcher ? { fetcher } : {}),
      });

      return {
        content: file.content,
        sha: file.sha,
        branch,
        sourceCommitSha: sourceRow.sourceCommitSha,
      };
    }
    default:
      throw new SkillSourceError(
        "skill_source_provider_unsupported",
        `Live SKILL.md reads are not wired for ${locator.provider} repositories yet.`,
        409,
      );
  }
}

export async function getSkillSourceResponse(
  id: string,
  context: ResolvedTenantContext,
): Promise<SkillSourceResponse | null> {
  const loaded = await loadSkillSourceRecord(context, id);

  if (!loaded) {
    return null;
  }

  const { skill, sourceRow } = loaded;

  if (!sourceRow) {
    return {
      data: toFallbackSourcePayload(skill),
      meta: createControlPlaneMeta("mixed"),
    };
  }

  const { connection, saveDisabledReason } = await resolveSkillSourceConnection(context, sourceRow);

  try {
    const liveFile = await readLiveSkillSourceFile({
      sourceRow,
      connection,
    });

    return {
      data: {
        skillId: skill.id,
        skillUuid: skill.skillUuid,
        name: skill.name,
        repository: skill.repo,
        repoProvider: skill.repoProvider,
        branch: liveFile.branch,
        sourcePath: sourceRow.sourcePath,
        sourceCommitSha: liveFile.sourceCommitSha,
        contentSha: liveFile.sha,
        content: liveFile.content,
        mode: "repository",
        canSave: Boolean(connection),
        ...(saveDisabledReason ? { saveDisabledReason } : {}),
      },
      meta: createControlPlaneMeta("git"),
    };
  } catch (error) {
    if (error instanceof SkillSourceError || error instanceof RepositoryProviderError) {
      return {
        data: toFallbackSourcePayload(skill, {
          saveDisabledReason: error.message,
        }),
        meta: createControlPlaneMeta("mixed"),
      };
    }

    throw error;
  }
}

function normalizeSkillSourceContent(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized.trim() || normalized.length > MAX_SKILL_SOURCE_LENGTH) {
    return null;
  }

  return normalized;
}

export function normalizeSkillSourceUpdateRequest(body: JsonObject): SkillSourceUpdateRequest | null {
  const content = normalizeSkillSourceContent(body.content);

  if (!content) {
    return null;
  }

  const commitMessage = readOptionalString(body, "commitMessage", 240);
  const connectionId = readOptionalString(body, "connectionId", 100);

  return {
    content,
    ...(commitMessage ? { commitMessage } : {}),
    ...(connectionId ? { connectionId } : {}),
  };
}

function buildSkillSourceCommitMessage(skill: SkillListItem, request: SkillSourceUpdateRequest): string {
  return request.commitMessage ?? `chore(skill): update ${skill.id} source`;
}

export async function updateSkillSourceInRepository(input: {
  context: ResolvedTenantContext;
  skillId: string;
  request: SkillSourceUpdateRequest;
}): Promise<SkillSourceUpdatePayload> {
  await assertTenantWriteAccess(
    {
      context: input.context,
      operation: "update skill source",
    },
  );

  await tryRecordAuditEvent({
    organizationId: input.context.tenant.organizationId,
    actorSubject: input.context.identity?.subject ?? "development",
    category: "repo",
    action: "skill_source_update_requested",
    targetType: "skill",
    targetRef: input.skillId,
    payload: {
      skillId: input.skillId,
      hasCommitMessage: Boolean(input.request.commitMessage),
      contentLength: input.request.content.length,
    },
  });

  try {
    const loaded = await loadSkillSourceRecord(input.context, input.skillId);

    if (!loaded) {
      throw new SkillSourceError(
        "skill_not_found",
        `Skill '${input.skillId}' was not found.`,
        404,
      );
    }

    const { skill, sourceRow } = loaded;

    if (!sourceRow) {
      throw new SkillSourceError(
        "skill_source_unavailable",
        "SKILL.md editing requires an indexed repository-backed skill projection.",
        409,
      );
    }

    if (!supportsLiveSkillSource(sourceRow.providerType)) {
      throw new SkillSourceError(
        "skill_source_provider_unsupported",
        `Live SKILL.md writes are not wired for ${sourceRow.providerType} repositories yet.`,
        409,
      );
    }

    if (!sourceRow.canonicalCloneUrl) {
      throw new SkillSourceError(
        "skill_source_locator_missing",
        "A canonical repository URL is required before Savant can edit SKILL.md.",
        409,
      );
    }

    const connection = await resolveRepositoryProviderConnection({
      organizationId: input.context.tenant.organizationId,
      provider: sourceRow.providerType,
      connectionId: input.request.connectionId ?? sourceRow.connectionId ?? undefined,
    });
    const locator = parseRepositoryLocator({
      provider: sourceRow.providerType,
      repoUrl: sourceRow.canonicalCloneUrl,
    });

    if (!locator) {
      throw new SkillSourceError(
        "skill_source_locator_invalid",
        "The connected repository URL could not be parsed for skill source writes.",
        409,
      );
    }

    const fetcher = createProviderAuthenticatedFetch(
      locator.provider,
      resolveRepositoryProviderAccessToken(connection),
    );
    const adapter = resolveRepositoryWriteAdapter(locator.provider, { fetcher });
    const branch = sourceRow.defaultBranch?.trim() || skill.branch || "main";
    const commit = await adapter.createCommit(locator, {
      branch,
      message: buildSkillSourceCommitMessage(skill, input.request),
      files: [
        {
          path: sourceRow.sourcePath,
          content: input.request.content,
        },
      ],
    });

    const warnings: string[] = [];

    try {
      await indexTenantRepository({
        context: input.context,
        repositoryId: sourceRow.repositoryId,
        requestedAt: new Date(commit.committedAt),
        now: new Date(commit.committedAt),
      });
    } catch (error) {
      if (
        error instanceof RepositoryIndexError
        || error instanceof RepositoryProviderError
        || error instanceof RepositoryProviderConnectionError
      ) {
        warnings.push(`SKILL.md was saved, but inline re-indexing did not complete: ${error.message}`);
      } else {
        throw error;
      }
    }

    await tryRecordAuditEvent({
      organizationId: input.context.tenant.organizationId,
      actorSubject: input.context.identity?.subject ?? "development",
      category: "repo",
      action: "skill_source_update_succeeded",
      targetType: "skill",
      targetRef: skill.id,
      payload: {
        skillId: skill.id,
        repositoryId: sourceRow.repositoryId,
        commitSha: commit.commitSha,
        warningCount: warnings.length,
      },
    });

    return {
      skillId: skill.id,
      skillUuid: skill.skillUuid,
      branch,
      sourcePath: sourceRow.sourcePath,
      commit: {
        sha: commit.commitSha,
        committedAt: commit.committedAt,
        url: commit.url,
        changedPaths: commit.changedPaths,
      },
      warnings,
    };
  } catch (error) {
    await tryRecordAuditEvent({
      organizationId: input.context.tenant.organizationId,
      actorSubject: input.context.identity?.subject ?? "development",
      category: "repo",
      action: "skill_source_update_failed",
      targetType: "skill",
      targetRef: input.skillId,
      payload: {
        skillId: input.skillId,
        errorCode: error instanceof SkillSourceError
          ? error.code
          : error instanceof RepositoryProviderError
            ? error.code
            : error instanceof RepositoryProviderConnectionError
              ? error.code
              : error instanceof TenantWriteAccessError
                ? error.code
                : "skill_source_update_failed",
      },
    });

    throw error;
  }
}
