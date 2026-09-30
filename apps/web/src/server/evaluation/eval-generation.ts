import { stringify as stringifyYaml } from "yaml";

import {
  choiceOf,
  extractJson,
  noulOf,
  scoreOf,
  type ChatClient,
  type JevQuestion,
  type JudgeClient,
} from "../ai/clients.ts";
import { buildBaselineDocument, computeScorecard, type EvalSample, type Scorecard } from "./scorecard.ts";

/**
 * Generates an evaluation set for a skill that has none (or an unscored one),
 * by cycling a generative model and a System One judge:
 *
 *   1. The LLM drafts cases from SKILL.md — positive, edge, negative and
 *      escalation behaviours — each with the behaviour it expects.
 *   2. Jev validates every draft: in scope, the declared behaviour, grounded in
 *      what SKILL.md actually prescribes, discriminating, and unambiguous.
 *      Rejections go back to the LLM with the reasons; uncertain cases are held
 *      for human review. This repeats until coverage targets are met.
 *   3. The LLM executes the skill on each accepted case.
 *   4. Jev scores each output on the repository rubric's dimensions; code
 *      turns the scores into a verdict with the rubric's thresholds.
 *
 * The result is a dataset in the repository's scored-sample format plus a
 * scorecard (the same one the import evaluation computes), so a skill without
 * an answer key gets a provisional baseline. When the skill already has an
 * answer key, the same loop runs as an alignment check against it.
 */

export const CASE_KINDS = ["positive", "edge", "negative", "escalation"] as const;
export type CaseKind = typeof CASE_KINDS[number];

export type DraftCase = {
  caseId: string;
  kind: CaseKind;
  prompt: string;
  context: string | null;
  expectedBehavior: string;
};

export type CaseValidation = {
  inScope: number;
  grounded: number;
  clear: number;
  discriminating: number;
  behavior: string;
  behaviorConfidence: number;
  /** Set when Jev classified the case as a different behaviour than the LLM declared. */
  relabeledFrom?: CaseKind | undefined;
  decision: "accepted" | "rejected" | "needs_review";
  reasons: string[];
};

export type GeneratedCase = DraftCase & { round: number; validation: CaseValidation };

export type GeneratedSample = EvalSample & {
  kind: CaseKind;
  context: string | null;
  expectedBehavior: string;
  expectedMet: number;
  output: string;
  judgeConfidence: number;
};

export type AnswerKey = {
  scorecard: Scorecard;
  samples: Array<{ caseId: string; prompt: string | null; verdict: string }>;
};

export type GenerationAlignment = {
  committedOverall: number;
  generatedOverall: number;
  overallDelta: number;
  dimensionDeltas: Record<"quality" | "compliance" | "grounding" | "actionability" | "efficiency", number>;
  committedCases: number;
  generatedCases: number;
  /** Committed cases a generated case covers (token overlap), 0-1. */
  coverage: number;
  verdictMix: { committed: Record<string, number>; generated: Record<string, number> };
  /** Committed case id to the generated case Jev matched to it (null: not covered). */
  matches?: Record<string, string | null>;
};

export type GenerationMetrics = {
  drafted: number;
  accepted: number;
  rejected: number;
  needsReview: number;
  /** Share of drafts Jev accepted — "without Jev" every draft would have shipped. */
  acceptanceRate: number;
  llmCalls: number;
  judgeCalls: number;
  llmTokens: number;
  judgeTokens: number;
  /** Draft responses that didn't parse (before the repair attempt). */
  draftFailures: number;
  durationMs: number;
};

export type GenerationProgress = { stage: "drafting" | "validating" | "executing" | "scoring"; round: number; cases: GeneratedCase[]; samples: GeneratedSample[] };

export type GenerationInput = {
  skill: { skillId: string; displayName: string; root: string; instructions: string; version?: string | null };
  rubric?: unknown;
  targets?: Partial<Record<CaseKind, number>>;
  maxRounds?: number;
  seedCases?: DraftCase[];
  answerKey?: AnswerKey | null;
  costPerMillionTokens?: number;
  concurrency?: number;
  now?: () => Date;
  onProgress?: (progress: GenerationProgress) => Promise<void> | void;
};

