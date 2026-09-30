import { createHash, randomUUID } from "node:crypto";

import type { SkillRuntime } from "@savant/types";

import { choiceOf, createJevClient, readAiServiceConfig, type JudgeClient } from "../ai/clients.ts";

type Sql = import("postgres").Sql;

/**
 * The Savant skill router: how ChatGPT, Claude, Copilot, Gemini, Cursor and
 * other MCP clients use a workspace's governed skills. The router chooses a
 * skill for a task (Jev picks among the workspace's skills), serves the
 * governed SKILL.md at its indexed commit, and records each use as a live run
 * in Skill Intelligence — the primary telemetry that evaluations fall back
 * from when no live data exists.
 */

export type RouterSkill = {
  skillId: string;
  name: string;
  summary: string | null;
  tier: string;
  channel: string | null;
  version: string;
  repositoryId: string;
  sourcePath: string;
  commitSha: string;
};

export type RouterPrincipal = { organizationId: string; connectorId: string | null };
export type RouterClient = { runtime: SkillRuntime; name: string | null; version: string | null };

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Maps MCP clientInfo.name (and hints) to a telemetry runtime. */
export function detectRuntime(clientName: string | null | undefined, hint?: string | null): SkillRuntime {
  const value = `${hint ?? ""} ${clientName ?? ""}`.toLowerCase();
  if (/chatgpt|openai-mcp|openai/.test(value)) return "chatgpt";
  if (/claude/.test(value)) return "claude";
  if (/gemini/.test(value)) return "gemini";
  if (/copilot|github/.test(value)) return "copilot";
  if (/cursor/.test(value)) return "cursor";
  if (/codex/.test(value)) return "codex";
  if (/visual studio code|vscode|vs code/.test(value)) return "vscode";
  return "other";
}

export async function listRouterSkills(sql: Sql, organizationId: string): Promise<RouterSkill[]> {
  const rows = await sql<Array<{ skill_id: string; display_name: string; tier: string; status: string | null; manifest: Record<string, unknown> | null; metadata_version: string | null; repository_id: string; source_path: string; source_commit_sha: string }>>`
    select distinct on (skill_id) skill_id, display_name, tier, status, manifest, metadata_version, repository_id, source_path, source_commit_sha
    from indexed_skills
    where organization_id = ${organizationId}
      and coalesce(status, '') not in ('deprecated', 'retired', 'archived')
    order by skill_id, last_indexed_at desc
  `;
  return rows.map((row) => ({
    skillId: row.skill_id,
    name: row.display_name,
    summary: text(row.manifest?.summary) ?? text(row.manifest?.description),
    tier: row.tier,
    channel: text(row.manifest?.channel),
    version: row.metadata_version ?? row.source_commit_sha.slice(0, 12),
    repositoryId: row.repository_id,
    sourcePath: row.source_path,
    commitSha: row.source_commit_sha,
  }));
}

const tokens = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2));

/** Cheap lexical prefilter so the judge sees a manageable candidate set. */
export function prefilter(skills: readonly RouterSkill[], task: string, limit = 40): RouterSkill[] {
  if (skills.length <= limit) return [...skills];
  const wanted = tokens(task);
  return skills
    .map((skill) => {
      const have = tokens(`${skill.name} ${skill.skillId} ${skill.summary ?? ""}`);
      let overlap = 0;
      for (const token of wanted) if (have.has(token)) overlap += 1;
      return { skill, overlap };
    })
    .sort((left, right) => right.overlap - left.overlap)
    .slice(0, limit)
    .map((entry) => entry.skill);
}

export type RouteResult = {
  skill: RouterSkill | null;
  confidence: number;
  method: "jev" | "lexical" | "none";
  alternatives: Array<{ skillId: string; name: string; probability: number }>;
};

