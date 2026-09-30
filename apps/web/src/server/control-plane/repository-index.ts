import { createHash } from "node:crypto";

import { parse as parseYaml } from "yaml";

import type {
  RepoSyncPayload,
  RepositorySyncMode,
} from "@savant/types";

import { buildConnectedRepositoryListItem } from "./repository-connect.ts";
import { RepositoryProviderConnectionError } from "./repository-provider-connection.ts";
import { describeAssessmentSummary } from "../assessment/service.ts";
import { GitProviderError } from "../git/errors.ts";
import { syncRepository, type IndexSnapshotInput, type IndexWriter } from "../git/repository-sync-service.ts";
import { parseRepositoryLocator } from "./repository-provider.ts";
import {
  resolveRepositoryReadAdapter,
} from "./repository-provider-read-adapter.ts";
import {
  RepositoryProviderError,
  type RepositoryProviderIndexSnapshot,
} from "./repository-provider-read.ts";
import { serializeControlPlaneTimestamp } from "./read-model-db.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";

export class RepositoryIndexError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "RepositoryIndexError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type RepositoryIndexActor = {
  type: "user" | "system";
  ref: string;
};

type RepositoryIndexSnapshot = RepositoryProviderIndexSnapshot;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type RegistrySkillEntry = {
  skillId?: string;
  displayName?: string;
  packagePath?: string;
  tier?: string;
  status?: string;
};

type RegistryDependencyEntry = {
  dependencies: string[];
  source: "metadata" | "registry";
};

type IndexedSkillRecord = {
  skillId: string;
  displayName: string;
  tier: "tier1" | "tier2" | "tier3";
  owner: string;
  status: string;
  sourcePath: string;
  metadataVersion: string | null;
  manifest: { [key: string]: JsonValue };
  contentHash: string;
  versionRef: string;
  channel: string;
  dependencies: RegistryDependencyEntry;
};

type ParsedRepositoryIndex = {
  skills: IndexedSkillRecord[];
  warnings: string[];
  parsedRegistryFiles: string[];
};

type PersistedRepositoryRecord = {
  id: string;
  providerType: string;
  ownerName: string;
  repoName: string;
  defaultBranch: string;
  repositoryStatus: string;
  updatedAt: Date | string;
};

type PersistedRepositorySyncState = {
  syncMode: RepositorySyncMode;
  status: string;
  lastIndexedAt: Date | string | null;
  lastSuccessfulSyncAt: Date | string | null;
  lastWebhookAt: Date | string | null;
  nextPollAt: Date | string | null;
};

type IndexableRepositoryRow = PersistedRepositoryRecord & {
  connectionId: string | null;
  canonicalCloneUrl: string | null;
  syncMode: RepositorySyncMode | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function inferSkillPackageRoots(paths: readonly string[]): string[] {
  const discovered = new Set<string>();

  for (const path of paths) {
    const parts = normalizePath(path).split("/").filter(Boolean);

    if (parts[0] === "tier1" && parts[1] === "standards" && parts[2]) {
      discovered.add(parts.slice(0, 3).join("/"));
      continue;
    }

    if (parts[0] === "tier2" && parts[1] === "methodology" && parts[2] && parts[3]) {
      discovered.add(parts.slice(0, 4).join("/"));
      continue;
    }

    if (
      parts[0] === "tier3"
      && (parts[1] === "personal" || parts[1] === "workflow")
      && parts[2]
      && parts[3]
    ) {
      discovered.add(parts.slice(0, 4).join("/"));
    }
  }

  return [...discovered].sort();
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

function readIndexedTier(value: unknown): IndexedSkillRecord["tier"] | undefined {
  const normalized = toNonEmptyString(value);

  if (normalized === "tier1" || normalized === "tier2" || normalized === "tier3") {
    return normalized;
  }

  return undefined;
}

function humanizeSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((token) => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

function extractSkillMarkdownSummary(markdown: string): string | undefined {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }

    return line;
  }

  return undefined;
}

function inferTierFromPath(path: string): IndexedSkillRecord["tier"] {
  const normalized = normalizePath(path);

  if (normalized.startsWith("tier1/")) {
    return "tier1";
  }

  if (normalized.startsWith("tier3/")) {
    return "tier3";
  }

  return "tier2";
}

function inferOwnerFromPath(path: string): string | undefined {
  const parts = normalizePath(path).split("/").filter(Boolean);

  if (parts[0] === "tier3" && parts[1] === "personal" && parts[2]) {
    return parts[2];
  }

  return undefined;
}

function inferSkillIdFromPath(path: string): string {
  const parts = normalizePath(path).split("/").filter(Boolean);

  if (parts[0] === "tier1" && parts[2]) {
    return `tier1.${parts[2]}`;
  }

  if (parts[0] === "tier2" && parts[2] && parts[3]) {
    return `${parts[2]}/${parts[3]}`;
  }

  if (parts[0] === "tier3" && parts[1] === "workflow" && parts[2] && parts[3]) {
    return `workflow/${parts[2]}/${parts[3]}`;
  }

  if (parts[0] === "tier3" && parts[1] === "personal" && parts[2] && parts[3]) {
    return `personal/${parts[2]}/${parts[3]}`;
  }

  return normalizePath(path);
}

function inferDisplayNameFromPath(path: string): string {
  const parts = normalizePath(path).split("/").filter(Boolean);
  const slug = parts.at(-1) ?? path;
  return humanizeSlug(slug);
}

function hashSkillContent(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function parseYamlDocument(path: string, content: string): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    throw new RepositoryIndexError(
      "repository_index_invalid_yaml",
      `Could not parse '${path}' during repository indexing.`,
      409,
      error instanceof Error ? error.message : undefined,
    );
  }
}