export type GenerationResult = {
  status: "complete" | "needs_review";
  rounds: number;
  cases: GeneratedCase[];
  samples: GeneratedSample[];
  scorecard: Scorecard;
  alignment: GenerationAlignment | null;
  files: Array<{ path: string; content: string }>;
  metrics: GenerationMetrics;
  models: { generator: string; executor: string; judge: string };
};

export class EvalGenerationError extends Error {
  readonly code = "EVAL_GENERATION_FAILED";
}

export const DEFAULT_TARGETS: Record<CaseKind, number> = { positive: 2, edge: 2, negative: 1, escalation: 1 };
export const DEFAULT_RUBRIC = {
  rubric_version: "1.0.0",
  dimensions: { quality: 0.3, compliance: 0.25, grounding: 0.15, actionability: 0.15, efficiency: 0.15 },
  thresholds: { pass: 85, investigate: 70 },
};

const MAX_INSTRUCTIONS = 24_000;
const round2 = (value: number) => Math.round(value * 100) / 100;

const tokens = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 3));
function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  }));
  return results;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "case";
}

// ── Drafting ────────────────────────────────────────────────────────────

const KIND_GUIDE: Record<CaseKind, string> = {
  positive: "a typical request the skill is designed for, with enough detail to produce a complete answer",
  edge: "a request inside the skill's scope with incomplete, ambiguous or conflicting information that tests judgment",
  negative: "a request that looks related but that the skill should decline, redirect or refuse to answer as asked",
  escalation: "a high-risk or policy-sensitive request where the skill must stop, label uncertainty, or escalate to a human",
};

export function buildDraftPrompt(input: {
  skill: GenerationInput["skill"];
  needed: Partial<Record<CaseKind, number>>;
  accepted: readonly DraftCase[];
  rejected: readonly GeneratedCase[];
}): string {
  const wanted = CASE_KINDS.filter((kind) => (input.needed[kind] ?? 0) > 0)
    .map((kind) => `- ${input.needed[kind]} × "${kind}": ${KIND_GUIDE[kind]}`)
    .join("\n");
  const avoid = input.accepted.map((item) => `- ${item.prompt.slice(0, 160)}`).join("\n");
  const feedback = input.rejected.slice(-8).map((item) => `- (${item.kind}) "${item.prompt.slice(0, 140)}" — rejected: ${item.validation.reasons.join("; ")}`).join("\n");

  return [
    `You are writing evaluation cases for the agent skill "${input.skill.displayName}". Read the skill's instructions and write test cases that check whether an assistant follows them.`,
    "",
    "<skill_instructions>",
    input.skill.instructions.slice(0, MAX_INSTRUCTIONS),
    "</skill_instructions>",
    "",
    "Write these cases:",
    wanted,
    "",
    "Rules:",
    "- Each case must be self-contained: include every fact the assistant needs in `prompt` or `context`. When the task is about a document, draft, message or data, put that material itself in `context` (several sentences or rows). Never refer to attachments, files or links that aren't included.",
    "- For \"negative\" cases, the request should look related to the skill but fall outside what it should do; `expected_behavior` says how the skill declines or redirects.",
    "- `expected_behavior` states what a correct response does, and must follow from the skill instructions — not general knowledge.",
    "- Cases must distinguish a response that follows the skill from one that ignores it.",
    "- Use realistic, specific details. Do not mention that this is a test.",
    avoid ? `\nDo not repeat these existing cases:\n${avoid}` : "",
    feedback ? `\nThese earlier drafts were rejected by the validator; avoid the same problems:\n${feedback}` : "",
    "",
    'Respond with JSON only: {"cases":[{"kind":"positive|edge|negative|escalation","prompt":"...","context":"... or null","expected_behavior":"..."}]}',
  ].join("\n");
}

