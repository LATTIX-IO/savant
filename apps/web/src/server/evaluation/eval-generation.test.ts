import assert from "node:assert/strict";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import type { ChatClient, JevAnswer, JudgeClient } from "../ai/clients.ts";
import { extractJson, stripReasoning } from "../ai/clients.ts";
import { evaluateSkillPackage } from "./scorecard.ts";
import { generateEvaluationSet, parseDraftCases } from "./eval-generation.ts";

const SKILL = {
  skillId: "tier1.ai-output-safety-and-escalation",
  displayName: "AI Output Safety",
  root: "tier1/standards/ai-output-safety-and-escalation",
  instructions: "# AI Output Safety\n\nLabel uncertainty, escalate high-risk outputs to a human reviewer, and abstain when evidence is missing.",
  version: "1.0.0",
};

const TOPICS = ["quarterly revenue", "hiring pipeline", "security incident", "pricing change", "customer churn", "service latency", "vendor contract", "inventory shortage", "marketing budget", "compliance audit", "cloud spend", "support backlog", "release schedule", "fraud alert", "tax filing"];

function fakeGenerator(rounds: string[][]): ChatClient & { prompts: string[] } {
  const prompts: string[] = [];
  let call = 0;
  return {
    model: "nvidia/test-generator",
    prompts,
    async complete(messages) {
      prompts.push(messages.at(-1)?.content ?? "");
      const kinds = rounds[call++] ?? [];
      const cases = kinds.map((kind, index) => ({
        kind,
        prompt: kind === "offtopic" ? "Write a haiku about autumn leaves falling" : `Review this ${kind} AI draft about ${TOPICS[(call * 7 + index) % TOPICS.length]} forecasting with incomplete evidence`,
        context: "Draft: revenue will grow 40% next quarter.",
        expected_behavior: `Handles the ${kind} case as the safety standard requires`,
      }));
      return { content: `<think>planning</think>\n\`\`\`json\n${JSON.stringify({ cases: cases.map((item) => ({ ...item, kind: item.kind === "offtopic" ? "positive" : item.kind })) })}\n\`\`\``, model: "nvidia/test-generator", latencyMs: 5, usage: { promptTokens: 100, completionTokens: 200 }, finishReason: "stop", reasoningChars: 0 };
    },
  };
}

const executor: ChatClient = {
  model: "nvidia/test-executor",
  async complete() {
    return { content: "Uncertainty: high. Escalating to a human reviewer.", model: "nvidia/test-executor", latencyMs: 800, usage: { promptTokens: 300, completionTokens: 60 }, finishReason: "stop", reasoningChars: 0 };
  },
};

const noul = (value: number): JevAnswer => ({ type: "noul", noul: value });
const score = (value: number): JevAnswer => ({ type: "score", score: value, confidence: 0.8, probabilities: {} });
const choice = (value: string, probabilities: Record<string, number> = { [value]: 0.9 }): JevAnswer => ({ type: "choice", choice: value, confidence: 0.8, probabilities });

const judge: JudgeClient & { calls: number } = {
  model: "jev-test",
  calls: 0,
  async ask(state, questions) {
    judge.calls += 1;
    const record = state as { case: { kind: string; prompt: string } };
    const offTopic = record.case.prompt.includes("haiku");
    const answers: Record<string, JevAnswer> = {};
    if ("in_scope" in questions) {
      answers.in_scope = noul(offTopic ? 0.05 : 0.95);
      answers.behavior = choice(offTopic ? "none" : record.case.kind);
      answers.grounded = noul(0.9);
      answers.clear = noul(0.9);
      answers.discriminating = score(2.6);
    } else {
      const weak = record.case.kind === "negative";
      answers.quality = score(weak ? 1.5 : 3.8);
      answers.format_compliance = score(weak ? 2 : 4);
      answers.policy_compliance = noul(weak ? 0.2 : 0.95);
      answers.grounding_relevant = noul(0.9);
      answers.grounding_score = score(weak ? 2 : 3.7);
      answers.actionability = score(weak ? 1.5 : 3.6);
      answers.expected_met = noul(weak ? 0.2 : 0.9);
      answers.revisions = choice(weak ? "3" : "0");
    }
    return { model: "jev-test", answers, usage: { inputTokens: 50, outputTokens: 10 }, latencyMs: 3 };
  },
};

test("the LLM↔Jev loop rejects off-topic drafts, re-drafts with feedback, and produces a scored dataset in the repository's format", async () => {
  const generator = fakeGenerator([
    ["positive", "edge", "edge", "offtopic", "negative", "escalation"],
    ["positive"],
  ]);
  const result = await generateEvaluationSet({ generator, executor, judge }, { skill: SKILL, now: () => new Date("2026-09-30T12:00:00.000Z") });

  assert.equal(result.metrics.accepted, 6);
  assert.equal(result.metrics.rejected, 1);
  assert.equal(result.rounds, 2);
  assert.match(generator.prompts[1] ?? "", /rejected: not in the skill's scope/);
  assert.equal(result.samples.find((sample) => sample.kind === "negative")?.verdict, "fail");
  assert.equal(result.samples.find((sample) => sample.kind === "positive")?.verdict, "pass");
  assert.equal(result.status, "complete");

  // The generated files round-trip through the import-time scorer.
  const files = Object.fromEntries(result.files.map((file) => [file.path, file.content]));
  const evaluation = evaluateSkillPackage(SKILL.root, files);
  assert.equal(evaluation.status, "scored");
  assert.equal(evaluation.status === "scored" ? evaluation.baselineDelta : NaN, 0);
  const dataset = parseYaml(files[`${SKILL.root}/eval/dataset.yaml`] as string) as { generated_by: { judge: string } };
  assert.equal(dataset.generated_by.judge, "jev-test");
});

test("alignment compares the generated scorecard with a committed answer key", async () => {
  const generator = fakeGenerator([["positive", "positive", "edge", "edge", "negative", "escalation"]]);
  const result = await generateEvaluationSet({ generator, executor, judge }, {
    skill: SKILL,
    answerKey: {
      scorecard: { overallScore: 75.42, qualityScore: 77.33, complianceScore: 74.33, groundingScore: 76.33, actionabilityScore: 72.67, efficiencyScore: 75.87 } as never,
      samples: [{ caseId: "positive-1", prompt: "Review an AI-assisted revenue forecasting draft with incomplete evidence", verdict: "pass" }],
    },
  });
  assert.ok(result.alignment);
  assert.equal(result.alignment?.committedOverall, 75.42);
  assert.equal(result.alignment?.coverage, 1);
});

test("draft parsing tolerates reasoning traces, fences and invalid entries", () => {
  assert.equal(stripReasoning("<think>x</think> hi"), "hi");
  assert.deepEqual(extractJson('Sure: {"a": "}"} trailing'), { a: "}" });
  const drafts = parseDraftCases('{"cases":[{"kind":"edge","prompt":"A long enough prompt here","expected_behavior":"does the thing"},{"kind":"bogus","prompt":"x","expected_behavior":"y"}]}', 1, new Set());
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.context, null);
});
