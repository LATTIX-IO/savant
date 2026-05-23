import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  RepoScaffoldFile,
  SkillScaffoldApplyPayload,
  SkillScaffoldApplyRequest,
  SkillScaffoldPayload,
  SkillScaffoldRequest,
} from "@savant/types";

import { tryRecordAuditEvent } from "./audit-events.ts";
import {
  RepositoryIndexError,
  indexTenantRepository,
} from "./repository-index.ts";
import {
  readRepositoryDetailFromDatabase,
  type TenantReadContext,
} from "./read-model-db.ts";
import {
  resolveRepositoryProviderAccessToken,
  resolveRepositoryProviderConnection,
  RepositoryProviderConnectionError,
} from "./repository-provider-connection.ts";
import { createProviderAuthenticatedFetch } from "./repository-provider-authenticated-fetch.ts";
import { parseRepositoryLocator } from "./repository-provider.ts";
import { resolveRepositoryReadAdapter } from "./repository-provider-read-adapter.ts";
import {
  RepositoryProviderError,
  type RepositoryProviderIndexSnapshot,
} from "./repository-provider-read.ts";
import { resolveRepositoryWriteAdapter } from "./repository-provider-write-adapter.ts";
import { generateSkillScaffold } from "./skill-scaffold.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";
import {
  assertTenantWriteAccess,
  type TenantWriteAccessStore,
} from "./tenant-write-access.ts";

export class SkillScaffoldApplyError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "SkillScaffoldApplyError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type WritableRepositoryRow = {
  id: string;
  providerType: string;
  defaultBranch: string;
  repositoryStatus: string;
  connectionId: string | null;
  canonicalCloneUrl: string | null;
};

type RegistryDocArrayEntry = Record<string, unknown>;

type SkillRegistrySnapshot = {
  observedPaths: string[];
  files: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toNonEmptyString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseYamlDocument(path: string, content: string): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_registry_invalid_yaml",
      `Could not parse '${path}' before applying the scaffold commit.`,
      409,
      error instanceof Error ? error.message : undefined,
    );
  }
}

function normalizeDocumentArray(document: unknown, key: string): RegistryDocArrayEntry[] {
  const entries = Array.isArray(document)
    ? document
    : isRecord(document) && Array.isArray(document[key])
      ? document[key]
      : [];

  return entries.filter((entry): entry is RegistryDocArrayEntry => isRecord(entry));
}

function parsePreviewEntry(path: string, preview: string): RegistryDocArrayEntry {
  const parsed = parseYamlDocument(path, preview);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;

  if (!isRecord(entry)) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_registry_preview_invalid",
      `Generated registry preview for '${path}' did not contain a YAML object entry.`,
      500,
    );
  }

  return entry;
}

function buildYamlArrayDocument(key: string, entries: RegistryDocArrayEntry[], version: unknown): string {
  const normalizedVersion = typeof version === "number" || typeof version === "string"
    ? version
    : 1;

  return stringifyYaml({
    version: normalizedVersion,
    [key]: entries,
  }, {
    lineWidth: 0,
    minContentWidth: 0,
  });
}

function assertScaffoldTargetRepository(repository: WritableRepositoryRow) {
  if (repository.repositoryStatus === "disabled") {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_repository_disabled",
      "Skill scaffolds cannot be committed while the target repository is disabled.",
      409,
    );
  }

  if (!repository.canonicalCloneUrl) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_repository_locator_missing",
      "A canonical repository URL is required before Savant can commit a skill scaffold.",
      409,
    );
  }
}

function assertPackagePathAvailable(observedPaths: readonly string[], packagePath: string) {
  const normalizedPackagePath = packagePath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const conflict = observedPaths.some(
    (path) => path === normalizedPackagePath || path.startsWith(`${normalizedPackagePath}/`),
  );

  if (conflict) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_package_path_conflict",
      `The target repository already contains content at '${normalizedPackagePath}'.`,
      409,
    );
  }
}