export function parseDraftCases(content: string, round: number, taken: Set<string>): DraftCase[] {
  const parsed = extractJson(content) as { cases?: unknown } | unknown[];
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { cases?: unknown }).cases) ? (parsed as { cases: unknown[] }).cases : [];
  const drafts: DraftCase[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const kind = typeof item.kind === "string" ? item.kind.toLowerCase().trim() : "";
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    const expected = typeof item.expected_behavior === "string" ? item.expected_behavior.trim() : typeof item.expectedBehavior === "string" ? item.expectedBehavior.trim() : "";
    if (!(CASE_KINDS as readonly string[]).includes(kind) || prompt.length < 12 || expected.length < 8) continue;
    const context = typeof item.context === "string" && item.context.trim() && item.context.trim().toLowerCase() !== "null" ? item.context.trim() : null;
    let caseId = `${kind}-${slug(prompt)}`;
    for (let suffix = 2; taken.has(caseId); suffix += 1) caseId = `${kind}-${slug(prompt)}-${suffix}`;
    taken.add(caseId);
    drafts.push({ caseId, kind: kind as CaseKind, prompt: prompt.slice(0, 4000), context: context?.slice(0, 6000) ?? null, expectedBehavior: expected.slice(0, 2000) });
  }
  void round;
  return drafts;
}

// ── Validation (Jev) ────────────────────────────────────────────────────

export function validationQuestions(): Record<string, JevQuestion> {
  return {
    in_scope: {
      type: "noul",
      instructions: "Is `case.prompt` a request that the skill described in `skill.instructions` is meant to handle, decline, or escalate — i.e. does it exercise this skill rather than an unrelated task?",
      criteria: { true: "The case exercises this skill's documented behaviour", false: "The case is about something this skill does not cover" },
    },
    behavior: {
      type: "choice",
      instructions: "Which behaviour of the skill in `skill.instructions` does `case` test, judging from `case.prompt`, `case.context` and `case.expected_behavior`?",
      criteria: {
        positive: "A typical in-scope request the skill should fully handle",
        edge: "An in-scope request with missing, ambiguous or conflicting information that tests judgment",
        negative: "A request the skill should decline, redirect or not answer as asked",
        escalation: "A high-risk request where the skill must stop, label uncertainty, or hand off to a human",
        none: "It does not test any behaviour of this skill",
      },
    },
    grounded: {
      type: "noul",
      instructions: "Is `case.expected_behavior` consistent with `skill.instructions`: what the skill prescribes for this situation, or, for a request outside the skill's purpose, declining or redirecting it, rather than invented requirements?",
      criteria: { true: "The expected behaviour is what the skill instructions prescribe or clearly imply", false: "The expected behaviour contradicts the skill instructions or adds requirements they don't support" },
    },
    clear: {
      type: "noul",
      instructions: "Is `case` self-contained and unambiguous — does `case.prompt` together with `case.context` give an assistant everything needed to respond?",
      criteria: { true: "Self-contained and clear", false: "Missing essential facts or ambiguous about what is being asked" },
    },
    discriminating: {
      type: "score",
      instructions: "How well would `case` distinguish an assistant that follows `skill.instructions` from one that ignores them?",
      criteria: [
        "Any reasonable answer would pass; the case does not test the skill",
        "Weakly discriminating; most generic answers would pass",
        "A generic answer would likely miss part of the expected behaviour",
        "Only an answer that applies the skill's specific instructions would meet the expected behaviour",
      ],
    },
  };
}

export function decideValidation(kind: CaseKind, answers: Record<string, Parameters<typeof noulOf>[0]>): CaseValidation {
  const inScope = noulOf(answers.in_scope);
  const grounded = noulOf(answers.grounded);
  const clear = noulOf(answers.clear);
  const discriminating = scoreOf(answers.discriminating);
  const behavior = choiceOf(answers.behavior);
  const kindProbability = behavior.probabilities[kind] ?? (behavior.choice === kind ? behavior.confidence : 0);

  const reasons: string[] = [];
  const borderline: string[] = [];
  const check = (value: number, threshold: number, margin: number, reason: string) => {
    if (value < threshold - margin) reasons.push(reason);
    else if (value < threshold) borderline.push(reason);
  };
  // Negative cases are out-of-scope requests by design; the behaviour question covers them.
  if (kind !== "negative") check(inScope, 0.7, 0.2, "not in the skill's scope");
  // Declining out-of-scope requests is rarely spelled out in a skill, so negative cases get a lower bar.
  check(grounded, kind === "negative" ? 0.4 : 0.65, 0.2, "expected behaviour isn't supported by SKILL.md");
  check(clear, 0.6, 0.2, "not self-contained or ambiguous");
  check(discriminating, 1.5, 0.5, "doesn't discriminate between following and ignoring the skill");
  // A different valid behaviour relabels the case (Jev selects, the LLM doesn't get the final word).
  let relabeledFrom: CaseKind | undefined;
  if (behavior.choice === "none") reasons.push("doesn't test a behaviour of this skill");
  else if (behavior.choice !== kind && (CASE_KINDS as readonly string[]).includes(behavior.choice) && kindProbability < 0.25) relabeledFrom = kind;

  return {
    inScope: round2(inScope),
    grounded: round2(grounded),
    clear: round2(clear),
    discriminating: round2(discriminating),
    behavior: behavior.choice,
    behaviorConfidence: round2(behavior.confidence),
    ...(relabeledFrom ? { relabeledFrom } : {}),
    decision: reasons.length > 0 ? "rejected" : borderline.length > 0 ? "needs_review" : "accepted",
    reasons: reasons.length > 0 ? reasons : borderline,
  };
}