function readArrayFromDocument(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isRecord(value) && Array.isArray(value[key])) {
    return value[key];
  }

  return [];
}

function buildRegistryMaps(snapshot: RepositoryIndexSnapshot, warnings: string[]) {
  const skillsByPackagePath = new Map<string, RegistrySkillEntry>();
  const skillsById = new Map<string, RegistrySkillEntry>();
  const ownersBySkillId = new Map<string, string>();
  const dependenciesBySkillId = new Map<string, RegistryDependencyEntry>();
  const channelBySkillId = new Map<string, string>();
  const parsedRegistryFiles: string[] = [];

  const registrySkillsText = snapshot.files["registry/skills.yaml"];
  if (registrySkillsText) {
    parsedRegistryFiles.push("registry/skills.yaml");
    const skillEntries = readArrayFromDocument(
      parseYamlDocument("registry/skills.yaml", registrySkillsText),
      "skills",
    );

    for (const entry of skillEntries) {
      if (!isRecord(entry)) {
        continue;
      }

      const skillId = toNonEmptyString(entry.skill_id) ?? toNonEmptyString(entry.skillId);
      const displayName = toNonEmptyString(entry.display_name) ?? toNonEmptyString(entry.displayName);
      const packagePath =
        toNonEmptyString(entry.package_path)
        ?? toNonEmptyString(entry.packagePath)
        ?? toNonEmptyString(entry.path);
      const tier = toNonEmptyString(entry.tier);
      const status = toNonEmptyString(entry.status);
      const registrySkill: RegistrySkillEntry = {
        ...(skillId ? { skillId } : {}),
        ...(displayName ? { displayName } : {}),
        ...(packagePath ? { packagePath } : {}),
        ...(tier ? { tier } : {}),
        ...(status ? { status } : {}),
      };

      if (registrySkill.packagePath) {
        skillsByPackagePath.set(normalizePath(registrySkill.packagePath), registrySkill);
      }

      if (registrySkill.skillId) {
        skillsById.set(registrySkill.skillId, registrySkill);
      }
    }
  } else {
    warnings.push("Missing registry/skills.yaml in the indexed repository snapshot.");
  }

  const ownersText = snapshot.files["registry/owners.yaml"];
  if (ownersText) {
    parsedRegistryFiles.push("registry/owners.yaml");
    const ownerEntries = readArrayFromDocument(
      parseYamlDocument("registry/owners.yaml", ownersText),
      "owners",
    );

    for (const entry of ownerEntries) {
      if (!isRecord(entry)) {
        continue;
      }

      const owner = toNonEmptyString(entry.owner);
      if (!owner) {
        continue;
      }

      for (const skillId of toStringArray(entry.skills)) {
        ownersBySkillId.set(skillId, owner);
      }
    }
  }

  const dependenciesText = snapshot.files["registry/dependencies.yaml"];
  if (dependenciesText) {
    parsedRegistryFiles.push("registry/dependencies.yaml");
    const dependencyEntries = readArrayFromDocument(
      parseYamlDocument("registry/dependencies.yaml", dependenciesText),
      "dependencies",
    );

    for (const entry of dependencyEntries) {
      if (!isRecord(entry)) {
        continue;
      }

      const skillId = toNonEmptyString(entry.skill_id) ?? toNonEmptyString(entry.skillId);
      if (!skillId) {
        continue;
      }

      dependenciesBySkillId.set(skillId, {
        dependencies: toStringArray(entry.depends_on ?? entry.dependsOn),
        source: "registry",
      });
    }
  }

  const routingPoliciesText = snapshot.files["registry/routing-policies.yaml"];
  if (routingPoliciesText) {
    parsedRegistryFiles.push("registry/routing-policies.yaml");
    const policyEntries = readArrayFromDocument(
      parseYamlDocument("registry/routing-policies.yaml", routingPoliciesText),
      "policies",
    );

    for (const entry of policyEntries) {
      if (!isRecord(entry)) {
        continue;
      }

      const skillId = toNonEmptyString(entry.skill_id) ?? toNonEmptyString(entry.skillId);
      const channel = toNonEmptyString(entry.default_channel) ?? toNonEmptyString(entry.defaultChannel);

      if (skillId && channel) {
        channelBySkillId.set(skillId, channel);
      }
    }
  }

  return {
    parsedRegistryFiles,
    skillsByPackagePath,
    skillsById,
    ownersBySkillId,
    dependenciesBySkillId,
    channelBySkillId,
  };
}

