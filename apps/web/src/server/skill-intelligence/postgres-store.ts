// Postgres implementation of the Skill Intelligence store.
//
// Run artifacts are encrypted with TELEMETRY_ENCRYPTION_KEY before insert. The
// service layer refuses to hand artifacts to this store when no key exists, so
// plaintext payloads never reach the database.

import type {
  CandidateValidation,
  CohortScore,
  ExplicitFeedbackCategory,
  OptimizationDatasetSummary,
  PassiveSignalType,
  RecommendationStatus,
  RejectionReason,
  SkillHealthSnapshot,
  SkillImprovementRecommendation,
  SkillRunFeedbackSummary,
  SkillRuntime,
  TaskOutcome,
  TelemetryLevel,
} from "@savant/types";

import { aggregateWeakLabel, scoreRunFeedbackSummary } from "../../lib/skill-intelligence/feedback-signals.ts";
import type { AnalyzedRun } from "../../lib/skill-intelligence/health.ts";
import { normalizeSkillIntelligenceSettings } from "../../lib/skill-intelligence/policy.ts";
import type { ControlPlaneSql } from "../control-plane/database.ts";

import { decryptArtifact, encryptArtifact } from "./artifact-crypto.ts";
import {
  ActiveJobConflictError,
  type CandidateInsert,
  type JobRecord,
  type RunArtifacts,
  type SkillIntelligenceStore,
} from "./store.ts";

type RunRow = {
  run_id: string;
  runtime: SkillRuntime;
  model: string | null;
  skill_version_id: string;
  connector_id: string;
  telemetry_level: TelemetryLevel;
  success: boolean | null;
  started_at: Date | string;
  latency_ms: number | null;
  estimated_cost: string | number | null;
  task_archetype: string | null;
  business_unit: string | null;
  input_structure: "structured" | "unstructured" | null;
  input_fingerprint: string | null;
  feedback: SkillRunFeedbackSummary | null;
  feedback_rows: Array<{
    derived_score: number;
    reporter_role: "user" | "sme" | "system";
    categories: ExplicitFeedbackCategory[];
    signal: PassiveSignalType | null;
    edit_ratio: number | null;
    rubric_dimension: string | null;
  }> | null;
  outcome_task: TaskOutcome | null;
  outcome_accepted: boolean | null;
  outcome_score: string | number | null;
};

type JobRow = {
  id: string;
  organization_id: string;
  skill_id: string;
  base_version: string;
  trigger: JobRecord["trigger"];
  status: JobRecord["status"];
  objective: JobRecord["objective"];
  change_budget: JobRecord["changeBudget"];
  optimizer_provider: JobRecord["optimizerProvider"];
  parent_recommendation_id: string | null;
  requested_by: string | null;
  attempt: number;
  queued_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  error_message: string | null;
  recommendation_id: string | null;
};

