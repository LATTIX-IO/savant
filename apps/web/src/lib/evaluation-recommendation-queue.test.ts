import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecommendationDecisionStorageKey,
  buildSkillRecommendationQueueScope,
  buildSkillRecommendationQueueStorageKey,
  parseQueuedSkillRecommendations,
  parseRecommendationDecisions,
  syncQueuedSkillRecommendations,
} from "./evaluation-recommendation-queue.ts";

test("parseRecommendationDecisions keeps only recognized decision values", () => {
  const parsed = parseRecommendationDecisions(JSON.stringify({
    recA: "queue-next",
    recB: "hold",
    recC: "definitely-maybe",
  }));

  assert.deepEqual(parsed, {
    recA: "queue-next",
    recB: "hold",
  });
  assert.equal(buildRecommendationDecisionStorageKey("eval-123"), "savant:eval-recommendation-decisions:v1:eval-123");
});

test("syncQueuedSkillRecommendations mirrors queue-next decisions while preserving prior queue time", () => {
  const scope = buildSkillRecommendationQueueScope({
    id: "skl_contract_reviewer",
    name: "Contract Reviewer",
    team: "Legal Ops",
    repo: "acme/legal-skills",
    branch: "main",
  });

  const existing = [
    {
      queueId: "eval-001:rec-keep",
      recommendationId: "rec-keep",
      skillId: "skl_contract_reviewer",
      skillName: "Contract Reviewer",
      skillTeam: "Legal Ops",
      skillRepo: "acme/legal-skills",
      skillBranch: "main",
      evaluationUuid: "eval-001",
      evaluationRef: "eval-2026-05-20",
      evaluationDataset: "nda-edge-cases",
      evaluationStarted: "May 20, 9:00 AM",
      title: "Keep this queued",
      category: "dataset",
      effort: "low",
      impact: "Stays relevant.",
      rationale: "Still worth doing.",
      actions: ["Keep the regression slice pinned."],
      queuedAt: "2026-05-20T09:00:00.000Z",
    },
    {
      queueId: "eval-older:rec-other",
      recommendationId: "rec-other",
      skillId: "skl_contract_reviewer",
      skillName: "Contract Reviewer",
      skillTeam: "Legal Ops",
      skillRepo: "acme/legal-skills",
      skillBranch: "main",
      evaluationUuid: "eval-older",
      evaluationRef: "eval-2026-05-10",
      evaluationDataset: "renewal-language-reviewer-pass",
      evaluationStarted: "May 10, 11:00 AM",
      title: "Earlier queued recommendation",
      category: "guardrail",
      effort: "medium",
      impact: "Older but still queued.",
      rationale: "Keep until reviewed.",
      actions: ["Expose confidence scores in the output schema."],
      queuedAt: "2026-05-10T11:00:00.000Z",
    },
  ];

  const next = syncQueuedSkillRecommendations(existing, {
    skill: {
      id: "skl_contract_reviewer",
      name: "Contract Reviewer",
      team: "Legal Ops",
      repo: "acme/legal-skills",
      branch: "main",
    },
    evaluation: {
      uuid: "eval-001",
      ref: "eval-2026-05-20",
      dataset: "nda-edge-cases",
      started: "May 20, 9:00 AM",
    },
    recommendations: [
      {
        id: "rec-keep",
        category: "dataset",
        title: "Keep this queued",
        effort: "low",
        impact: "Stays relevant.",
        rationale: "Still worth doing.",
        actions: ["Keep the regression slice pinned."],
      },
      {
        id: "rec-new",
        category: "prompt",
        title: "Add a new prompt split",
        effort: "medium",
        impact: "Addresses the latest contract-family misses.",
        rationale: "Newly queued from the latest eval.",
        actions: ["Route NDAs and MSAs through specialized prompts."],
      },
      {
        id: "rec-drop",
        category: "rubric",
        title: "Do not keep this queued",
        effort: "high",
        impact: "Should disappear because it is not queue-next.",
        rationale: "No longer the best next action.",
        actions: ["Leave rubric weights unchanged for now."],
      },
    ],
    decisions: {
      "rec-keep": "queue-next",
      "rec-new": "queue-next",
      "rec-drop": "hold",
    },
  }, {
    now: () => "2026-05-21T10:30:00.000Z",
  });

  assert.equal(buildSkillRecommendationQueueStorageKey(scope), `savant:skill-recommendation-queue:v1:${scope}`);
  assert.equal(next.length, 3);
  assert.deepEqual(
    next.map((entry) => ({ recommendationId: entry.recommendationId, queuedAt: entry.queuedAt })),
    [
      { recommendationId: "rec-new", queuedAt: "2026-05-21T10:30:00.000Z" },
      { recommendationId: "rec-keep", queuedAt: "2026-05-20T09:00:00.000Z" },
      { recommendationId: "rec-other", queuedAt: "2026-05-10T11:00:00.000Z" },
    ],
  );
  assert.equal(next.some((entry) => entry.recommendationId === "rec-drop"), false);

  const reparsed = parseQueuedSkillRecommendations(JSON.stringify(next));
  assert.deepEqual(reparsed, next);
});