function sanitizeManifest(value: Record<string, unknown>): { [key: string]: JsonValue } {
  return JSON.parse(JSON.stringify(value)) as { [key: string]: JsonValue };
}

export function parseRepositoryIndexSnapshot(snapshot: RepositoryIndexSnapshot): ParsedRepositoryIndex {
  const warnings: string[] = [];
  const registry = buildRegistryMaps(snapshot, warnings);
  const discoveredRoots = inferSkillPackageRoots(snapshot.observedPaths);
  const indexedSkills: IndexedSkillRecord[] = [];

  if (discoveredRoots.length === 0) {
    warnings.push("No skill packages were discovered in the connected repository.");
  }

  for (const root of discoveredRoots) {
    const metadataPath = `${root}/metadata.yaml`;
    const skillMarkdownPath = `${root}/SKILL.md`;
    const hasAgents = snapshot.observedPaths.some(
      (path) => path.startsWith(`${root}/agents/`) || path === `${root}/agents`,
    );
    const hasEval = snapshot.observedPaths.some(
      (path) => path.startsWith(`${root}/eval/`) || path === `${root}/eval`,
    );

    if (!snapshot.files[metadataPath] || !snapshot.files[skillMarkdownPath] || !hasAgents || !hasEval) {
      warnings.push(`Skipped '${root}' because one or more required skill package files are missing.`);
      continue;
    }

    const rawMetadata = parseYamlDocument(metadataPath, snapshot.files[metadataPath]);
    if (!isRecord(rawMetadata)) {
      warnings.push(`Skipped '${root}' because metadata.yaml did not contain a YAML object.`);
      continue;
    }

    const skillMarkdown = snapshot.files[skillMarkdownPath] ?? "";
    const registryEntry = registry.skillsByPackagePath.get(root);
    const inferredSkillId = inferSkillIdFromPath(root);
    const skillId =
      toNonEmptyString(rawMetadata.skill_id)
      ?? toNonEmptyString(rawMetadata.skillId)
      ?? registryEntry?.skillId
      ?? inferredSkillId;
    const registrySkill = registry.skillsById.get(skillId) ?? registryEntry;

    if (!registrySkill) {
      warnings.push(
        `No registry/skills.yaml entry matched '${root}', so Savant indexed it from package metadata only.`,
      );
    }

    const displayName =
      toNonEmptyString(rawMetadata.display_name)
      ?? toNonEmptyString(rawMetadata.displayName)
      ?? registrySkill?.displayName
      ?? inferDisplayNameFromPath(root);
    const tier =
      readIndexedTier(rawMetadata.tier)
      ?? readIndexedTier(registrySkill?.tier)
      ?? inferTierFromPath(root);
    const owner =
      toNonEmptyString(rawMetadata.owner)
      ?? registry.ownersBySkillId.get(skillId)
      ?? inferOwnerFromPath(root)
      ?? "Unassigned";
    const status =
      toNonEmptyString(rawMetadata.status)
      ?? registrySkill?.status
      ?? "draft";
    const versionRef =
      toNonEmptyString(rawMetadata.version)
      ?? snapshot.commitSha.slice(0, 12);

    const metadataDependencies = toStringArray(rawMetadata.depends_on ?? rawMetadata.dependsOn);
    const registryDependencies = registry.dependenciesBySkillId.get(skillId);
    const dependencyRecord: RegistryDependencyEntry = metadataDependencies.length > 0
      ? { dependencies: metadataDependencies, source: "metadata" }
      : registryDependencies ?? { dependencies: [], source: "registry" };
    const channel =
      registry.channelBySkillId.get(skillId)
      ?? (status === "active" ? "production" : "draft");
    const summary =
      toNonEmptyString(rawMetadata.summary)
      ?? extractSkillMarkdownSummary(skillMarkdown);

    const manifest = sanitizeManifest({
      ...rawMetadata,
      ...(summary && !toNonEmptyString(rawMetadata.summary) ? { summary } : {}),
      ...(toNonEmptyString(rawMetadata.skill_id) || toNonEmptyString(rawMetadata.skillId)
        ? {}
        : { skill_id: skillId }),
      ...(toNonEmptyString(rawMetadata.display_name) || toNonEmptyString(rawMetadata.displayName)
        ? {}
        : { display_name: displayName }),
      ...(toNonEmptyString(rawMetadata.owner) ? {} : { owner }),
      ...(toNonEmptyString(rawMetadata.package_path) || toNonEmptyString(rawMetadata.packagePath)
        ? {}
        : { package_path: root }),
      channel,
    });

    indexedSkills.push({
      skillId,
      displayName,
      tier,
      owner,
      status,
      sourcePath: root,
      metadataVersion: toNonEmptyString(rawMetadata.version) ?? null,
      manifest,
      contentHash: hashSkillContent(`${snapshot.files[metadataPath]}\n---\n${skillMarkdown}`),
      versionRef,
      channel,
      dependencies: {
        dependencies: [...new Set(dependencyRecord.dependencies)],
        source: dependencyRecord.source,
      },
    });
  }

  return {
    skills: indexedSkills,
    warnings,
    parsedRegistryFiles: registry.parsedRegistryFiles,
  };
}