function mergeSkillsRegistry(
  existingContent: string,
  entry: RegistryDocArrayEntry,
  scaffold: SkillScaffoldPayload,
): string {
  const document = parseYamlDocument("registry/skills.yaml", existingContent);
  const entries = normalizeDocumentArray(document, "skills");
  const skillId = toNonEmptyString(entry.skill_id) ?? toNonEmptyString(entry.skillId) ?? scaffold.skillId;
  const packagePath = toNonEmptyString(entry.package_path) ?? toNonEmptyString(entry.packagePath) ?? scaffold.packagePath;
  const skillUuid = toNonEmptyString(entry.skill_uuid) ?? toNonEmptyString(entry.skillUuid) ?? scaffold.skillUuid;

  if (entries.some((candidate) => (toNonEmptyString(candidate.skill_id) ?? toNonEmptyString(candidate.skillId)) === skillId)) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_skill_id_conflict",
      `The target repository already registers skill '${skillId}'.`,
      409,
    );
  }

  if (entries.some((candidate) => (toNonEmptyString(candidate.package_path) ?? toNonEmptyString(candidate.packagePath)) === packagePath)) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_package_path_conflict",
      `The target repository already registers package path '${packagePath}'.`,
      409,
    );
  }

  if (entries.some((candidate) => (toNonEmptyString(candidate.skill_uuid) ?? toNonEmptyString(candidate.skillUuid)) === skillUuid)) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_skill_uuid_conflict",
      `The target repository already registers generated skill UUID '${skillUuid}'.`,
      409,
    );
  }

  const nextEntries = [...entries, entry].sort((left, right) => {
    const leftPath = toNonEmptyString(left.package_path) ?? toNonEmptyString(left.packagePath) ?? "";
    const rightPath = toNonEmptyString(right.package_path) ?? toNonEmptyString(right.packagePath) ?? "";

    return leftPath.localeCompare(rightPath);
  });

  return buildYamlArrayDocument("skills", nextEntries, isRecord(document) ? document.version : undefined);
}

function mergeOwnersRegistry(existingContent: string, entry: RegistryDocArrayEntry): string {
  const document = parseYamlDocument("registry/owners.yaml", existingContent);
  const entries = normalizeDocumentArray(document, "owners");
  const owner = toNonEmptyString(entry.owner);
  const skills = toStringArray(entry.skills);

  if (!owner || skills.length === 0) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_owners_preview_invalid",
      "Generated owner registry preview did not include an owner and at least one skill.",
      500,
    );
  }

  const existing = entries.find((candidate) => toNonEmptyString(candidate.owner) === owner);

  if (existing) {
    existing.skills = [...new Set([...toStringArray(existing.skills), ...skills])].sort();
  } else {
    entries.push({ owner, skills: [...new Set(skills)].sort() });
  }

  const nextEntries = entries.sort((left, right) => {
    const leftOwner = toNonEmptyString(left.owner) ?? "";
    const rightOwner = toNonEmptyString(right.owner) ?? "";

    return leftOwner.localeCompare(rightOwner);
  });

  return buildYamlArrayDocument("owners", nextEntries, isRecord(document) ? document.version : undefined);
}

function mergeDependenciesRegistry(existingContent: string, entry: RegistryDocArrayEntry): string {
  const document = parseYamlDocument("registry/dependencies.yaml", existingContent);
  const entries = normalizeDocumentArray(document, "dependencies");
  const skillId = toNonEmptyString(entry.skill_id) ?? toNonEmptyString(entry.skillId);

  if (!skillId) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_dependencies_preview_invalid",
      "Generated dependency registry preview did not include a skill_id.",
      500,
    );
  }

  if (entries.some((candidate) => (toNonEmptyString(candidate.skill_id) ?? toNonEmptyString(candidate.skillId)) === skillId)) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_skill_id_conflict",
      `The target repository already registers dependencies for skill '${skillId}'.`,
      409,
    );
  }

  entries.push({
    skill_id: skillId,
    depends_on: [...new Set(toStringArray(entry.depends_on ?? entry.dependsOn))].sort(),
  });

  const nextEntries = entries.sort((left, right) => {
    const leftSkillId = toNonEmptyString(left.skill_id) ?? toNonEmptyString(left.skillId) ?? "";
    const rightSkillId = toNonEmptyString(right.skill_id) ?? toNonEmptyString(right.skillId) ?? "";

    return leftSkillId.localeCompare(rightSkillId);
  });

  return buildYamlArrayDocument("dependencies", nextEntries, isRecord(document) ? document.version : undefined);
}

