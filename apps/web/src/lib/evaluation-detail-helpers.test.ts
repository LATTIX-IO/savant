import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomEvaluationRequestFromPreset,
  buildEvaluationArtifactBundle,
  simulateCustomEvaluationTest,
  type EvaluationRunDetail,
} from "./evaluation-detail-helpers.ts";

const SAMPLE_DETAIL: EvaluationRunDetail = {
  uuid: "11111111-1111-4111-8111-111111111111",
  run: {
    id: "11111111-1111-4111-8111-111111111111",
    ref: "v2.4.0-rc.2",
    dataset: "contract-corpus-v9",
    cases: 120,
    passed: 114,
    failed: 6,
    started: "1 hour ago",
    duration: "24s",
    delta: -1.2,
    status: "complete-with-regressions",
  },
  skill: {
    id: "skl_ccr",
    skillUuid: "22222222-2222-4222-8222-222222222222",
    name: "Contract Clause Reviewer",
    description: "Reviews contracts for non-standard clauses.",
    tier: 1,
    owner: "ari.chen",
    team: "Legal Ops",
    repo: "acme/legal-skills",
    repoProvider: "github",
    ref: "v2.3.7",
    commit: "abc1234",
    branch: "main",
    candidateRef: "v2.4.0-rc.2",
    candidateCommit: "def5678",
    versionCount: 9,
    prodEnv: "production",
    channel: "production",
    score: 94.2,
    trend: [92.1, 93.4, 94.2],
    accessGroup: "legal-readers",
    lastEval: "1 hour ago",
    status: "candidate-awaiting-approval",
    projection: {
      sourcePath: "tier2/methodology/legal/contract-review/SKILL.md",
      sourceCommitSha: "def5678",
      indexedAt: "2026-05-23T12:00:00.000Z",
    },
  },
  baselineRun: {
    id: "33333333-3333-4333-8333-333333333333",
    ref: "v2.3.7",
    dataset: "contract-corpus-v9",
    cases: 120,
    passed: 118,
    failed: 2,
    started: "6 days ago",
    duration: "23s",
    delta: 0.4,
    status: "complete",
  },
  release: null,
  executedBy: "control-plane index",
  executionEnvironment: "Indexed benchmark · eval/datasets/contracts.yaml",
  candidateModel: "Not indexed",
  judgeModel: "Not indexed · balanced rubric judge",
  focus: "contract clause regressions",
  readOnly: false,
  publishedRef: "v2.3.7",
  metrics: [
    {
      id: "pass-rate",
      label: "Pass rate",
      baseline: 98.3,
      candidate: 95,
      unit: "%",
      direction: "up",
      note: "Derived from indexed passed vs total case counts for this run.",
    },
    {
      id: "delta-index",
      label: "Baseline delta",
      baseline: 54,
      candidate: 38,
      unit: "pts",
      direction: "up",
      note: "Centered score built from the indexed score delta when comparison data is available.",
    },
  ],
  metricAlignment: [
    {
      metricId: "quality",
      metricLabel: "Quality",
      weight: 0.3,
      whatToMeasure: "Overall correctness on the indexed benchmark slice.",
      howToGrade: ["Reward correct, decision-ready answers.", "Penalize missing caveats."],
      improvementLevers: ["Tighten the prompt on the failing slice.", "Promote the failing cases into a stable regression pack."],
    },
    {
      metricId: "compliance",
      metricLabel: "Compliance",
      weight: 0.2,
      whatToMeasure: "Stays inside benchmark policy and format expectations.",
      howToGrade: ["Reward outputs that satisfy policy and formatting rules."],
      improvementLevers: ["Add a fail-closed guardrail when confidence drops."],
    },
    {
      metricId: "grounding",
      metricLabel: "Grounding",
      weight: 0.15,
      whatToMeasure: "Evidence-backed reasoning.",
      howToGrade: ["Prefer source-backed rationale."],
      improvementLevers: ["Strengthen reviewer-visible evidence linkage."],
    },
    {
      metricId: "actionability",
      metricLabel: "Actionability",
      weight: 0.2,
      whatToMeasure: "Whether a reviewer can act without extra interpretation.",
      howToGrade: ["Reward clear next steps and concise rationale."],
      improvementLevers: ["Translate common reviewer edits into output constraints."],
    },
    {
      metricId: "efficiency",
      metricLabel: "Efficiency",
      weight: 0.15,
      whatToMeasure: "How efficiently the skill reaches acceptable quality.",
      howToGrade: ["Reward stable pass rates with low failure concentration."],
      improvementLevers: ["Trim the next rerun to the smallest proving slice."],
    },
  ],
  failureClusters: [
    {
      id: "cluster-1",
      label: "Indexed failing cases",
      severity: "moderate",
      cases: 6,
      owner: "ari.chen",
      summary: "6 indexed cases did not pass for contract-corpus-v9.",
      suggestedUpdate: "Inspect the failing slice first.",
      examples: ["eval/datasets/contracts.yaml"],
    },
  ],
  recommendations: [
    {
      id: "rec-1",
      category: "dataset",
      title: "Promote the failing contract slice into a standing regression pack",
      effort: "low",
      impact: "Turns the current failures into a repeatable gate.",
      rationale: "The failures are concentrated enough to merit a focused rerun.",
      actions: ["Extract the failing cases.", "Pin them into a standing suite."],
    },
  ],
  customTestPresets: [
    {
      id: "focused-regression",
      label: "Focused rerun",
      focus: "Retest the current regression slice on a narrow benchmark.",
      datasetSlice: "focused-regression-slice",
      caseCount: 24,
      judgeModel: "balanced rubric judge",
      notes: "Prefer recent failing cases.",
    },
  ],
  reviewerNotes: [
    {
      who: "control-plane index",
      when: "1 hour ago",
      text: "Indexed run 11111111-1111-4111-8111-111111111111 is concentrating on contract clause regressions.",
    },
  ],
  historicalRuns: [],
};