function buildSyncCompletionMessage(skillCount: number, warnings: readonly string[]): string {
  if (skillCount === 0) {
    return warnings.length > 0
      ? "Repository indexing finished with warnings and no usable skill packages were discovered."
      : "Repository indexed successfully. No skill packages were discovered yet.";
  }

  const skillLabel = `${skillCount} skill${skillCount === 1 ? "" : "s"}`;

  return warnings.length > 0
    ? `Repository indexed with warnings. ${skillLabel} discovered.`
    : `Repository indexed successfully. ${skillLabel} discovered.`;
}

async function loadIndexableRepository(
  organizationId: string,
  repositoryId: string,
): Promise<IndexableRepositoryRow> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new RepositoryIndexError(
      "repository_index_unconfigured",
      "DATABASE_URL must be configured before repositories can be indexed.",
      503,
    );
  }

  const sql = getControlPlaneDatabase();
  const rows = await sql<IndexableRepositoryRow[]>`
    select
      repositories.id,
      repositories.provider_type as "providerType",
      repositories.owner_name as "ownerName",
      repositories.repo_name as "repoName",
      repositories.default_branch as "defaultBranch",
      repositories.status as "repositoryStatus",
      repositories.updated_at as "updatedAt",
      repositories.connection_id as "connectionId",
      repositories.canonical_clone_url as "canonicalCloneUrl",
      repository_sync_state.sync_mode as "syncMode"
    from repositories
    left join repository_sync_state on repository_sync_state.repository_id = repositories.id
    where repositories.organization_id = ${organizationId}
      and repositories.id = ${repositoryId}
    limit 1
  `;

  const repository = rows[0];

  if (!repository) {
    throw new RepositoryIndexError(
      "repository_not_found",
      `Repository '${repositoryId}' was not found.`,
      404,
    );
  }

  return repository;
}

