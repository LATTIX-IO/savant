import type { SkillRuntime } from "@savant/types";

import {
  detectRuntime,
  listRouterSkills,
  newRunId,
  readGovernedSkill,
  recordRouteDecision,
  routeTask,
  routerJudge,
  type RouterClient,
  type RouterPrincipal,
  type RouterSkill,
} from "./router.ts";

type Sql = import("postgres").Sql;

/**
 * Savant skill router as a remote MCP server (Streamable HTTP, stateless).
 * JSON-RPC over POST: initialize, tools/list, tools/call, ping. The client's
 * identity (from `initialize.clientInfo`) rides in the Mcp-Session-Id header
 * so later calls attribute telemetry to the right runtime.
 */

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "savant-skill-router", title: "Savant skills", version: "1.0.0" };

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export type TelemetrySink = {
  startRun(input: { principal: RouterPrincipal; client: RouterClient; skill: RouterSkill; runId: string; task: string | null }): Promise<{ accepted: boolean; reason?: string | undefined }>;
  finishRun(input: { principal: RouterPrincipal; runId: string; outcome: "succeeded" | "failed" | "unknown"; accepted: boolean | null; rating: number | null; notes: string | null }): Promise<void>;
};

export type McpDeps = {
  sql: Sql;
  telemetry: TelemetrySink;
  readSkill?: (organizationId: string, skill: RouterSkill) => Promise<string>;
  listSkills?: (organizationId: string) => Promise<RouterSkill[]>;
};

export const TOOLS = [
  {
    name: "find_skill",
    title: "Find the right skill",
    description: "Find the workspace-governed skill that fits a task. Call this before starting substantive work, then load the returned skill with load_skill.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What the user wants done, in a sentence or two." },
      },
      required: ["task"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "load_skill",
    title: "Load a skill",
    description: "Load a governed skill's instructions (SKILL.md) and start a tracked run. Follow the instructions, then call report_skill_outcome with the returned run_id.",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: "The skill id from find_skill or list_skills." },
        task_summary: { type: "string", description: "Optional one-line summary of the task (stored redacted per workspace policy)." },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "report_skill_outcome",
    title: "Report how the skill did",
    description: "Report the outcome of a run started with load_skill, so the workspace can measure and improve the skill.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        outcome: { type: "string", enum: ["succeeded", "failed", "partial"], description: "Did the skill accomplish the task?" },
        accepted: { type: "boolean", description: "Did the user accept the result as-is?" },
        rating: { type: "integer", minimum: 1, maximum: 5, description: "Optional user rating." },
        notes: { type: "string", description: "Optional short note on what went wrong or well." },
      },
      required: ["run_id", "outcome"],
    },
  },
  {
    name: "list_skills",
    title: "List skills",
    description: "List the skills governed in this workspace.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Optional filter text." } } },
    annotations: { readOnlyHint: true },
  },
] as const;

export function encodeSession(client: RouterClient): string {
  return Buffer.from(JSON.stringify({ r: client.runtime, n: client.name, v: client.version })).toString("base64url");
}

export function decodeSession(value: string | null | undefined): RouterClient | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { r?: SkillRuntime; n?: string | null; v?: string | null };
    return parsed.r ? { runtime: parsed.r, name: parsed.n ?? null, version: parsed.v ?? null } : null;
  } catch {
    return null;
  }
}

const textResult = (text: string, structured?: unknown, isError = false) => ({
  content: [{ type: "text", text }],
  ...(structured === undefined ? {} : { structuredContent: structured }),
  ...(isError ? { isError: true } : {}),
});

