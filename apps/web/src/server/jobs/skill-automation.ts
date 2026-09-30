import { readAiServiceConfig } from "../ai/clients.ts";
import { assertGitPermission, type GitActor } from "../git/access-control.ts";
import { GitProviderError } from "../git/errors.ts";
import type { StoredSafetyScan } from "../safety/findings.ts";
import { queueEvalGeneration } from "./enqueue.ts";
import { createEvalGenerationStore, createSafetyScanStore, type EvalGenerationRun } from "./stores.ts";

/** Skill-page view of background automation: evaluation generation runs and the latest safety scan. */
export type SkillAutomationPayload = {
  skillId: string;
  services: { nim: boolean; jev: boolean; generationModel: string | null; judgeModel: string | null };
  canGenerate: boolean;
  hasAnswerKey: boolean;
  runs: Array<Omit<EvalGenerationRun, "files"> & { fileCount: number }>;
  safety: StoredSafetyScan | null;
};

async function database() {
  const { getControlPlaneDatabase } = await import("../control-plane/database.ts");
  return getControlPlaneDatabase();
}

async function resolveSkill(organizationId: string, identifier: string) {
  const sql = await database();
  const [row] = await sql<{ repository_id: string; skill_id: string; source_path: string; has_answer_key: boolean }[]>`
    select indexed_skills.repository_id, indexed_skills.skill_id, indexed_skills.source_path,
      exists (
        select 1 from indexed_eval_results
        where indexed_eval_results.indexed_skill_id = indexed_skills.id and indexed_eval_results.source = 'import' and indexed_eval_results.overall_score is not null
      ) as has_answer_key
    from indexed_skills
    where indexed_skills.organization_id = ${organizationId} and (indexed_skills.skill_id = ${identifier} or indexed_skills.id::text = ${identifier})
    order by indexed_skills.last_indexed_at desc
    limit 1
  `;
  if (!row) {
    throw new GitProviderError("INVALID_REQUEST", "The skill was not found in this workspace.", { status: 404 });
  }
  return { sql, skill: row };
}

export async function getSkillAutomation(actor: GitActor, identifier: string): Promise<SkillAutomationPayload> {
  assertGitPermission(actor, "view");
  const { sql, skill } = await resolveSkill(actor.organizationId, identifier);
  const config = readAiServiceConfig();
  const [runs, safety] = await Promise.all([
    createEvalGenerationStore(sql).listForSkill(actor.organizationId, skill.skill_id, 5),
    createSafetyScanStore(sql).latestForSkill(actor.organizationId, skill.skill_id),
  ]);
  let canGenerate = true;
  try {
    assertGitPermission(actor, "connect_repository");
  } catch {
    canGenerate = false;
  }
  return {
    skillId: skill.skill_id,
    services: {
      nim: Boolean(config.nim),
      jev: Boolean(config.jev),
      generationModel: config.nim?.generationModel ?? null,
      judgeModel: config.jev?.model ?? null,
    },
    canGenerate: canGenerate && Boolean(config.nim && config.jev),
    hasAnswerKey: skill.has_answer_key,
    runs: runs.map(({ files, ...run }) => ({ ...run, fileCount: files.length })),
    safety,
  };
}

export async function startEvalGeneration(actor: GitActor, identifier: string): Promise<EvalGenerationRun> {
  assertGitPermission(actor, "connect_repository");
  const config = readAiServiceConfig();
  if (!config.nim || !config.jev) {
    throw new GitProviderError("PROVIDER_NOT_CONFIGURED", "Evaluation generation needs NVIDIA_NIM_API_KEY and JEV_API_KEY to be configured.", { status: 409 });
  }
  const { sql, skill } = await resolveSkill(actor.organizationId, identifier);
  return queueEvalGeneration(sql, {
    organizationId: actor.organizationId,
    repositoryId: skill.repository_id,
    skillId: skill.skill_id,
    sourcePath: skill.source_path,
    mode: skill.has_answer_key ? "alignment" : "generate",
    trigger: "manual",
    requestedBy: actor.subject,
  });
}