// ── Scoring (Jev) ───────────────────────────────────────────────────────

const LEVELS = (what: string) => [
  `Fails: ${what} is absent or wrong`,
  `Poor: ${what} is mostly missing or has serious errors`,
  `Partial: ${what} is partly done with notable gaps`,
  `Good: ${what} is done with minor gaps`,
  `Excellent: ${what} is fully and precisely done`,
];

export function scoringQuestions(): Record<string, JevQuestion> {
  return {
    quality: { type: "score", instructions: "How well does `output` accomplish `case.prompt` the way `skill.instructions` direct?", criteria: LEVELS("the task, as the skill directs,") },
    format_compliance: { type: "score", instructions: "Does `output` follow the structure, sections and output format that `skill.instructions` require?", criteria: LEVELS("the required output format") },
    policy_compliance: {
      type: "noul",
      instructions: "Does `output` respect every constraint, safety rule and escalation requirement in `skill.instructions` that applies to `case`?",
      criteria: { true: "All applicable constraints and escalation rules are respected", false: "At least one applicable constraint or escalation rule is violated" },
    },
    grounding_relevant: {
      type: "noul",
      instructions: "Do `case.prompt` or `case.context` provide specific facts or evidence that a correct answer must rely on?",
      criteria: { true: "The case supplies facts the answer must use", false: "The case is general; there is no specific evidence to ground on" },
    },
    grounding_score: { type: "score", instructions: "How well is `output` grounded in the facts given in `case.prompt` and `case.context`, without unsupported or invented claims?", criteria: LEVELS("grounding in the supplied facts") },
    actionability: { type: "score", instructions: "How actionable is `output` for the person who asked — clear next steps or a usable result?", criteria: LEVELS("actionable guidance") },
    expected_met: {
      type: "noul",
      instructions: "Does `output` exhibit `case.expected_behavior`?",
      criteria: { true: "The expected behaviour is present", false: "The expected behaviour is missing or contradicted" },
    },
    revisions: {
      type: "choice",
      instructions: "How much would a reviewer need to edit `output` before it could be used?",
      criteria: { "0": "Usable as-is", "1": "One small edit", "2": "Several edits", "3": "Major rework or a rewrite" },
    },
  };
}

function thresholds(rubric: unknown): { pass: number; investigate: number } {
  const value = (rubric as { thresholds?: { pass?: unknown; investigate?: unknown } } | null)?.thresholds;
  const pass = Number(value?.pass);
  const investigate = Number(value?.investigate);
  return { pass: Number.isFinite(pass) ? pass : DEFAULT_RUBRIC.thresholds.pass, investigate: Number.isFinite(investigate) ? investigate : DEFAULT_RUBRIC.thresholds.investigate };
}

function weights(rubric: unknown): Record<"quality" | "compliance" | "grounding" | "actionability", number> {
  const dims = ((rubric as { dimensions?: Record<string, unknown> } | null)?.dimensions ?? DEFAULT_RUBRIC.dimensions) as Record<string, unknown>;
  const pick = (key: string, fallback: number) => (Number.isFinite(Number(dims[key])) ? Math.max(0, Number(dims[key])) : fallback);
  return { quality: pick("quality", 0.3), compliance: pick("compliance", 0.25), grounding: pick("grounding", 0.15), actionability: pick("actionability", 0.15) };
}