async function persistRepositoryIndex(input: {
  organizationId: string;
  actor: RepositoryIndexActor;
  repository: IndexableRepositoryRow;
  snapshot: RepositoryIndexSnapshot;
  parsed: ParsedRepositoryIndex;
  now: Date;
}): Promise<RepoSyncPayload> {
  const { getControlPlaneDatabase } = await import("./database.ts");
  const sql = getControlPlaneDatabase();
  const nextPollAt = (input.repository.syncMode ?? "manual") === "poll"
    ? new Date(input.now.getTime() + 5 * 60 * 1000)
    : null;
  const syncStatus = input.parsed.skills.length === 0 || input.parsed.warnings.length > 0 ? "warn" : "ok";

  return sql.begin(async (tx) => {
    await tx`
      delete from indexed_skills
      where repository_id = ${input.repository.id}
    `;

    for (const skill of input.parsed.skills) {
      const insertedRows = await tx<{ id: string }[]>`
        insert into indexed_skills (
          organization_id,
          repository_id,
          skill_id,
          display_name,
          tier,
          owner,
          status,
          source_path,
          metadata_version,
          source_commit_sha,
          default_branch,
          content_hash,
          manifest,
          last_indexed_at
        )
        values (
          ${input.organizationId},
          ${input.repository.id},
          ${skill.skillId},
          ${skill.displayName},
          ${skill.tier},
          ${skill.owner},
          ${skill.status},
          ${skill.sourcePath},
          ${skill.metadataVersion},
          ${input.snapshot.commitSha},
          ${input.snapshot.defaultBranch},
          ${skill.contentHash},
          ${tx.json(skill.manifest)},
          ${input.now}
        )
        returning id
      `;

      const indexedSkillId = insertedRows[0]?.id;

      if (!indexedSkillId) {
        throw new RepositoryIndexError(
          "repository_index_persist_failed",
          `Could not persist indexed skill '${skill.skillId}'.`,
          500,
        );
      }

      await tx`
        insert into indexed_skill_versions (
          indexed_skill_id,
          repository_id,
          skill_id,
          version_ref,
          commit_sha,
          branch_name,
          channel,
          is_current_candidate,
          is_current_baseline,
          observed_at
        )
        values (
          ${indexedSkillId},
          ${input.repository.id},
          ${skill.skillId},
          ${skill.versionRef},
          ${input.snapshot.commitSha},
          ${input.snapshot.defaultBranch},
          ${skill.channel},
          ${skill.channel !== "production"},
          ${skill.channel === "production"},
          ${input.now}
        )
      `;

      for (const dependencySkillId of skill.dependencies.dependencies) {
        await tx`
          insert into indexed_skill_dependencies (
            indexed_skill_id,
            dependency_skill_id,
            source,
            source_commit_sha,
            last_indexed_at
          )
          values (
            ${indexedSkillId},
            ${dependencySkillId},
            ${skill.dependencies.source},
            ${input.snapshot.commitSha},
            ${input.now}
          )
        `;
      }

      await tx`
        insert into audit_events (
          organization_id,
          actor_type,
          actor_ref,
          category,
          action,
          target_type,
          target_ref,
          payload_redacted
        )
        values (
          ${input.organizationId},
          ${input.actor.type},
          ${input.actor.ref},
          'repo',
          'skill_indexed',
          'skill',
          ${skill.skillId},
          ${tx.json({
            repositoryId: input.repository.id,
            repositoryName: `${input.repository.ownerName}/${input.repository.repoName}`,
            sourcePath: skill.sourcePath,
            commitSha: input.snapshot.commitSha,
            channel: skill.channel,
          })}
        )
      `;
    }

    const syncStateRows = await tx<PersistedRepositorySyncState[]>`
      update repository_sync_state
      set
        status = ${syncStatus},
        last_indexed_commit_sha = ${input.snapshot.commitSha},
        last_indexed_at = ${input.now},
        last_successful_sync_at = ${input.now},
        next_poll_at = ${nextPollAt},
        error_code = null,
        error_message = null,
        sync_started_at = null
      where repository_id = ${input.repository.id}
      returning
        sync_mode as "syncMode",
        status,
        last_indexed_at as "lastIndexedAt",
        last_successful_sync_at as "lastSuccessfulSyncAt",
        last_webhook_at as "lastWebhookAt",
        next_poll_at as "nextPollAt"
    `;

    const syncState = syncStateRows[0];

    if (!syncState) {
      throw new RepositoryIndexError(
        "repository_sync_state_failed",
        "The repository sync state could not be updated after indexing.",
        500,
      );
    }

    await tx`
      insert into audit_events (
        organization_id,
        actor_type,
        actor_ref,
        category,
        action,
        target_type,
        target_ref,
        payload_redacted
      )
      values (
        ${input.organizationId},
        ${input.actor.type},
        ${input.actor.ref},
        'repo',
        'repository_sync_completed',
        'repository',
        ${input.repository.id},
        ${tx.json({
          commitSha: input.snapshot.commitSha,
          indexedSkillCount: input.parsed.skills.length,
          warnings: input.parsed.warnings,
          parsedRegistryFiles: input.parsed.parsedRegistryFiles,
          nextPollAt: nextPollAt?.toISOString() ?? null,
        })}
      )
    `;

    return {
      accepted: true,
      repository: buildConnectedRepositoryListItem(
        input.repository,
        syncState,
        input.now,
        input.parsed.skills.length,
      ),
      syncMode: syncState.syncMode,
      requestedAt: input.now.toISOString(),
      nextPollAt: serializeControlPlaneTimestamp(syncState.nextPollAt),
      indexedSkillCount: input.parsed.skills.length,
      warnings: input.parsed.warnings,
      message: buildSyncCompletionMessage(input.parsed.skills.length, input.parsed.warnings),
    };
  });
}