async function callTool(deps: McpDeps, principal: RouterPrincipal, client: RouterClient, name: string, args: Record<string, unknown>) {
  const skills = await (deps.listSkills ?? ((org) => listRouterSkills(deps.sql, org)))(principal.organizationId);
  const read = deps.readSkill ?? readGovernedSkill;

  if (name === "list_skills") {
    const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
    const matches = skills.filter((skill) => !query || `${skill.name} ${skill.skillId} ${skill.summary ?? ""}`.toLowerCase().includes(query)).slice(0, 100);
    return textResult(matches.map((skill) => `- ${skill.skillId} — ${skill.name}${skill.summary ? `: ${skill.summary.slice(0, 160)}` : ""}`).join("\n") || "No skills match.", { skills: matches.map((skill) => ({ skill_id: skill.skillId, name: skill.name, summary: skill.summary, tier: skill.tier, version: skill.version })) });
  }

  if (name === "find_skill") {
    const task = typeof args.task === "string" ? args.task.trim() : "";
    if (!task) return textResult("Provide `task`: what the user wants done.", undefined, true);
    const route = await routeTask(skills, task, routerJudge()).catch(async () => routeTask(skills, task, null));
    await recordRouteDecision(deps.sql, { principal, client, task, route }).catch(() => undefined);
    if (!route.skill) {
      return textResult("No governed skill fits this task. Proceed without a skill.", { skill: null, confidence: route.confidence, method: route.method });
    }
    return textResult(
      `Best match: ${route.skill.skillId} (${route.skill.name}), confidence ${Math.round(route.confidence * 100)}%. Call load_skill with skill_id "${route.skill.skillId}".`,
      { skill_id: route.skill.skillId, name: route.skill.name, summary: route.skill.summary, confidence: route.confidence, method: route.method, alternatives: route.alternatives },
    );
  }

  if (name === "load_skill") {
    const skillId = typeof args.skill_id === "string" ? args.skill_id.trim() : "";
    const skill = skills.find((candidate) => candidate.skillId === skillId || candidate.name.toLowerCase() === skillId.toLowerCase());
    if (!skill) return textResult(`Skill "${skillId}" isn't governed in this workspace. Use find_skill or list_skills.`, undefined, true);
    const instructions = await read(principal.organizationId, skill);
    const runId = newRunId();
    const task = typeof args.task_summary === "string" ? args.task_summary.slice(0, 2000) : null;
    const started = await deps.telemetry.startRun({ principal, client, skill, runId, task }).catch((error: unknown) => ({ accepted: false, reason: error instanceof Error ? error.message : "telemetry unavailable" }));
    return textResult(
      [
        `# Skill: ${skill.name} (${skill.skillId} @ ${skill.version})`,
        `Run id: ${runId} — when you finish, call report_skill_outcome with this run_id.`,
        "",
        instructions,
      ].join("\n"),
      { skill_id: skill.skillId, version: skill.version, commit: skill.commitSha, run_id: runId, telemetry: started.accepted ? "recorded" : `not recorded${started.reason ? `: ${started.reason}` : ""}` },
    );
  }

  if (name === "report_skill_outcome") {
    const runId = typeof args.run_id === "string" ? args.run_id.trim() : "";
    const raw = typeof args.outcome === "string" ? args.outcome : "";
    if (!runId || !["succeeded", "failed", "partial"].includes(raw)) {
      return textResult("Provide run_id and outcome (succeeded, failed or partial).", undefined, true);
    }
    const rating = Number.isInteger(args.rating) && (args.rating as number) >= 1 && (args.rating as number) <= 5 ? args.rating as number : null;
    await deps.telemetry.finishRun({
      principal,
      runId,
      outcome: raw === "succeeded" ? "succeeded" : raw === "failed" ? "failed" : "unknown",
      accepted: typeof args.accepted === "boolean" ? args.accepted : null,
      rating,
      notes: typeof args.notes === "string" ? args.notes.slice(0, 2000) : null,
    });
    return textResult("Thanks — the outcome was recorded.", { run_id: runId, recorded: true });
  }

  return textResult(`Unknown tool "${name}".`, undefined, true);
}

/** Handles one JSON-RPC message; returns null for notifications. */
export async function handleMcpMessage(deps: McpDeps, principal: RouterPrincipal, session: RouterClient | null, message: JsonRpcRequest, hints: { runtime?: string | null } = {}): Promise<{ response: JsonRpcResponse | null; session?: string }> {
  const id = message.id ?? null;
  const method = message.method ?? "";
  if (message.id === undefined || method.startsWith("notifications/")) {
    return { response: null };
  }
  const reply = (result: unknown): { response: JsonRpcResponse } => ({ response: { jsonrpc: "2.0", id, result } });
  const fail = (code: number, text: string): { response: JsonRpcResponse } => ({ response: { jsonrpc: "2.0", id, error: { code, message: text } } });

  if (method === "initialize") {
    const params = message.params ?? {};
    const clientInfo = (params.clientInfo ?? {}) as { name?: string; version?: string };
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSIONS[0];
    const client: RouterClient = { runtime: detectRuntime(clientInfo.name, hints.runtime), name: clientInfo.name ?? null, version: clientInfo.version ?? null };
    return {
      response: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested as string) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "This workspace governs reusable skills. Before substantive work, call find_skill with the task; if it returns a skill, call load_skill and follow its instructions exactly, then call report_skill_outcome with the run_id when done.",
        },
      },
      session: encodeSession(client),
    };
  }
  const client = session ?? { runtime: detectRuntime(null, hints.runtime), name: null, version: null };
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
    try {
      return reply(await callTool(deps, principal, client, name, args));
    } catch (error) {
      return reply(textResult(`The router couldn't complete ${name}: ${error instanceof Error ? error.message : "unexpected error"}`, undefined, true));
    }
  }
  if (method === "resources/list") return reply({ resources: [] });
  if (method === "prompts/list") return reply({ prompts: [] });
  return fail(-32601, `Method not found: ${method}`);
}