function mergeRoutingPoliciesRegistry(existingContent: string, entry: RegistryDocArrayEntry): string {
  const document = parseYamlDocument("registry/routing-policies.yaml", existingContent);
  const entries = normalizeDocumentArray(document, "policies");
  const skillId = toNonEmptyString(entry.skill_id) ?? toNonEmptyString(entry.skillId);

  if (!skillId) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_policy_preview_invalid",
      "Generated routing policy preview did not include a skill_id.",
      500,
    );
  }

  if (entries.some((candidate) => (toNonEmptyString(candidate.skill_id) ?? toNonEmptyString(candidate.skillId)) === skillId)) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_skill_id_conflict",
      `The target repository already registers a routing policy for skill '${skillId}'.`,
      409,
    );
  }

  entries.push(entry);

  const nextEntries = entries.sort((left, right) => {
    const leftSkillId = toNonEmptyString(left.skill_id) ?? toNonEmptyString(left.skillId) ?? "";
    const rightSkillId = toNonEmptyString(right.skill_id) ?? toNonEmptyString(right.skillId) ?? "";

    return leftSkillId.localeCompare(rightSkillId);
  });

  return buildYamlArrayDocument("policies", nextEntries, isRecord(document) ? document.version : undefined);
}

export function mergeSkillScaffoldRegistryFiles(input: {
  snapshot: SkillRegistrySnapshot;
  scaffold: SkillScaffoldPayload;
}): RepoScaffoldFile[] {
  assertPackagePathAvailable(input.snapshot.observedPaths, input.scaffold.packagePath);

  const skillUpdate = input.scaffold.registryUpdates.find((update) => update.path === "registry/skills.yaml");
  const ownerUpdate = input.scaffold.registryUpdates.find((update) => update.path === "registry/owners.yaml");
  const dependencyUpdate = input.scaffold.registryUpdates.find((update) => update.path === "registry/dependencies.yaml");
  const routingUpdate = input.scaffold.registryUpdates.find((update) => update.path === "registry/routing-policies.yaml");

  if (!skillUpdate || !ownerUpdate || !dependencyUpdate || !routingUpdate) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_registry_preview_missing",
      "Generated scaffold preview did not include all required registry updates.",
      500,
    );
  }

  const existingSkills = input.snapshot.files[skillUpdate.path];
  const existingOwners = input.snapshot.files[ownerUpdate.path];
  const existingDependencies = input.snapshot.files[dependencyUpdate.path];
  const existingRouting = input.snapshot.files[routingUpdate.path];

  if (!existingSkills || !existingOwners || !existingDependencies || !existingRouting) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_registry_missing",
      "The target repository is missing one or more required registry files.",
      409,
    );
  }

  return [
    {
      path: skillUpdate.path,
      purpose: skillUpdate.purpose,
      content: mergeSkillsRegistry(
        existingSkills,
        parsePreviewEntry(skillUpdate.path, skillUpdate.preview),
        input.scaffold,
      ),
    },
    {
      path: ownerUpdate.path,
      purpose: ownerUpdate.purpose,
      content: mergeOwnersRegistry(
        existingOwners,
        parsePreviewEntry(ownerUpdate.path, ownerUpdate.preview),
      ),
    },
    {
      path: dependencyUpdate.path,
      purpose: dependencyUpdate.purpose,
      content: mergeDependenciesRegistry(
        existingDependencies,
        parsePreviewEntry(dependencyUpdate.path, dependencyUpdate.preview),
      ),
    },
    {
      path: routingUpdate.path,
      purpose: routingUpdate.purpose,
      content: mergeRoutingPoliciesRegistry(
        existingRouting,
        parsePreviewEntry(routingUpdate.path, routingUpdate.preview),
      ),
    },
  ];
}