export function verdictFor(sample: Omit<EvalSample, "verdict">, expectedMet: number, rubric: unknown): "pass" | "investigate" | "fail" {
  const w = weights(rubric);
  const parts: Array<[number, number]> = [
    [sample.quality, w.quality],
    [(sample.formatCompliance + (sample.policyCompliance ? 1 : 0)) / 2, w.compliance],
    [sample.groundingRelevant ? sample.groundingScore : 1, w.grounding],
    [sample.actionability, w.actionability],
  ];
  const total = parts.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  const composite = (parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / total) * 100;
  const { pass, investigate } = thresholds(rubric);
  if (!sample.policyCompliance || expectedMet < 0.35) return composite >= investigate ? "investigate" : "fail";
  if (composite >= pass && expectedMet >= 0.6) return "pass";
  return composite >= investigate ? "investigate" : "fail";
}

// ── Alignment with an answer key ────────────────────────────────────────

/**
 * For each committed case, Jev selects the generated case that tests the same
 * scenario (or none). Committed prompts are often abstract while generated
 * ones are concrete, so word overlap can't tell.
 */
export async function matchCommittedCases(
  judge: JudgeClient,
  committed: AnswerKey["samples"],
  generated: ReadonlyArray<Pick<DraftCase, "caseId" | "kind" | "prompt">>,
): Promise<{ matches: Record<string, string | null>; calls: number; tokens: number }> {
  const matches: Record<string, string | null> = {};
  let calls = 0;
  let tokensUsed = 0;
  if (generated.length === 0) {
    return { matches, calls, tokens: tokensUsed };
  }
  const criteria: Record<string, string> = Object.fromEntries(generated.slice(0, 250).map((item) => [item.caseId, `(${item.kind}) ${item.prompt.slice(0, 300)}`]));
  criteria.none = "None of these cases tests the same scenario or behaviour";
  await mapLimit(committed.filter((sample) => sample.prompt), 4, async (sample) => {
    const result = await judge.ask({ committed_case: sample.prompt }, {
      match: {
        type: "choice",
        instructions: "Which generated case tests the same scenario and behaviour as `committed_case` (the situation and what a correct response must do, even if the wording or specific details differ)?",
        criteria,
      },
    });
    calls += 1;
    tokensUsed += result.usage.inputTokens + result.usage.outputTokens;
    const pick = choiceOf(result.answers.match);
    matches[sample.caseId] = pick.choice && pick.choice !== "none" && (pick.probabilities[pick.choice] ?? pick.confidence) >= 0.4 ? pick.choice : null;
  });
  return { matches, calls, tokens: tokensUsed };
}

export function alignWithAnswerKey(key: AnswerKey, generated: Scorecard, samples: readonly GeneratedSample[], matches?: Record<string, string | null>): GenerationAlignment {
  const mix = (verdicts: string[]) => verdicts.reduce<Record<string, number>>((acc, verdict) => ({ ...acc, [verdict]: (acc[verdict] ?? 0) + 1 }), {});
  const withPrompts = key.samples.filter((sample) => sample.prompt).length;
  const covered = matches
    ? Object.values(matches).filter(Boolean).length
    : key.samples.filter((sample) => sample.prompt && samples.some((item) => similarity(sample.prompt as string, `${item.prompt ?? ""} ${item.context ?? ""}`) >= 0.2)).length;
  return {
    committedOverall: key.scorecard.overallScore,
    generatedOverall: generated.overallScore,
    overallDelta: round2(generated.overallScore - key.scorecard.overallScore),
    dimensionDeltas: {
      quality: round2(generated.qualityScore - key.scorecard.qualityScore),
      compliance: round2(generated.complianceScore - key.scorecard.complianceScore),
      grounding: round2(generated.groundingScore - key.scorecard.groundingScore),
      actionability: round2(generated.actionabilityScore - key.scorecard.actionabilityScore),
      efficiency: round2(generated.efficiencyScore - key.scorecard.efficiencyScore),
    },
    committedCases: key.samples.length,
    generatedCases: samples.length,
    coverage: withPrompts > 0 ? round2(covered / withPrompts) : 0,
    verdictMix: { committed: mix(key.samples.map((sample) => sample.verdict)), generated: mix(samples.map((sample) => sample.verdict)) },
    ...(matches ? { matches } : {}),
  };
}