function mapIndexingError(
  error: unknown,
): { code: string; message: string; status: number; details?: string | undefined } {
  if (error instanceof RepositoryIndexError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }

  if (error instanceof RepositoryProviderError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }

  if (error instanceof RepositoryProviderConnectionError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }

  return {
    code: "repository_index_failed",
    message: "Repository indexing failed unexpectedly.",
    status: 500,
  };
}

export async function indexTenantRepository(input: {
  context: ResolvedTenantContext;
  repositoryId: string;
  trigger?: RepositoryIndexTrigger | undefined;
  requestedAt?: Date | undefined;
  now?: Date | undefined;
}): Promise<RepoSyncPayload> {
  if (!input.context.identity) {
    throw new RepositoryIndexError(
      "auth_required",
      "Sign in before indexing a repository.",
      401,
    );
  }

  return indexRepositoryById({
    organizationId: input.context.tenant.organizationId,
    repositoryId: input.repositoryId,
    actor: {
      type: "user",
      ref: input.context.identity.subject,
    },
    trigger: input.trigger,
    requestedAt: input.requestedAt,
    now: input.now,
  });
}

export type RepositoryIndexTrigger = "initial" | "manual" | "poll" | "webhook" | "reconciliation";

function toRepositoryIndexError(error: unknown): RepositoryIndexError {
  if (error instanceof RepositoryIndexError) {
    return error;
  }

  if (error instanceof GitProviderError) {
    return new RepositoryIndexError(error.code, error.message, error.status, error.details);
  }

  const mapped = mapIndexingError(error);
  return new RepositoryIndexError(mapped.code, mapped.message, mapped.status, mapped.details);
}

/**
 * Anonymous read for public repositories with no provider connection. Only
 * reached when connection resolution found none (INV-GIT-01); a refusal is
 * reported as an authorization problem rather than repository absence.
 */