function buildSkillCommitMessage(scaffold: SkillScaffoldPayload): string {
  return `feat(skill): scaffold ${scaffold.skillId}`;
}

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

async function loadWritableRepository(
  organizationId: string,
  repositoryId: string,
): Promise<WritableRepositoryRow> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new SkillScaffoldApplyError(
      "skill_scaffold_unconfigured",
      "DATABASE_URL must be configured before Savant can commit a skill scaffold.",
      503,
    );
  }

  const sql = getControlPlaneDatabase();
  const rows = await sql<WritableRepositoryRow[]>`
    select
      repositories.id,
      repositories.provider_type as "providerType",
      repositories.default_branch as "defaultBranch",
      repositories.status as "repositoryStatus",
      repositories.connection_id as "connectionId",
      repositories.canonical_clone_url as "canonicalCloneUrl"
    from repositories
    where repositories.organization_id = ${organizationId}
      and repositories.id = ${repositoryId}
    limit 1
  `;

  const repository = rows[0];

  if (!repository) {
    throw new SkillScaffoldApplyError(
      "repository_not_found",
      `Repository '${repositoryId}' was not found.`,
      404,
    );
  }

  return repository;
}

function buildSkillScaffoldInput(request: SkillScaffoldApplyRequest): SkillScaffoldRequest {
  return {
    displayName: request.displayName,
    tier: request.tier,
    owner: request.owner,
    summary: request.summary,
    skillId: request.skillId,
    packagePath: request.packagePath,
    domain: request.domain,
    category: request.category,
    personSlug: request.personSlug,
    tier3Kind: request.tier3Kind,
    version: request.version,
    status: request.status,
    dependencies: request.dependencies,
  };
}

function resolveSkillScaffoldErrorCode(error: unknown): string {
  return error instanceof SkillScaffoldApplyError
    || error instanceof RepositoryProviderError
    || error instanceof RepositoryProviderConnectionError
    || error instanceof RepositoryIndexError
    ? error.code
    : "unexpected_error";
}