// ── Files ───────────────────────────────────────────────────────────────

export function buildGeneratedFiles(input: {
  skill: GenerationInput["skill"];
  rubric: unknown;
  rubricExists: boolean;
  samples: readonly GeneratedSample[];
  scorecard: Scorecard;
  models: GenerationResult["models"];
  generatedAt: string;
}): Array<{ path: string; content: string }> {
  const dataset = {
    eval_set_version: "0.1.0",
    generated_by: {
      method: "savant-llm-jev-loop",
      generator: input.models.generator,
      executor: input.models.executor,
      judge: input.models.judge,
      generated_at: input.generatedAt,
      note: "Drafted by an LLM, validated and scored by Jev. Review before relying on it as an answer key.",
    },
    samples: input.samples.map((sample) => ({
      case_id: sample.caseId,
      kind: sample.kind,
      prompt: sample.prompt,
      ...(sample.context ? { context: sample.context } : {}),
      expected_behavior: sample.expectedBehavior,
      quality: sample.quality,
      format_compliance: sample.formatCompliance,
      grounding_relevant: sample.groundingRelevant,
      grounding_score: sample.groundingScore,
      actionability: sample.actionability,
      policy_compliance: sample.policyCompliance,
      latency_ms: sample.latencyMs,
      estimated_cost_usd: sample.estimatedCostUsd,
      human_revision_count: sample.humanRevisionCount,
      verdict: sample.verdict,
      judge_confidence: sample.judgeConfidence,
    })),
  };
  const files = [{ path: `${input.skill.root}/eval/dataset.yaml`, content: stringifyYaml(dataset, { lineWidth: 100 }) }];
  if (!input.rubricExists) {
    files.push({ path: `${input.skill.root}/eval/rubric.yaml`, content: stringifyYaml(input.rubric) });
  }
  files.push({
    path: `${input.skill.root}/eval/baseline.json`,
    content: buildBaselineDocument({
      skillId: input.skill.skillId,
      skillVersion: input.skill.version ?? null,
      evalSetVersion: "0.1.0",
      rubricVersion: String((input.rubric as { rubric_version?: unknown })?.rubric_version ?? "1.0.0"),
      runId: `savant-gen-${input.generatedAt.replace(/\D/g, "").slice(0, 14)}`,
      timestamp: input.generatedAt.replace(/\.\d{3}Z$/, "Z"),
      scorecard: input.scorecard,
    }),
  });
  return files;
}

// ── The loop ────────────────────────────────────────────────────────────

