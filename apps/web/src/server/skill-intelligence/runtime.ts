import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { SkillListItem } from "@savant/types";

import { findSkillByIdentifier } from "../../lib/skill-paths.ts";
import { readSkillClassification } from "../../lib/skill-intelligence/policy.ts";
import { tryRecordAuditEvent } from "../control-plane/audit-events.ts";
import { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } from "../control-plane/database.ts";
import { listSkillsResponse } from "../control-plane/read-model.ts";
import type { ResolvedTenantContext } from "../control-plane/tenant-context.ts";

import { readTelemetryEncryptionKey } from "./artifact-crypto.ts";
import type { CatalogSkill, ReleasePort, SkillCatalogPort, SkillIntelligenceDeps } from "./ports.ts";
import { createPostgresSkillIntelligenceStore } from "./postgres-store.ts";
import { createMemorySkillIntelligenceStore, type SkillIntelligenceStore } from "./store.ts";

export const WORKER_AUTH_ENV_VAR = "SAVANT_WORKER_TOKEN";

export class SkillIntelligenceRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 503) {
    super(message);
    this.name = "SkillIntelligenceRuntimeError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Store selection
// ---------------------------------------------------------------------------

type GlobalWithMemoryStore = typeof globalThis & { __savantSkillIntelligenceMemoryStore?: SkillIntelligenceStore };

function isDatabaseBacked(): boolean {
  return isControlPlaneDatabaseConfigured;
}

function resolveStore(): SkillIntelligenceStore {
  if (isDatabaseBacked()) {
    return createPostgresSkillIntelligenceStore(getControlPlaneDatabase(), {
      encryptionKey: readTelemetryEncryptionKey(),
    });
  }

  if (process.env.NODE_ENV !== "development") {
    throw new SkillIntelligenceRuntimeError(
      "skill_intelligence_unconfigured",
      "DATABASE_URL must be configured before Skill Intelligence can store telemetry.",
    );
  }

  // Development only: one process-wide in-memory store so the dev server and a
  // locally running worker see the same jobs.
  const holder = globalThis as GlobalWithMemoryStore;
  holder.__savantSkillIntelligenceMemoryStore ??= createMemorySkillIntelligenceStore();
  return holder.__savantSkillIntelligenceMemoryStore;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function buildSystemContext(organizationId: string): ResolvedTenantContext {
  return {
    identity: null,
    tenant: {
      organizationId,
      workspaceName: "Workspace",
      workspaceSlug: organizationId.startsWith("development-") ? organizationId.slice("development-".length) : "workspace",
      isDefault: true,
      isLastUsed: true,
    },
    memberships: [],
    isDevelopmentFallback: !isDatabaseBacked(),
  };
}

type SkillEnrichmentRow = {
  skill_id: string;
  manifest: unknown;
  latest_total_cases: number | null;
  recent_results: number;
  recent_clean_results: number;
};

type VersionRow = {
  version_ref: string;
  observed_at: Date | string;
  channel: string | null;
  score_pct: number | null;
};

/** Synthetic newest-first history for development fixtures (matches the DB query order). */
function buildDevelopmentVersionHistory(ref: string, trend: readonly number[]): CatalogSkill["versionHistory"] {
  const match = ref.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  let major = match ? Number(match[1]) : 1;
  let minor = match ? Number(match[2]) : 0;
  let patch = match ? Number(match[3]) : 0;
  const refs: string[] = [];
  for (let step = 0; step < trend.length; step += 1) {
    refs.push(`v${major}.${minor}.${patch}`);
    if (patch > 0) {
      patch -= 1;
    } else if (minor > 0) {
      minor -= 1;
      patch = 4;
    } else {
      major = Math.max(0, major - 1);
      minor = 9;
      patch = 4;
    }
  }

  const newestFirst = [...trend].reverse();
  return newestFirst.map((score, index) => {
    const previous = newestFirst[index + 1];
    return {
      ref: match ? refs[index] ?? ref : `${ref}-${index}`,
      releasedAt: new Date(Date.now() - index * 14 * 24 * 60 * 60 * 1000).toISOString(),
      score,
      delta: previous == null ? null : Math.round((score - previous) * 10) / 10,
    };
  });
}

async function listCatalogSkills(organizationId: string): Promise<CatalogSkill[]> {
  const context = buildSystemContext(organizationId);
  const skills: SkillListItem[] = (await listSkillsResponse({}, context)).data;

  if (!isDatabaseBacked()) {
    return skills.map((skill) => ({
      skillId: skill.id,
      skillUuid: skill.skillUuid,
      name: skill.name,
      tier: skill.tier,
      owner: skill.owner,
      baseVersion: skill.ref,
      classification: skill.tier === 1 ? "confidential" : "internal",
      evalBenchmark: skill.score,
      regressionStability: 92,
      authoredEvalCases: 12,
      versionHistory: buildDevelopmentVersionHistory(skill.ref, skill.trend),
    }));
  }

  const sql = getControlPlaneDatabase();
  const enrichment = await sql<SkillEnrichmentRow[]>`
    select distinct on (indexed_skills.skill_id)
      indexed_skills.skill_id,
      indexed_skills.manifest,
      (
        select total_cases from indexed_eval_results
        where indexed_eval_results.indexed_skill_id = indexed_skills.id
        order by executed_at desc nulls last, indexed_at desc limit 1
      ) as latest_total_cases,
      (
        select count(*)::int from (
          select status from indexed_eval_results
          where indexed_eval_results.indexed_skill_id = indexed_skills.id
          order by executed_at desc nulls last limit 10
        ) recent
      ) as recent_results,
      (
        select count(*)::int from (
          select status from indexed_eval_results
          where indexed_eval_results.indexed_skill_id = indexed_skills.id
          order by executed_at desc nulls last limit 10
        ) recent
        where recent.status not in ('complete_with_regressions', 'failed')
      ) as recent_clean_results
    from indexed_skills
    where indexed_skills.organization_id = ${organizationId}
    order by indexed_skills.skill_id, indexed_skills.last_indexed_at desc
  `;
  const bySkill = new Map(enrichment.map((row) => [row.skill_id, row]));

  return skills.map((skill) => {
    const row = bySkill.get(skill.id);
    return {
      skillId: skill.id,
      skillUuid: skill.skillUuid,
      name: skill.name,
      tier: skill.tier,
      owner: skill.owner === "—" ? null : skill.owner,
      baseVersion: skill.ref,
      classification: readSkillClassification(row?.manifest),
      evalBenchmark: skill.score,
      regressionStability: row && row.recent_results > 0
        ? Math.round((row.recent_clean_results / row.recent_results) * 1000) / 10
        : null,
      authoredEvalCases: row?.latest_total_cases ?? 0,
      versionHistory: [],
    };
  });
}

async function loadVersionHistory(organizationId: string, skillId: string): Promise<CatalogSkill["versionHistory"]> {
  const sql = getControlPlaneDatabase();
  const rows = await sql<VersionRow[]>`
    select
      indexed_skill_versions.version_ref,
      indexed_skill_versions.observed_at,
      indexed_skill_versions.channel,
      (
        select coalesce(results.overall_score::float8, round((results.passed_cases::numeric * 100) / greatest(results.total_cases, 1), 1)::float8)
        from indexed_eval_results results
        inner join indexed_skills on indexed_skills.id = results.indexed_skill_id
        where indexed_skills.organization_id = ${organizationId}
          and indexed_skills.skill_id = ${skillId}
          and results.comparison_commit_sha = indexed_skill_versions.commit_sha
        order by results.executed_at desc nulls last limit 1
      ) as score_pct
    from indexed_skill_versions
    inner join repositories on repositories.id = indexed_skill_versions.repository_id
    where repositories.organization_id = ${organizationId}
      and indexed_skill_versions.skill_id = ${skillId}
    order by indexed_skill_versions.observed_at desc
    limit 20
  `;

  return rows.map((row, index) => {
    const previous = rows[index + 1]?.score_pct ?? null;
    return {
      ref: row.version_ref,
      releasedAt: (row.observed_at instanceof Date ? row.observed_at : new Date(row.observed_at)).toISOString(),
      score: row.score_pct,
      delta: row.score_pct != null && previous != null ? Math.round((row.score_pct - previous) * 10) / 10 : null,
    };
  });
}

function createCatalog(): SkillCatalogPort {
  return {
    listSkills: listCatalogSkills,

    async getSkill(organizationId, identifier) {
      const skills = await listCatalogSkills(organizationId);
      const match = findSkillByIdentifier(
        skills.map((skill) => ({ id: skill.skillId, skillUuid: skill.skillUuid ?? skill.skillId })),
        identifier,
      );
      const skill = match ? skills.find((entry) => entry.skillId === match.id) ?? null : null;
      if (!skill || !isDatabaseBacked()) {
        return skill;
      }
      return { ...skill, versionHistory: await loadVersionHistory(organizationId, skill.skillId) };
    },

    async getSkillContent(organizationId, skillId) {
      if (!isDatabaseBacked()) {
        const { buildDevelopmentSkillContent } = await import("./dev-fixtures.ts");
        const skill = (await listSkillsResponse({}, buildSystemContext(organizationId))).data.find((entry) => entry.id === skillId);
        return skill ? { content: buildDevelopmentSkillContent(skill), live: false } : null;
      }
      const { getSkillSourceResponse } = await import("../control-plane/skill-source.ts");
      const response = await getSkillSourceResponse(skillId, buildSystemContext(organizationId));
      if (!response) {
        return null;
      }
      const live = response.data.mode === "repository";
      // Never optimize a generated placeholder in a real workspace.
      if (!live && isDatabaseBacked()) {
        return null;
      }
      return { content: response.data.content, live };
    },

    async getDependents(organizationId, skillId) {
      if (!isDatabaseBacked()) {
        return { direct: 0, transitive: 0, suiteSkillIds: [] };
      }
      const sql = getControlPlaneDatabase();
      const rows = await sql<{ skill_id: string; depth: number }[]>`
        with recursive dependents as (
          select distinct indexed_skills.skill_id, 1 as depth
          from indexed_skill_dependencies
          inner join indexed_skills on indexed_skills.id = indexed_skill_dependencies.indexed_skill_id
          where indexed_skills.organization_id = ${organizationId}
            and indexed_skill_dependencies.dependency_skill_id = ${skillId}
          union
          select distinct indexed_skills.skill_id, dependents.depth + 1
          from dependents
          inner join indexed_skill_dependencies on indexed_skill_dependencies.dependency_skill_id = dependents.skill_id
          inner join indexed_skills on indexed_skills.id = indexed_skill_dependencies.indexed_skill_id
          where indexed_skills.organization_id = ${organizationId}
            and dependents.depth < 6
        )
        select skill_id, min(depth)::int as depth from dependents
        where skill_id <> ${skillId}
        group by skill_id
      `;
      const direct = rows.filter((row) => row.depth === 1);
      return {
        direct: direct.length,
        transitive: rows.length - direct.length,
        suiteSkillIds: direct.map((row) => row.skill_id).slice(0, 25),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Release rail
// ---------------------------------------------------------------------------

function createReleasePort(context: ResolvedTenantContext | null): ReleasePort {
  return {
    async stageCandidate({ organizationId, recommendation, actor }) {
      if (!isDatabaseBacked()) {
        return { staged: true, releaseRequestId: `dev-release-${recommendation.recommendationId.slice(0, 8)}`, commitSha: null };
      }
      if (!context?.identity) {
        return { staged: false, reason: "An authenticated Owner or platform-admin must stage this release." };
      }

      const { updateSkillSourceInRepository } = await import("../control-plane/skill-source.ts");
      const { TenantWriteAccessError } = await import("../control-plane/tenant-write-access.ts");
      let commit;
      try {
        commit = await updateSkillSourceInRepository({
          context,
          skillId: recommendation.skillId,
          request: {
            content: recommendation.candidateContent,
            commitMessage: `savant: ${recommendation.candidateVersion ?? "candidate"} from improvement recommendation ${recommendation.recommendationId}`,
          },
        });
      } catch (error) {
        if (error instanceof TenantWriteAccessError) {
          return { staged: false, reason: "Approved. An Owner or platform-admin must stage the release to write the new version to Git." };
        }
        if (error instanceof Error && "code" in error) {
          return { staged: false, reason: error.message };
        }
        throw error;
      }

      const sql = getControlPlaneDatabase();
      const rows = await sql<{ id: string }[]>`
        insert into release_requests (
          organization_id, repository_id, skill_id, source_ref, source_commit_sha,
          from_environment, to_environment, status, requested_by
        )
        select
          ${organizationId},
          indexed_skills.repository_id,
          ${recommendation.skillId},
          ${recommendation.candidateVersion ?? commit.commit.sha},
          ${commit.commit.sha},
          'draft', 'staging', 'pending', ${actor.userId}
        from indexed_skills
        where indexed_skills.organization_id = ${organizationId}
          and indexed_skills.skill_id = ${recommendation.skillId}
        order by indexed_skills.last_indexed_at desc
        limit 1
        returning id
      `;
      const releaseRequestId = rows[0]?.id;
      if (!releaseRequestId) {
        return { staged: false, reason: "The candidate was committed but no indexed skill row was found to open a release request." };
      }

      await sql`
        insert into release_events (release_request_id, event_type, actor_user_id, payload)
        values (
          ${releaseRequestId}, 'created_from_recommendation', ${actor.userId},
          ${sql.json({
            recommendationId: recommendation.recommendationId,
            baseVersion: recommendation.baseVersion,
            candidateVersion: recommendation.candidateVersion ?? null,
            optimizer: recommendation.provenance,
            approvals: recommendation.approvals,
          } as never)}
        )
      `;

      return { staged: true, releaseRequestId, commitSha: commit.commit.sha };
    },
  };
}

// ---------------------------------------------------------------------------
// Public factories
// ---------------------------------------------------------------------------

export function createSkillIntelligenceRuntime(context: ResolvedTenantContext | null): SkillIntelligenceDeps {
  const store = resolveStore();
  return {
    store,
    catalog: createCatalog(),
    releases: createReleasePort(context),
    events: {
      async emit(event) {
        await tryRecordAuditEvent({
          organizationId: event.organizationId,
          actorSubject: event.actorRef,
          category: event.category,
          action: event.action,
          targetType: event.targetType,
          targetRef: event.targetRef,
          payload: event.payload,
        });
      },
    },
    artifactsEnabled: store.kind === "memory" || readTelemetryEncryptionKey() != null,
  };
}

export async function ensureDevelopmentFixtures(deps: SkillIntelligenceDeps, organizationId: string): Promise<void> {
  if (deps.store.kind !== "memory") {
    return;
  }
  const { seedDevelopmentSkillIntelligence } = await import("./dev-fixtures.ts");
  try {
    await seedDevelopmentSkillIntelligence(deps, organizationId);
  } catch (error) {
    // Synthetic fixtures must never break a local page.
    console.warn("[skill-intelligence] development fixture seeding failed", error);
  }
}

/** Constant-time check of the platform worker bearer token. */
export function isAuthorizedWorkerRequest(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const expected = env[WORKER_AUTH_ENV_VAR]?.trim();
  if (!expected || expected.length < 16) {
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    return false;
  }
  const provided = Buffer.from(match[1].trim(), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

export function readBearerToken(request: Request): string | null {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