async function readAnonymousIndexSnapshot(repository: IndexableRepositoryRow): Promise<IndexSnapshotInput> {
  const locator = repository.canonicalCloneUrl
    ? parseRepositoryLocator({ provider: repository.providerType, repoUrl: repository.canonicalCloneUrl })
    : null;

  if (!locator) {
    throw new RepositoryIndexError("repository_locator_invalid", "The connected repository URL could not be parsed for indexing.", 409);
  }

  try {
    const snapshot = await resolveRepositoryReadAdapter(locator.provider).readRepositoryIndexSnapshot(locator, {
      branch: repository.defaultBranch,
    });
    return {
      metadata: snapshot.metadata ?? {
        externalId: "",
        defaultBranch: snapshot.defaultBranch,
        displayName: `${repository.ownerName}/${repository.repoName}`,
        visibility: "unknown",
      },
      defaultBranch: snapshot.defaultBranch,
      commitSha: snapshot.commitSha,
      observedPaths: snapshot.observedPaths,
      files: snapshot.files,
    };
  } catch (error) {
    if (error instanceof RepositoryProviderError && (error.status === 401 || error.status === 403 || error.status === 404)) {
      throw new GitProviderError(
        "CONNECTION_REQUIRED",
        `Savant read ${locator.normalizedUrl} anonymously because this workspace has no ${repository.providerType} connection, and the provider refused. Connect ${repository.providerType} in Settings → Source control, then run Sync.`,
      );
    }
    throw error;
  }
}

function createDatabaseIndexWriter(repository: IndexableRepositoryRow): IndexWriter<ParsedRepositoryIndex, RepoSyncPayload> {
  return {
    validate: (snapshot) => parseRepositoryIndexSnapshot(snapshot),
    skillCount: (parsed) => parsed.skills.length,
    commit: async (input) => persistRepositoryIndex({
      organizationId: input.organizationId,
      actor: input.actor,
      repository: {
        ...repository,
        defaultBranch: input.snapshot.defaultBranch,
      },
      snapshot: input.snapshot,
      parsed: input.parsed,
      now: input.now,
    }),
  };
}

/**
 * Indexes a repository through the provider-independent sync pipeline:
 * resolve the exact provider connection, obtain a credential from the broker,
 * read the tree and skill files through the GitProvider contract, validate,
 * then atomically replace the index. Failures leave the previous index intact.
 */
export async function indexRepositoryById(input: {
  organizationId: string;
  repositoryId: string;
  actor: RepositoryIndexActor;
  trigger?: RepositoryIndexTrigger | undefined;
  requestedAt?: Date | undefined;
  now?: Date | undefined;
}): Promise<RepoSyncPayload> {
  const repository = await loadIndexableRepository(
    input.organizationId,
    input.repositoryId,
  );
  const now = input.now ?? input.requestedAt ?? new Date();
  const { getGitRuntime } = await import("../git/runtime.ts");
  const runtime = await getGitRuntime();

  try {
    const synced = await syncRepository({
      connections: runtime.stores.connections,
      repositories: runtime.stores.repositories,
      broker: runtime.broker,
      audit: runtime.stores.audit,
      writer: createDatabaseIndexWriter(repository),
      readAnonymousSnapshot: () => readAnonymousIndexSnapshot(repository),
      afterCommit: (commit) => runtime.assessments.recordAssessment({
        organizationId: commit.organizationId,
        repositoryId: commit.repositoryId,
        commitSha: commit.commitSha,
        observedPaths: commit.snapshot.observedPaths,
        files: commit.snapshot.files,
      }),
    }, {
      organizationId: input.organizationId,
      repositoryId: repository.id,
      actor: input.actor,
      trigger: input.trigger ?? "manual",
      ref: repository.defaultBranch,
      now,
    });

    if (!synced.assessment) {
      return synced.result;
    }

    // The sync response carries the assessment so the user sees next steps immediately.
    return {
      ...synced.result,
      assessment: synced.assessment,
      message: `${synced.result.message} ${describeAssessmentSummary(synced.assessment)}`,
    };
  } catch (error) {
    throw toRepositoryIndexError(error);
  }
}
