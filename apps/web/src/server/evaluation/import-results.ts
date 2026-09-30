import { createHash } from "node:crypto";

import type { SkillPackageEvaluation } from "../assessment/assess.ts";

/**
 * Persists import-time evaluations as indexed evaluation assets and results,
 * keyed on the (stable) indexed skill rows. These rows are what the
 * Evaluations screen, the skill Evaluation tab, version history, and Skill
 * Intelligence health (eval benchmark, regression stability, authored cases)
 * read, so the first sync gives SkillOpt its baseline.
 */

export type ImportEvaluationSummary = {
  scored: number;
  requiresExecution: number;
  invalid: number;
  averageScore: number | null;
  belowThreshold: number;
};

type Sql = import("postgres").Sql;

const hash = (content: string) => createHash("sha256").update(content).digest("hex");

export function summarizeImportEvaluations(evaluations: readonly SkillPackageEvaluation[]): ImportEvaluationSummary {
  const scored = evaluations.flatMap((entry) => (entry.evaluation.status === "scored" ? [entry.evaluation] : []));
  return {
    scored: scored.length,
    requiresExecution: evaluations.filter((entry) => entry.evaluation.status === "requires_execution").length,
    invalid: evaluations.filter((entry) => entry.evaluation.status === "invalid").length,
    averageScore: scored.length > 0
      ? Math.round((scored.reduce((sum, evaluation) => sum + evaluation.scorecard.overallScore, 0) / scored.length) * 100) / 100
      : null,
    belowThreshold: scored.filter((evaluation) => {
      const threshold = evaluation.scorecard.thresholds.investigate;
      return threshold !== null && evaluation.scorecard.overallScore < threshold;
    }).length,
  };
}

export function describeImportEvaluations(summary: ImportEvaluationSummary): string {
  if (summary.scored === 0 && summary.requiresExecution === 0) {
    return "";
  }
  const parts = [
    summary.scored > 0 ? `Baseline evaluation scored ${summary.scored} skill${summary.scored === 1 ? "" : "s"} (average ${summary.averageScore}/100${summary.belowThreshold ? `, ${summary.belowThreshold} below threshold` : ""}).` : null,
    summary.requiresExecution > 0 ? `${summary.requiresExecution} skill${summary.requiresExecution === 1 ? " needs" : "s need"} a live run on an AI provider.` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

export async function persistImportEvaluations(sql: Sql, input: {
  repositoryId: string;
  commitSha: string;
  files: Readonly<Record<string, string>>;
  evaluations: readonly SkillPackageEvaluation[];
  now: Date;
}): Promise<ImportEvaluationSummary> {
  const summary = summarizeImportEvaluations(input.evaluations);
  const scored = input.evaluations.filter((entry) => entry.evaluation.status === "scored" || entry.evaluation.status === "invalid");
  if (scored.length === 0) {
    return summary;
  }

  const skills = await sql<{ id: string; source_path: string }[]>`
    select id, source_path from indexed_skills where repository_id = ${input.repositoryId}
  `;
  const idByRoot = new Map(skills.map((row) => [row.source_path, row.id]));
  const runExternalId = `import-${input.commitSha.slice(0, 12)}`;

  await sql.begin(async (tx) => {
    for (const entry of scored) {
      const indexedSkillId = idByRoot.get(entry.root);
      if (!indexedSkillId) {
        continue; // Skipped by the indexer (e.g. missing required files).
      }

      const assetIds: Partial<Record<"dataset" | "rubric" | "baseline", string>> = {};
      for (const [assetType, file] of [["dataset", "dataset.yaml"], ["rubric", "rubric.yaml"], ["baseline", "baseline.json"]] as const) {
        const path = `${entry.root}/eval/${file}`;
        const content = input.files[path];
        if (content === undefined) continue;
        const version = entry.evaluation.status === "scored"
          ? (assetType === "dataset" ? entry.evaluation.evalSetVersion : assetType === "rubric" ? entry.evaluation.rubricVersion : null)
          : null;
        const rows = await tx<{ id: string }[]>`
          insert into indexed_eval_assets (indexed_skill_id, asset_type, logical_name, source_path, source_commit_sha, content_hash, version_label, last_indexed_at)
          values (${indexedSkillId}, ${assetType}, ${`${entry.skillId} ${assetType}`}, ${path}, ${input.commitSha}, ${hash(content)}, ${version}, ${input.now})
          on conflict (indexed_skill_id, asset_type, source_path, source_commit_sha) do update set
            content_hash = excluded.content_hash, version_label = excluded.version_label, last_indexed_at = excluded.last_indexed_at
          returning id
        `;
        if (rows[0]) assetIds[assetType] = rows[0].id;
      }

      // Re-syncing the same commit replaces its import result instead of stacking duplicates.
      await tx`
        delete from indexed_eval_results
        where indexed_skill_id = ${indexedSkillId} and run_external_id = ${runExternalId} and source = 'import'
      `;

      const evaluation = entry.evaluation;
      if (evaluation.status === "scored") {
        const s = evaluation.scorecard;
        const caseResults = evaluation.samples.map((sample) => ({
          caseId: sample.caseId,
          prompt: sample.prompt,
          verdict: sample.verdict,
          quality: Math.round(sample.quality * 100),
          compliance: Math.round(((sample.formatCompliance + (sample.policyCompliance ? 1 : 0)) / 2) * 100),
          grounding: sample.groundingRelevant ? Math.round(sample.groundingScore * 100) : null,
          actionability: Math.round(sample.actionability * 100),
          policyCompliance: sample.policyCompliance,
          latencyMs: sample.latencyMs,
          estimatedCostUsd: sample.estimatedCostUsd,
          humanRevisionCount: sample.humanRevisionCount,
        }));
        await tx`
          insert into indexed_eval_results (
            indexed_skill_id, repository_id, run_external_id, dataset_asset_id, baseline_asset_id,
            comparison_artifact_path, comparison_commit_sha, total_cases, passed_cases, failed_cases,
            score_delta, status, executed_at, indexed_at, overall_score, scorecard, case_results, source
          ) values (
            ${indexedSkillId}, ${input.repositoryId}, ${runExternalId}, ${assetIds.dataset ?? null}, ${assetIds.baseline ?? null},
            ${`${entry.root}/eval/baseline.json`}, ${input.commitSha}, ${s.sampleCount}, ${s.passCount}, ${s.failCount},
            ${evaluation.baselineDelta}, ${evaluation.baselineDelta !== null && evaluation.baselineDelta <= -0.5 ? "complete_with_regressions" : "complete_baseline"},
            ${input.now}, ${input.now}, ${s.overallScore},
            ${tx.json({
              ...s,
              committedBaseline: evaluation.committedBaseline,
              evalSetVersion: evaluation.evalSetVersion,
              rubricVersion: evaluation.rubricVersion,
              method: "deterministic-bootstrap",
            } as never)},
            ${tx.json(caseResults as never)}, 'import'
          )
        `;
      } else {
        await tx`
          insert into indexed_eval_results (
            indexed_skill_id, repository_id, run_external_id, dataset_asset_id, comparison_commit_sha,
            status, executed_at, indexed_at, scorecard, source
          ) values (
            ${indexedSkillId}, ${input.repositoryId}, ${runExternalId}, ${assetIds.dataset ?? null}, ${input.commitSha},
            'failed', ${input.now}, ${input.now}, ${tx.json({ error: evaluation.status === "invalid" ? evaluation.reason : "" } as never)}, 'import'
          )
        `;
      }
    }
  });

  return summary;
}