export async function applySkillScaffoldToRepository(input: {
  context: ResolvedTenantContext;
  request: SkillScaffoldApplyRequest;
  now?: Date | undefined;
}, options?: {
  writeAccessStore?: TenantWriteAccessStore | undefined;
}): Promise<SkillScaffoldApplyPayload> {
  if (!input.context.identity) {
    throw new SkillScaffoldApplyError(
      "auth_required",
      "Sign in before applying a skill scaffold to a repository.",
      401,
    );
  }

  await assertTenantWriteAccess(
    {
      context: input.context,
      operation: "commit skill scaffolds",
    },
    {
      store: options?.writeAccessStore,
    },
  );

  const now = input.now ?? new Date();
  const scaffoldTargetRef = input.request.repositoryId;

  await tryRecordAuditEvent({
    organizationId: input.context.tenant.organizationId,
    actorSubject: input.context.identity.subject,
    category: "repo",
    action: "skill_scaffold_apply_requested",
    targetType: "repository",
    targetRef: scaffoldTargetRef,
    payload: {
      repositoryId: input.request.repositoryId,
      displayName: input.request.displayName,
      requestedSkillId: input.request.skillId ?? null,
      tier: input.request.tier,
      requestedConnectionId: input.request.connectionId ?? null,
    },
  });

  try {
    const repository = await loadWritableRepository(
      input.context.tenant.organizationId,
      input.request.repositoryId,
    );
    assertScaffoldTargetRepository(repository);

    const connection = await resolveRepositoryProviderConnection({
      organizationId: input.context.tenant.organizationId,
      provider: repository.providerType,
      connectionId: input.request.connectionId ?? repository.connectionId ?? undefined,
    });
    const accessToken = resolveRepositoryProviderAccessToken(connection);
    const locator = parseRepositoryLocator({
      provider: repository.providerType,
      repoUrl: repository.canonicalCloneUrl ?? "",
    });

    if (!locator) {
      throw new SkillScaffoldApplyError(
        "repository_locator_invalid",
        "The target repository URL could not be parsed for scaffold apply.",
        409,
      );
    }

    const fetcher = createProviderAuthenticatedFetch(locator.provider, accessToken);

    const scaffold = generateSkillScaffold(buildSkillScaffoldInput(input.request));
    const snapshot = await resolveRepositoryReadAdapter(locator.provider).readRepositoryIndexSnapshot(locator, {
      branch: repository.defaultBranch,
      fetcher,
    }) as RepositoryProviderIndexSnapshot;
    const registryFiles = mergeSkillScaffoldRegistryFiles({
      snapshot: {
        observedPaths: snapshot.observedPaths,
        files: snapshot.files,
      },
      scaffold,
    });
    const adapter = resolveRepositoryWriteAdapter(locator.provider, { fetcher });
    const commit = await adapter.createCommit(locator, {
      branch: repository.defaultBranch,
      message: buildSkillCommitMessage(scaffold),
      files: [...scaffold.files, ...registryFiles],
    });

    let repositoryProjection = (
      await readRepositoryDetailFromDatabase(buildTenantReadContext(input.context), repository.id)
    )?.data.repository;
    const warnings: string[] = [];
    let indexedSkillCount = 0;

    try {
      const indexed = await indexTenantRepository({
        context: input.context,
        repositoryId: repository.id,
        requestedAt: now,
        now,
      });

      repositoryProjection = indexed.repository;
      indexedSkillCount = indexed.indexedSkillCount;
      warnings.push(...indexed.warnings);
    } catch (error) {
      if (
        error instanceof RepositoryIndexError
        || error instanceof RepositoryProviderError
        || error instanceof RepositoryProviderConnectionError
      ) {
        warnings.push(`Skill scaffold commit succeeded, but inline indexing did not complete: ${error.message}`);
      } else {
        throw error;
      }
    }

    if (!repositoryProjection) {
      throw new SkillScaffoldApplyError(
        "repository_projection_missing",
        "The repository was updated, but Savant could not reload its repository projection.",
        500,
      );
    }

    await tryRecordAuditEvent({
      organizationId: input.context.tenant.organizationId,
      actorSubject: input.context.identity.subject,
      category: "repo",
      action: "skill_scaffold_apply_succeeded",
      targetType: "repository",
      targetRef: repository.id,
      payload: {
        repositoryId: repository.id,
        provider: locator.provider,
        skillId: scaffold.skillId,
        packagePath: scaffold.packagePath,
        commitSha: commit.commitSha,
        indexedSkillCount,
        warningCount: warnings.length,
      },
    });

    return {
      repository: repositoryProjection,
      skillUuid: scaffold.skillUuid,
      skillId: scaffold.skillId,
      packagePath: scaffold.packagePath,
      commit: {
        sha: commit.commitSha,
        committedAt: commit.committedAt,
        url: commit.url,
        changedPaths: commit.changedPaths,
      },
      indexedSkillCount,
      warnings,
    };
  } catch (error) {
    await tryRecordAuditEvent({
      organizationId: input.context.tenant.organizationId,
      actorSubject: input.context.identity.subject,
      category: "repo",
      action: "skill_scaffold_apply_failed",
      targetType: "repository",
      targetRef: scaffoldTargetRef,
      payload: {
        repositoryId: input.request.repositoryId,
        requestedSkillId: input.request.skillId ?? null,
        errorCode: resolveSkillScaffoldErrorCode(error),
      },
    });

    throw error;
  }
}