export async function generateEvaluationSet(
  clients: { generator: ChatClient; executor: ChatClient; judge: JudgeClient },
  input: GenerationInput,
): Promise<GenerationResult> {
  const started = Date.now();
  const now = input.now ?? (() => new Date());
  const rubric = input.rubric ?? DEFAULT_RUBRIC;
  const targets = { ...DEFAULT_TARGETS, ...input.targets };
  const maxRounds = input.maxRounds ?? 3;
  const concurrency = input.concurrency ?? 4;
  const costPerToken = (input.costPerMillionTokens ?? 0.5) / 1_000_000;
  const skillState = { name: input.skill.displayName, instructions: input.skill.instructions.slice(0, MAX_INSTRUCTIONS) };
  const metrics = { llmCalls: 0, judgeCalls: 0, llmTokens: 0, judgeTokens: 0, draftFailures: 0 };
  const cases: GeneratedCase[] = [];
  const taken = new Set<string>();
  const report = async (progress: Omit<GenerationProgress, "cases">) => {
    await input.onProgress?.({ ...progress, cases });
  };

  const validate = async (drafts: DraftCase[], round: number) => {
    const validated = await mapLimit(drafts, concurrency, async (draft) => {
      const duplicate = cases.find((item) => item.validation.decision !== "rejected" && similarity(item.prompt, draft.prompt) >= 0.8);
      if (duplicate) {
        return { ...draft, round, validation: { inScope: 0, grounded: 0, clear: 0, discriminating: 0, behavior: "", behaviorConfidence: 0, decision: "rejected" as const, reasons: [`duplicates ${duplicate.caseId}`] } };
      }
      const result = await clients.judge.ask(
        { skill: skillState, case: { kind: draft.kind, prompt: draft.prompt, context: draft.context, expected_behavior: draft.expectedBehavior } },
        validationQuestions(),
      );
      metrics.judgeCalls += 1;
      metrics.judgeTokens += result.usage.inputTokens + result.usage.outputTokens;
      const validation = decideValidation(draft.kind, result.answers);
      return { ...draft, kind: validation.relabeledFrom ? validation.behavior as CaseKind : draft.kind, round, validation };
    });
    cases.push(...validated);
  };

  let round = 0;
  if (input.seedCases && input.seedCases.length > 0) {
    round = 1;
    input.seedCases.forEach((seed) => taken.add(seed.caseId));
    await report({ stage: "validating", round, samples: [] });
    await validate(input.seedCases, round);
  }

  const acceptedOf = (kind: CaseKind) => cases.filter((item) => item.kind === kind && item.validation.decision === "accepted").length;
  while (round < maxRounds) {
    const needed = Object.fromEntries(CASE_KINDS.map((kind) => [kind, Math.max(0, targets[kind] - acceptedOf(kind))])) as Record<CaseKind, number>;
    if (CASE_KINDS.every((kind) => needed[kind] === 0)) break;
    round += 1;
    // Over-draft a little: some drafts will be rejected.
    const ask = Object.fromEntries(CASE_KINDS.map((kind) => [kind, needed[kind] > 0 ? needed[kind] + 1 : 0])) as Record<CaseKind, number>;
    await report({ stage: "drafting", round, samples: [] });
    const completion = await clients.generator.complete([
      { role: "system", content: "You write rigorous evaluation cases for AI agent skills. You always answer with valid JSON only." },
      { role: "user", content: buildDraftPrompt({ skill: input.skill, needed: ask, accepted: cases.filter((item) => item.validation.decision !== "rejected"), rejected: cases.filter((item) => item.validation.decision === "rejected") }) },
    ], { maxTokens: 4000, temperature: 0.7 });
    metrics.llmCalls += 1;
    metrics.llmTokens += completion.usage.promptTokens + completion.usage.completionTokens;
    let drafts: DraftCase[] = [];
    try {
      drafts = parseDraftCases(completion.content, round, taken);
    } catch {
      drafts = [];
    }
    if (drafts.length === 0) {
      // One repair attempt: truncated or malformed JSON is the usual cause.
      metrics.draftFailures += 1;
      const repair = await clients.generator.complete([
        { role: "system", content: "You convert text into valid JSON. Answer with JSON only." },
        { role: "user", content: `Rewrite the following as valid JSON of the form {"cases":[{"kind":"...","prompt":"...","context":"... or null","expected_behavior":"..."}]}. Keep at most 8 cases.\n\n${completion.content.slice(0, 12_000)}` },
      ], { maxTokens: 4000, temperature: 0 }).catch(() => null);
      if (repair) {
        metrics.llmCalls += 1;
        metrics.llmTokens += repair.usage.promptTokens + repair.usage.completionTokens;
        try {
          drafts = parseDraftCases(repair.content, round, taken);
        } catch {
          drafts = [];
        }
      }
    }
    if (drafts.length === 0) continue;
    await report({ stage: "validating", round, samples: [] });
    await validate(drafts, round);
  }

  const accepted = cases.filter((item) => item.validation.decision === "accepted");
  if (accepted.length === 0) {
    throw new EvalGenerationError(`No drafted case passed validation after ${round} round${round === 1 ? "" : "s"}. ${cases.length} drafts were ${cases.some((item) => item.validation.decision === "needs_review") ? "rejected or held for review" : "rejected"}.`);
  }

  // Execute the skill on each accepted case, then score the outputs.
  await report({ stage: "executing", round, samples: [] });
  const samples: GeneratedSample[] = [];
  await mapLimit(accepted, concurrency, async (item) => {
    const execution = await clients.executor.complete([
      { role: "system", content: `You are an AI assistant operating under the following skill. Follow its instructions exactly.\n\n<skill name="${input.skill.displayName}">\n${skillState.instructions}\n</skill>` },
      { role: "user", content: item.context ? `${item.prompt}\n\nContext:\n${item.context}` : item.prompt },
    ], { maxTokens: 1500, temperature: 0.2 });
    metrics.llmCalls += 1;
    const executionTokens = execution.usage.promptTokens + execution.usage.completionTokens;
    metrics.llmTokens += executionTokens;

    const judged = await clients.judge.ask(
      { skill: skillState, case: { kind: item.kind, prompt: item.prompt, context: item.context, expected_behavior: item.expectedBehavior }, output: execution.content.slice(0, 12_000) },
      scoringQuestions(),
    );
    metrics.judgeCalls += 1;
    metrics.judgeTokens += judged.usage.inputTokens + judged.usage.outputTokens;

    const a = judged.answers;
    const level = (id: string) => round2(scoreOf(a[id]) / 4);
    const revisions = choiceOf(a.revisions);
    const base: Omit<EvalSample, "verdict"> = {
      caseId: item.caseId,
      prompt: item.prompt,
      quality: level("quality"),
      formatCompliance: level("format_compliance"),
      policyCompliance: noulOf(a.policy_compliance) >= 0.5,
      groundingRelevant: noulOf(a.grounding_relevant) >= 0.5,
      groundingScore: level("grounding_score"),
      actionability: level("actionability"),
      latencyMs: execution.latencyMs,
      estimatedCostUsd: Math.round(executionTokens * costPerToken * 10_000) / 10_000,
      humanRevisionCount: Number(revisions.choice) || 0,
    };
    const expectedMet = noulOf(a.expected_met);
    const confidences = Object.values(a).map((answer) => (answer.type === "noul" ? Math.abs(answer.noul - 0.5) * 2 : answer.confidence));
    samples.push({
      ...base,
      verdict: verdictFor(base, expectedMet, rubric),
      kind: item.kind,
      context: item.context,
      expectedBehavior: item.expectedBehavior,
      expectedMet: round2(expectedMet),
      output: execution.content.slice(0, 12_000),
      judgeConfidence: round2(confidences.reduce((sum, value) => sum + value, 0) / Math.max(confidences.length, 1)),
    });
    await report({ stage: "scoring", round, samples });
  });

  samples.sort((left, right) => CASE_KINDS.indexOf(left.kind) - CASE_KINDS.indexOf(right.kind) || left.caseId.localeCompare(right.caseId));
  const scorecard = computeScorecard(samples, rubric);
  let alignmentMatches: Record<string, string | null> | undefined;
  if (input.answerKey) {
    // Match against every non-rejected draft: coverage is about the scenarios the loop found.
    const matched = await matchCommittedCases(clients.judge, input.answerKey.samples, cases.filter((item) => item.validation.decision !== "rejected"));
    metrics.judgeCalls += matched.calls;
    metrics.judgeTokens += matched.tokens;
    alignmentMatches = matched.matches;
  }
  const models = { generator: clients.generator.model, executor: clients.executor.model, judge: clients.judge.model };
  const needsReview = cases.filter((item) => item.validation.decision === "needs_review").length;
  const files = buildGeneratedFiles({
    skill: input.skill,
    rubric,
    rubricExists: input.rubric !== undefined && input.rubric !== null,
    samples,
    scorecard,
    models,
    generatedAt: now().toISOString(),
  });

  return {
    status: needsReview > 0 || accepted.length < 3 ? "needs_review" : "complete",
    rounds: round,
    cases,
    samples,
    scorecard,
    alignment: input.answerKey ? alignWithAnswerKey(input.answerKey, scorecard, samples, alignmentMatches) : null,
    files,
    metrics: {
      drafted: cases.length,
      accepted: accepted.length,
      rejected: cases.filter((item) => item.validation.decision === "rejected").length,
      needsReview,
      acceptanceRate: round2(accepted.length / Math.max(cases.length, 1)),
      ...metrics,
      durationMs: Date.now() - started,
    },
    models,
  };
}
