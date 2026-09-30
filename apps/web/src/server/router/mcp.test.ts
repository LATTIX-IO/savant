import assert from "node:assert/strict";
import test from "node:test";

import type { JevAnswer, JudgeClient } from "../ai/clients.ts";
import { decodeSession, handleMcpMessage, type McpDeps } from "./mcp.ts";
import { detectRuntime, routeTask, type RouterSkill } from "./router.ts";

const SKILLS: RouterSkill[] = [
  { skillId: "tier1.ai-output-safety-and-escalation", name: "AI Output Safety", summary: "Decide whether AI drafts need labels, escalation or abstention.", tier: "tier1", channel: "production", version: "1.0.0", repositoryId: "r", sourcePath: "tier1/standards/ai-output-safety-and-escalation", commitSha: "abc" },
  { skillId: "docs/proposal-response", name: "Proposal Response", summary: "Write RFP and proposal responses.", tier: "tier2", channel: "production", version: "1.2.0", repositoryId: "r", sourcePath: "tier2/docs/proposal-response", commitSha: "abc" },
];

function deps(events: string[]): McpDeps {
  const sql = (async () => []) as unknown as McpDeps["sql"];
  return {
    sql,
    listSkills: async () => SKILLS,
    readSkill: async (_org, skill) => `# ${skill.name}\nFollow these steps.`,
    telemetry: {
      async startRun({ client, skill, runId, task }) {
        events.push(`start ${client.runtime} ${skill.skillId} ${runId.startsWith("router-")} ${task ?? ""}`);
        return { accepted: true };
      },
      async finishRun({ runId, outcome, accepted, rating }) {
        events.push(`finish ${runId} ${outcome} ${accepted} ${rating}`);
      },
    },
  };
}

const principal = { organizationId: "org", connectorId: null };

test("clients are attributed to their runtime", () => {
  assert.equal(detectRuntime("claude-ai"), "claude");
  assert.equal(detectRuntime("openai-mcp"), "chatgpt");
  assert.equal(detectRuntime("Visual Studio Code"), "vscode");
  assert.equal(detectRuntime("gemini-cli-mcp-client"), "gemini");
  assert.equal(detectRuntime(null, "copilot"), "copilot");
});

test("initialize → find → load → report records a live run attributed to the client", async () => {
  const events: string[] = [];
  const d = deps(events);
  const init = await handleMcpMessage(d, principal, null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1" } } });
  assert.equal((init.response?.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
  const session = decodeSession(init.session);
  assert.equal(session?.runtime, "claude");

  const tools = await handleMcpMessage(d, principal, session, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual((tools.response?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name), ["find_skill", "load_skill", "report_skill_outcome", "list_skills"]);

  const found = await handleMcpMessage(d, principal, session, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "find_skill", arguments: { task: "Write a proposal response for this RFP" } } });
  const foundResult = found.response?.result as { structuredContent: { skill_id: string } };
  assert.equal(foundResult.structuredContent.skill_id, "docs/proposal-response");

  const loaded = await handleMcpMessage(d, principal, session, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "load_skill", arguments: { skill_id: "docs/proposal-response", task_summary: "RFP for a hospital" } } });
  const loadedResult = loaded.response?.result as { content: Array<{ text: string }>; structuredContent: { run_id: string; telemetry: string } };
  assert.match(loadedResult.content[0]?.text ?? "", /# Proposal Response/);
  assert.equal(loadedResult.structuredContent.telemetry, "recorded");

  await handleMcpMessage(d, principal, session, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "report_skill_outcome", arguments: { run_id: loadedResult.structuredContent.run_id, outcome: "succeeded", accepted: true, rating: 5 } } });
  assert.equal(events[0], "start claude docs/proposal-response true RFP for a hospital");
  assert.match(events[1] ?? "", /^finish router-.* succeeded true 5$/);

  const notification = await handleMcpMessage(d, principal, session, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notification.response, null);
  const unknown = await handleMcpMessage(d, principal, session, { jsonrpc: "2.0", id: 9, method: "nope" });
  assert.equal(unknown.response?.error?.code, -32601);
});

test("Jev routing picks among candidates, or none", async () => {
  const judge: JudgeClient = {
    model: "jev-test",
    async ask() {
      const answer: JevAnswer = { type: "choice", choice: "s0", confidence: 0.9, probabilities: { s0: 0.9, s1: 0.05, none: 0.05 } };
      return { model: "jev-test", answers: { skill: answer }, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
    },
  };
  const route = await routeTask(SKILLS, "Should this AI draft be escalated?", judge);
  assert.equal(route.skill?.skillId, "tier1.ai-output-safety-and-escalation");
  assert.equal(route.method, "jev");
  assert.equal(route.confidence, 0.9);
});