function iso(value: Date | string | null): string | null {
  if (value == null) {
    return null;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toNumber(value: string | number | null): number | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapJob(row: JobRow): JobRecord {
  return {
    jobId: row.id,
    organizationId: row.organization_id,
    skillId: row.skill_id,
    baseVersion: row.base_version,
    trigger: row.trigger,
    status: row.status,
    objective: row.objective,
    changeBudget: row.change_budget,
    optimizerProvider: row.optimizer_provider,
    parentRecommendationId: row.parent_recommendation_id,
    requestedBy: row.requested_by,
    attempt: row.attempt,
    queuedAt: iso(row.queued_at) ?? new Date().toISOString(),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    error: row.error_message,
    recommendationId: row.recommendation_id,
  };
}

function mapRun(row: RunRow): AnalyzedRun {
  const feedback = row.feedback_rows ?? [];
  const editRatios = feedback.map((entry) => toNumber(entry.edit_ratio)).filter((value): value is number => value != null);
  const summary = row.feedback && Object.keys(row.feedback).length > 0 ? row.feedback : undefined;

  return {
    runId: row.run_id,
    runtime: row.runtime,
    model: row.model,
    skillVersionId: row.skill_version_id,
    connectorId: row.connector_id,
    telemetryLevel: row.telemetry_level,
    success: row.success,
    startedAt: iso(row.started_at) ?? new Date(0).toISOString(),
    latencyMs: row.latency_ms,
    estimatedCost: toNumber(row.estimated_cost),
    weakLabel: aggregateWeakLabel(
      feedback.map((entry) => ({ derivedScore: Number(entry.derived_score), reporterRole: entry.reporter_role })),
      scoreRunFeedbackSummary(summary),
    ),
    taskArchetype: row.task_archetype,
    businessUnit: row.business_unit,
    inputStructure: row.input_structure,
    inputFingerprint: row.input_fingerprint,
    feedbackCategories: [...new Set(feedback.flatMap((entry) => entry.categories ?? []))],
    passiveSignals: feedback.flatMap((entry) => (entry.signal ? [entry.signal] : [])),
    rubricFailures: [...new Set(feedback.flatMap((entry) =>
      entry.rubric_dimension && Number(entry.derived_score) < 0 ? [entry.rubric_dimension] : [],
    ))],
    editRatio: editRatios.length > 0 ? Math.max(...editRatios) : summary?.editDistance ?? null,
    humanAccepted: row.outcome_accepted ?? summary?.accepted ?? null,
    taskOutcome: row.outcome_task,
    outputScore: toNumber(row.outcome_score),
  };
}

export function createPostgresSkillIntelligenceStore(
  sql: ControlPlaneSql,
  options: { encryptionKey: Buffer | null },
): SkillIntelligenceStore {
  const key = options.encryptionKey;

  return {
    kind: "postgres",

    async getSettings(organizationId) {
      const rows = await sql<{ settings: unknown }[]>`
        select settings from optimization_configs
        where organization_id = ${organizationId} and scope_type = 'organization' and scope_ref = 'default'
      `;
      return normalizeSkillIntelligenceSettings(rows[0]?.settings ?? {});
    },

    async saveSettings(organizationId, settings, actorUserId) {
      await sql`
        insert into optimization_configs (organization_id, scope_type, scope_ref, settings, updated_by)
        values (${organizationId}, 'organization', 'default', ${sql.json(settings as never)}, ${actorUserId})
        on conflict (organization_id, scope_type, scope_ref) do update
        set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = now()
      `;
    },

    async insertRun(organizationId, prepared) {
      const { request } = prepared;
      return sql.begin(async (tx) => {
        const inserted = await tx<{ id: string }[]>`
          insert into skill_runs (
            organization_id, run_id, skill_id, skill_version_id, connector_id, runtime, model,
            telemetry_level, started_at, completed_at, success, latency_ms, input_tokens, output_tokens,
            estimated_cost, task_archetype, input_structure, business_unit, actor_user_ref, actor_pseudonym,
            group_ids, input_fingerprint, feedback, policy, expires_at
          )
          values (
            ${organizationId}, ${request.runId}, ${request.skillId}, ${request.skillVersionId}, ${request.connectorId},
            ${request.runtime}, ${request.model ?? null}, ${prepared.storedLevel}, ${request.startedAt},
            ${request.completedAt ?? null}, ${request.success ?? null}, ${request.latencyMs ?? null},
            ${request.inputTokens ?? null}, ${request.outputTokens ?? null}, ${request.estimatedCost ?? null},
            ${request.taskArchetype ?? null}, ${request.inputStructure ?? null}, ${request.businessUnit ?? null},
            ${prepared.actorUserRef}, ${prepared.actorPseudonym}, ${request.groupIds ?? []},
            ${prepared.inputFingerprint}, ${sql.json((request.feedback ?? {}) as never)},
            ${sql.json(prepared.policy as never)}, ${prepared.expiresAt}
          )
          on conflict (organization_id, run_id) do nothing
          returning id
        `;

        const row = inserted[0];
        if (!row) {
          return "duplicate" as const;
        }

        if (prepared.artifacts.length > 0) {
          if (!key) {
            throw new Error("Refusing to persist run artifacts without TELEMETRY_ENCRYPTION_KEY.");
          }
          for (const artifact of prepared.artifacts) {
            const storageRef = `pg://skill_run_artifacts/${row.id}/${artifact.kind}`;
            await tx`
              insert into skill_run_artifacts (
                skill_run_id, artifact_kind, storage_ref, encrypted_payload, content_hash,
                byte_size, redaction_summary, expires_at
              )
              values (
                ${row.id}, ${artifact.kind}, ${storageRef},
                ${encryptArtifact(artifact.text, { organizationId, runId: request.runId, kind: artifact.kind }, key)},
                ${artifact.contentHash}, ${artifact.byteSize}, ${sql.json(artifact.redactionCounts as never)},
                ${prepared.expiresAt}
              )
            `;
          }
        }

        return "inserted" as const;
      });
    },

    async findRunSkill(organizationId, runId) {
      const rows = await sql<{ skill_id: string }[]>`
        select skill_id from skill_runs where organization_id = ${organizationId} and run_id = ${runId}
      `;
      return rows[0]?.skill_id ?? null;
    },

    async insertFeedback(organizationId, record) {
      const rows = await sql<{ id: string }[]>`
        insert into skill_feedback (
          skill_run_id, kind, signal, categories, rating, edit_ratio, comment_redacted,
          reporter_role, rubric_dimension, derived_score, recorded_at
        )
        select
          skill_runs.id, ${record.kind}, ${record.signal ?? null}, ${record.categories ?? []},
          ${record.rating ?? null}, ${record.editRatio ?? null}, ${record.comment ?? null},
          ${record.reporterRole ?? "user"}, ${record.rubricDimension ?? null}, ${record.derivedScore},
          ${record.recordedAt}
        from skill_runs
        where skill_runs.organization_id = ${organizationId} and skill_runs.run_id = ${record.runId}
        returning id
      `;
      return rows.length > 0;
    },

    async insertOutcome(organizationId, record) {
      const rows = await sql<{ id: string }[]>`
        insert into skill_outcomes (skill_run_id, output_score, human_accepted, task_outcome, outcome_label, recorded_at)
        select skill_runs.id, ${record.outputScore ?? null}, ${record.humanAccepted ?? null},
          ${record.taskOutcome}, ${record.outcomeLabel ?? null}, ${record.recordedAt}
        from skill_runs
        where skill_runs.organization_id = ${organizationId} and skill_runs.run_id = ${record.runId}
        returning id
      `;
      return rows.length > 0;
    },

    async listAnalyzedRuns(organizationId, skillId, sinceIso) {
      const rows = await sql<RunRow[]>`
        select
          skill_runs.run_id, skill_runs.runtime, skill_runs.model, skill_runs.skill_version_id,
          skill_runs.connector_id, skill_runs.telemetry_level, skill_runs.success, skill_runs.started_at,
          skill_runs.latency_ms, skill_runs.estimated_cost, skill_runs.task_archetype, skill_runs.business_unit,
          skill_runs.input_structure, skill_runs.input_fingerprint, skill_runs.feedback,
          (
            select json_agg(json_build_object(
              'derived_score', skill_feedback.derived_score,
              'reporter_role', skill_feedback.reporter_role,
              'categories', skill_feedback.categories,
              'signal', skill_feedback.signal,
              'edit_ratio', skill_feedback.edit_ratio,
              'rubric_dimension', skill_feedback.rubric_dimension
            ))
            from skill_feedback where skill_feedback.skill_run_id = skill_runs.id
          ) as feedback_rows,
          latest_outcome.task_outcome as outcome_task,
          latest_outcome.human_accepted as outcome_accepted,
          latest_outcome.output_score as outcome_score
        from skill_runs
        left join lateral (
          select task_outcome, human_accepted, output_score
          from skill_outcomes where skill_outcomes.skill_run_id = skill_runs.id
          order by recorded_at desc limit 1
        ) latest_outcome on true
        where skill_runs.organization_id = ${organizationId}
          and skill_runs.skill_id = ${skillId}
          and skill_runs.started_at >= ${sinceIso}
          and skill_runs.expires_at > now()
        order by skill_runs.started_at desc
        limit 5000
      `;
      return rows.map(mapRun);
    },

    async listRunArtifacts(organizationId, runIds) {
      const result = new Map<string, RunArtifacts>();
      if (runIds.length === 0) {
        return result;
      }
      if (!key) {
        return result;
      }
      const rows = await sql<{ run_id: string; artifact_kind: string; encrypted_payload: string | null }[]>`
        select skill_runs.run_id, skill_run_artifacts.artifact_kind, skill_run_artifacts.encrypted_payload
        from skill_run_artifacts
        inner join skill_runs on skill_runs.id = skill_run_artifacts.skill_run_id
        where skill_runs.organization_id = ${organizationId}
          and skill_runs.run_id = any(${runIds as string[]})
          and skill_run_artifacts.artifact_kind in ('input', 'output')
          and skill_run_artifacts.expires_at > now()
      `;
      for (const row of rows) {
        if (!row.encrypted_payload) {
          continue;
        }
        const entry = result.get(row.run_id) ?? { input: null, output: null };
        const text = decryptArtifact(row.encrypted_payload, { organizationId, runId: row.run_id, kind: row.artifact_kind }, key);
        if (row.artifact_kind === "input") entry.input = text;
        if (row.artifact_kind === "output") entry.output = text;
        result.set(row.run_id, entry);
      }
      return result;
    },

    async listOrgRunCoverage(organizationId, sinceIso) {
      const rows = await sql<{ skill_id: string; runtime: SkillRuntime; telemetry_level: TelemetryLevel }[]>`
        select skill_id, runtime, telemetry_level from skill_runs
        where organization_id = ${organizationId} and started_at >= ${sinceIso} and expires_at > now()
      `;
      return rows.map((row) => ({ skillId: row.skill_id, runtime: row.runtime, telemetryLevel: row.telemetry_level }));
    },

    async saveHealthSnapshot(organizationId, snapshot: SkillHealthSnapshot, cohorts: CohortScore[]) {
      await sql`
        insert into skill_health_snapshots (
          organization_id, skill_id, composite, dimensions, cohorts, run_count, full_trajectory_coverage, computed_at
        )
        values (
          ${organizationId}, ${snapshot.skillId}, ${snapshot.composite}, ${sql.json(snapshot.dimensions as never)},
          ${sql.json(cohorts as never)}, ${snapshot.runCount}, ${snapshot.fullTrajectoryCoverage}, ${snapshot.computedAt}
        )
      `;
    },

    async listHealthSnapshots(organizationId, sinceIso) {
      const rows = await sql<{ skill_id: string; composite: string | null; computed_at: Date | string }[]>`
        select skill_id, composite, computed_at from skill_health_snapshots
        where organization_id = ${organizationId} and computed_at >= ${sinceIso}
        order by computed_at asc
      `;
      return rows.map((row) => ({
        skillId: row.skill_id,
        composite: toNumber(row.composite),
        computedAt: iso(row.computed_at) ?? "",
      }));
    },

    async enqueueJob(job) {
      try {
        const rows = await sql<JobRow[]>`
          insert into optimization_jobs (
            organization_id, skill_id, base_version, trigger, objective, change_budget,
            optimizer_provider, requested_by, parent_recommendation_id
          )
          values (
            ${job.organizationId}, ${job.skillId}, ${job.baseVersion}, ${job.trigger},
            ${sql.json(job.objective as never)}, ${sql.json(job.changeBudget as never)},
            ${job.optimizerProvider}, ${job.requestedBy}, ${job.parentRecommendationId}
          )
          returning *, null::uuid as recommendation_id
        `;
        return mapJob(rows[0] as JobRow);
      } catch (error) {
        if (typeof error === "object" && error !== null && (error as { code?: string }).code === "23505") {
          throw new ActiveJobConflictError(job.skillId);
        }
        throw error;
      }
    },

    async listJobs(organizationId, skillId, limit) {
      const rows = await sql<JobRow[]>`
        select optimization_jobs.*, improvement_recommendations.id as recommendation_id
        from optimization_jobs
        left join improvement_recommendations
          on improvement_recommendations.optimization_job_id = optimization_jobs.id
        where optimization_jobs.organization_id = ${organizationId} and optimization_jobs.skill_id = ${skillId}
        order by optimization_jobs.queued_at desc
        limit ${limit}
      `;
      return rows.map(mapJob);
    },

    async claimNextJob(leaseTokenHash, leaseSeconds, now) {
      const rows = await sql<JobRow[]>`
        update optimization_jobs
        set status = 'running',
            started_at = ${now.toISOString()},
            attempt = attempt + 1,
            lease_token_hash = ${leaseTokenHash},
            lease_expires_at = ${new Date(now.getTime() + leaseSeconds * 1000).toISOString()}
        where id = (
          select id from optimization_jobs
          where status = 'queued'
             or (status = 'running' and lease_expires_at < ${now.toISOString()})
          order by queued_at asc
          limit 1
          for update skip locked
        )
        returning *, null::uuid as recommendation_id
      `;
      return rows[0] ? mapJob(rows[0]) : null;
    },

    async getLeasedJob(jobId, leaseTokenHash, now) {
      const rows = await sql<JobRow[]>`
        select *, null::uuid as recommendation_id from optimization_jobs
        where id = ${jobId}
          and status = 'running'
          and lease_token_hash = ${leaseTokenHash}
          and lease_expires_at >= ${now.toISOString()}
      `;
      return rows[0] ? mapJob(rows[0]) : null;
    },

    async finishJob(jobId, status, error) {
      await sql`
        update optimization_jobs
        set status = ${status}, error_message = ${error}, completed_at = now(), lease_token_hash = null
        where id = ${jobId}
      `;
    },

    async saveDatasets(jobId, datasets: readonly OptimizationDatasetSummary[]) {
      for (const dataset of datasets) {
        await sql`
          insert into optimization_datasets (optimization_job_id, partition, case_count, run_ids, dataset_hash, curation_summary)
          values (${jobId}, ${dataset.partition}, ${dataset.caseCount}, ${dataset.runIds}, ${dataset.datasetHash},
            ${sql.json(dataset.curationSummary as never)})
          on conflict (optimization_job_id, partition) do update
          set case_count = excluded.case_count, run_ids = excluded.run_ids,
              dataset_hash = excluded.dataset_hash, curation_summary = excluded.curation_summary
        `;
      }
    },

    async saveCandidate(candidate: CandidateInsert) {
      const rows = await sql<{ id: string }[]>`
        insert into optimization_candidates (
          optimization_job_id, organization_id, skill_id, base_content_hash, candidate_content,
          candidate_content_hash, edits, provenance, origin
        )
        values (
          ${candidate.jobId}, ${candidate.organizationId}, ${candidate.skillId}, ${candidate.baseContentHash},
          ${candidate.candidateContent}, ${candidate.candidateContentHash}, ${sql.json(candidate.edits as never)},
          ${sql.json(candidate.provenance as never)}, ${candidate.origin}
        )
        returning id
      `;
      return (rows[0] as { id: string }).id;
    },

    async saveCandidateEvaluation(candidateId, validation: CandidateValidation) {
      await sql`
        insert into candidate_evaluations (optimization_candidate_id, candidate_content_hash, validation, passed)
        values (${candidateId}, ${validation.candidateContentHash}, ${sql.json(validation as never)}, ${validation.passed})
      `;
    },

    async insertRecommendation(recommendation, links) {
      await sql`
        insert into improvement_recommendations (
          id, organization_id, skill_id, optimization_job_id, optimization_candidate_id, base_version,
          candidate_version, trigger, status, requires_reevaluation, required_approvals, priority_score, payload,
          created_at, updated_at
        )
        values (
          ${recommendation.recommendationId}, ${recommendation.tenantId}, ${recommendation.skillId},
          ${links.jobId}, ${links.candidateId}, ${recommendation.baseVersion},
          ${recommendation.candidateVersion ?? null}, ${recommendation.trigger}, ${recommendation.status},
          ${recommendation.requiresReevaluation}, ${recommendation.requiredApprovals},
          ${recommendation.priorityScore}, ${sql.json(recommendation as never)},
          ${recommendation.createdAt}, ${recommendation.updatedAt}
        )
      `;
    },

    async updateRecommendation(recommendation) {
      await sql`
        update improvement_recommendations
        set status = ${recommendation.status},
            candidate_version = ${recommendation.candidateVersion ?? null},
            requires_reevaluation = ${recommendation.requiresReevaluation},
            priority_score = ${recommendation.priorityScore},
            release_request_id = ${recommendation.releaseRequestId},
            payload = ${sql.json(recommendation as never)},
            updated_at = ${recommendation.updatedAt}
        where id = ${recommendation.recommendationId} and organization_id = ${recommendation.tenantId}
      `;
    },

    async getRecommendation(organizationId, recommendationId) {
      if (!/^[0-9a-f-]{36}$/i.test(recommendationId)) {
        return null;
      }
      const rows = await sql<{ payload: SkillImprovementRecommendation }[]>`
        select payload from improvement_recommendations
        where id = ${recommendationId} and organization_id = ${organizationId}
      `;
      return rows[0]?.payload ?? null;
    },

    async listRecommendations(organizationId, filter) {
      const statuses = filter.statuses ? [...filter.statuses] as RecommendationStatus[] : null;
      const rows = await sql<{ payload: SkillImprovementRecommendation }[]>`
        select payload from improvement_recommendations
        where organization_id = ${organizationId}
          and (${filter.skillId ?? null}::text is null or skill_id = ${filter.skillId ?? null})
          and (${statuses}::text[] is null or status = any(${statuses}::text[]))
        order by created_at desc
        limit 200
      `;
      return rows.map((row) => row.payload);
    },

    async insertReview(organizationId, recommendationId, review, reviewerUserId) {
      await sql`
        insert into recommendation_reviews (
          id, recommendation_id, reviewer_user_id, reviewer_ref, reviewer_role, decision, reasons, comment,
          edit_decisions, created_at
        )
        select ${review.reviewId}, improvement_recommendations.id, ${reviewerUserId}, ${review.reviewer},
          ${review.reviewerRole}, ${review.decision}, ${review.reasons}, ${review.comment},
          ${sql.json(review.editDecisions as never)}, ${review.createdAt}
        from improvement_recommendations
        where improvement_recommendations.id = ${recommendationId}
          and improvement_recommendations.organization_id = ${organizationId}
      `;
    },

    async listRejectionSignals(organizationId, skillId) {
      const rows = await sql<{ reason: RejectionReason; count: number }[]>`
        select reason, count(*)::int as count
        from recommendation_reviews
        inner join improvement_recommendations on improvement_recommendations.id = recommendation_reviews.recommendation_id
        cross join lateral unnest(recommendation_reviews.reasons) as reason
        where improvement_recommendations.organization_id = ${organizationId}
          and improvement_recommendations.skill_id = ${skillId}
          and recommendation_reviews.decision = 'reject'
        group by reason
      `;
      return rows;
    },

    async createIngestToken(input) {
      const rows = await sql<{ id: string; created_at: Date | string }[]>`
        insert into telemetry_ingest_tokens (organization_id, label, token_hash, connector_id, created_by)
        values (${input.organizationId}, ${input.label}, ${input.tokenHash}, ${input.connectorId}, ${input.userId})
        returning id, created_at
      `;
      const row = rows[0] as { id: string; created_at: Date | string };
      return { tokenId: row.id, createdAt: iso(row.created_at) ?? new Date().toISOString() };
    },

    async resolveIngestToken(tokenHash) {
      const rows = await sql<{ organization_id: string; id: string; connector_id: string | null }[]>`
        update telemetry_ingest_tokens set last_used_at = now()
        where token_hash = ${tokenHash} and status = 'active'
        returning organization_id, id, connector_id
      `;
      const row = rows[0];
      return row ? { organizationId: row.organization_id, tokenId: row.id, connectorId: row.connector_id } : null;
    },

    async purgeExpiredTelemetry(now) {
      const rows = await sql<{ id: string }[]>`
        delete from skill_runs where expires_at < ${now.toISOString()} returning id
      `;
      return rows.length;
    },
  };
}