test("buildEvaluationArtifactBundle maps a Test Bench draft into lattix-skills artifact formats", () => {
  const request = buildCustomEvaluationRequestFromPreset(SAMPLE_DETAIL.customTestPresets[0]!);
  const artifactBundle = buildEvaluationArtifactBundle(SAMPLE_DETAIL, request, SAMPLE_DETAIL.metricAlignment, {
    datasetFields: [{ id: "dataset-custom", key: "case_owner", value: "legal-ops" }],
    runnerSettings: [{ id: "runner-custom", key: "batch_size", value: "8" }],
  });

  assert.equal(artifactBundle.dataset.path, "eval/dataset.yaml");
  assert.equal(artifactBundle.dataset.sourceDataset, "contract-corpus-v9");
  assert.equal(artifactBundle.dataset.datasetSlice, "focused-regression-slice");
  assert.equal(artifactBundle.baseline.baselineRef, "v2.3.7");
  assert.equal(artifactBundle.rubric.dimensions.length, 5);
  assert.equal(
    artifactBundle.dataset.fields.some((entry) => entry.key === "case_owner" && entry.value === "legal-ops"),
    true,
  );
  assert.equal(
    artifactBundle.rubric.runnerSettings.some((entry) => entry.key === "batch_size" && entry.value === "8"),
    true,
  );
});

test("simulateCustomEvaluationTest remains deterministic for the same detail and request", () => {
  const request = buildCustomEvaluationRequestFromPreset(SAMPLE_DETAIL.customTestPresets[0]!);

  const first = simulateCustomEvaluationTest(SAMPLE_DETAIL, request);
  const second = simulateCustomEvaluationTest(SAMPLE_DETAIL, request);

  assert.deepEqual(first, second);
  assert.equal(first.status, "iterate");
  assert.equal(first.findings.length, 3);
});