/** Jev selects the skill that best fits the task (or none); lexical overlap is the fallback. */
export async function routeTask(skills: readonly RouterSkill[], task: string, judge: JudgeClient | null): Promise<RouteResult> {
  const candidates = prefilter(skills, task);
  if (candidates.length === 0) return { skill: null, confidence: 0, method: "none", alternatives: [] };
  if (judge) {
    const criteria: Record<string, string> = Object.fromEntries(candidates.map((skill, index) => [`s${index}`, `${skill.name}: ${(skill.summary ?? skill.skillId).slice(0, 280)}`]));
    criteria.none = "None of these skills fits the task";
    const result = await judge.ask({ task: task.slice(0, 4000) }, {
      skill: { type: "choice", instructions: "Which skill should an AI assistant load to carry out `task`? Pick the one whose purpose matches the task; choose none if no skill fits.", criteria },
    });
    const pick = choiceOf(result.answers.skill);
    const ranked = Object.entries(pick.probabilities)
      .filter(([key]) => key !== "none")
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([key, probability]) => ({ skill: candidates[Number(key.slice(1))], probability }))
      .filter((entry): entry is { skill: RouterSkill; probability: number } => Boolean(entry.skill));
    const chosen = pick.choice && pick.choice !== "none" ? candidates[Number(pick.choice.slice(1))] ?? null : null;
    return {
      skill: chosen,
      confidence: chosen ? pick.probabilities[pick.choice] ?? pick.confidence : pick.probabilities.none ?? 0,
      method: "jev",
      alternatives: ranked.map((entry) => ({ skillId: entry.skill.skillId, name: entry.skill.name, probability: Math.round(entry.probability * 100) / 100 })),
    };
  }
  const wanted = tokens(task);
  const scored = candidates.map((skill) => {
    const have = tokens(`${skill.name} ${skill.summary ?? ""}`);
    let overlap = 0;
    for (const token of wanted) if (have.has(token)) overlap += 1;
    return { skill, score: wanted.size > 0 ? overlap / wanted.size : 0 };
  }).sort((left, right) => right.score - left.score);
  const best = scored[0];
  return {
    skill: best && best.score > 0 ? best.skill : null,
    confidence: best?.score ?? 0,
    method: "lexical",
    alternatives: scored.slice(0, 3).map((entry) => ({ skillId: entry.skill.skillId, name: entry.skill.name, probability: Math.round(entry.score * 100) / 100 })),
  };
}

export function routerJudge(): JudgeClient | null {
  const config = readAiServiceConfig();
  return config.jev ? createJevClient(config.jev) : null;
}

export async function recordRouteDecision(sql: Sql, input: { principal: RouterPrincipal; client: RouterClient; task: string; route: RouteResult; runId?: string | null }): Promise<void> {
  await sql`
    insert into skill_route_decisions (organization_id, connector_id, runtime, client_name, task_fingerprint, candidates, chosen_skill_id, confidence, method, run_id)
    values (${input.principal.organizationId}, ${input.principal.connectorId}, ${input.client.runtime}, ${input.client.name},
      ${createHash("sha256").update(input.task.trim().toLowerCase()).digest("hex").slice(0, 32)},
      ${sql.json(input.route.alternatives as never)}, ${input.route.skill?.skillId ?? null}, ${input.route.confidence}, ${input.route.method}, ${input.runId ?? null})
  `;
}

/** The governed SKILL.md at the skill's indexed commit, read with the workspace's repository connection. */
export async function readGovernedSkill(organizationId: string, skill: RouterSkill): Promise<string> {
  const { getGitRuntime } = await import("../git/runtime.ts");
  const { openRepositoryFiles } = await import("../jobs/repository-files.ts");
  const runtime = await getGitRuntime();
  const repo = await openRepositoryFiles(runtime, organizationId, skill.repositoryId, skill.commitSha);
  const content = await repo.read(`${skill.sourcePath}/SKILL.md`);
  if (content === null) {
    throw new Error(`${skill.sourcePath}/SKILL.md is no longer in the repository.`);
  }
  return content;
}

export function newRunId(): string {
  return `router-${randomUUID()}`;
}
