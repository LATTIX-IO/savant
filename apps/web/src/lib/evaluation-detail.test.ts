import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvaluationArtifactBundle,
  buildCustomEvaluationRequestFromPreset,
  getEvaluationRunDetail,
  hasNewerPublishedVersion,
  simulateCustomEvaluationTest,
} from "./evaluation-detail.ts";

test("getEvaluationRunDetail returns benchmark metrics, history, and recommendations", () => {
  const detail = getEvaluationRunDetail("er_482");

  assert.ok(detail);
  assert.equal(detail.skill.id, "skl_ccr");
  assert.equal(detail.baselineRun?.id, "er_473");
  assert.equal(detail.uuid, "er_482");
  assert.equal(detail.readOnly, false);
  assert.deepEqual(detail.metrics.map((metric) => metric.id), [
    "quality",
    "compliance",
    "grounding",
    "actionability",
    "efficiency",
  ]);
  assert.deepEqual(detail.metricAlignment.map((metric) => metric.metricId), [
    "quality",
    "compliance",
    "grounding",
    "actionability",
    "efficiency",
  ]);
  assert.ok(detail.metricAlignment.every((metric) => metric.howToGrade.length >= 3));
  assert.ok(detail.metricAlignment.every((metric) => metric.improvementLevers.length >= 2));
  assert.ok(detail.failureClusters.length >= 3);
  assert.ok(detail.recommendations.length >= 3);
  assert.ok(detail.historicalRuns.some((run) => run.uuid === "er_472" && run.readOnly));
});

test("older published benchmark runs become read only after a newer publish", () => {
  const detail = getEvaluationRunDetail("er_472");

  assert.ok(detail);
  assert.equal(detail.readOnly, true);
  assert.equal(detail.publishedRef, "v2.3.7");
  assert.ok(detail.historicalRuns.some((run) => run.uuid === "er_473"));
});

test("buildCustomEvaluationRequestFromPreset enables a baseline-aware scoped test", () => {
  const detail = getEvaluationRunDetail("er_479");
  assert.ok(detail);

  const request = buildCustomEvaluationRequestFromPreset(detail.customTestPresets[0]!);

  assert.equal(request.focus, detail.customTestPresets[0]?.focus);
  assert.equal(request.datasetSlice, detail.customTestPresets[0]?.datasetSlice);
  assert.equal(request.caseCount, detail.customTestPresets[0]?.caseCount);
  assert.equal(request.includeEdgeCases, true);
  assert.equal(request.compareAgainstBaseline, true);
  assert.equal(request.notes, "");
});

test("buildEvaluationArtifactBundle maps a Test Bench eval into lattix-skills artifact formats", () => {
  const detail = getEvaluationRunDetail("er_482");
  assert.ok(detail);

  const request = buildCustomEvaluationRequestFromPreset(detail.customTestPresets[0]!);
  const metricAlignment = detail.metricAlignment.map((dimension) => dimension.metricId === "quality"
    ? { ...dimension, weight: 0.4 }
    : dimension);
  const artifactBundle = buildEvaluationArtifactBundle(detail, request, metricAlignment, {
    datasetFields: [
      { id: "dataset-verdict", key: "verdict", value: "investigate" },
    ],
    runnerSettings: [
      { id: "runner-batch-size", key: "batch_size", value: "8" },
    ],
  });

  assert.equal(artifactBundle.dataset.path, "eval/dataset.yaml");
  assert.equal(artifactBundle.dataset.evalSetVersion, "1.0.0");
  assert.equal(artifactBundle.dataset.sourceDataset, detail.run.dataset);
  assert.equal(artifactBundle.dataset.datasetSlice, request.datasetSlice);
  assert.equal(artifactBundle.dataset.sampleCount, request.caseCount);
  assert.deepEqual(
    artifactBundle.dataset.fields.map((field) => field.key),
    ["source_dataset", "dataset_slice", "sample_count", "include_edge_cases", "verdict"],
  );
  assert.equal(artifactBundle.rubric.path, "eval/rubric.yaml");
  assert.equal(artifactBundle.rubric.rubricVersion, "1.0.0");
  assert.equal(artifactBundle.rubric.thresholds.pass, 85);
  assert.equal(artifactBundle.rubric.thresholds.investigate, 70);
  assert.deepEqual(
    artifactBundle.rubric.runnerSettings.map((setting) => setting.key),
    ["judge_model", "compare_against_baseline", "batch_size"],
  );
  assert.equal(
    artifactBundle.rubric.dimensions.find((dimension) => dimension.metricId === "quality")?.weight,
    0.4,
  );
  assert.deepEqual(
    artifactBundle.rubric.dimensions.map((dimension) => dimension.metricId),
    ["quality", "compliance", "grounding", "actionability", "efficiency"],
  );
  assert.equal(artifactBundle.baseline.path, "eval/baseline.json");
  assert.equal(artifactBundle.baseline.compareAgainstBaseline, true);
  assert.equal(artifactBundle.baseline.baselineRef, detail.baselineRun?.ref ?? detail.publishedRef);
});

test("simulateCustomEvaluationTest is deterministic for a promising focused rerun", () => {
  const detail = getEvaluationRunDetail("er_482");
  assert.ok(detail);

  const request = {
    focus: "Retest indemnity prompt confidence with a prompt and dataset patch.",
    datasetSlice: "golden-review-slice",
    caseCount: 24,
    judgeModel: "balanced rubric judge",
    includeEdgeCases: false,
    compareAgainstBaseline: true,
    notes: "Keep the rerun focused on reviewer-visible evidence and confidence calibration.",
  };

  const first = simulateCustomEvaluationTest(detail, request);
  const second = simulateCustomEvaluationTest(detail, request);

  assert.deepEqual(first, second);
  assert.equal(first.status, "promising");
  assert.ok(first.passRate >= 98);
  assert.ok(first.delta > 0);
});

test("simulateCustomEvaluationTest surfaces iterate status on edge-heavy hard-mode reruns", () => {
  const detail = getEvaluationRunDetail("er_481");
  assert.ok(detail);

  const result = simulateCustomEvaluationTest(detail, {
    focus: "Stress retrieval latency and rollback ordering on edge cases.",
    datasetSlice: "hard-edge-regression-slice",
    caseCount: 180,
    judgeModel: "strict rubric judge",
    includeEdgeCases: true,
    compareAgainstBaseline: true,
    notes: "Use the slowest alert bundles and keep rollback expectations strict.",
  });

  assert.equal(result.status, "iterate");
  assert.ok(result.runtimeSeconds > 40);
  assert.ok(result.passRate < 96);
});

test("hasNewerPublishedVersion compares stable and prerelease refs semantically", () => {
  assert.equal(hasNewerPublishedVersion("v2.3.7", "v2.3.6"), true);
  assert.equal(hasNewerPublishedVersion("v2.3.7", "v2.3.7"), false);
  assert.equal(hasNewerPublishedVersion("v2.4.0", "v2.4.0-rc.2"), true);
  assert.equal(hasNewerPublishedVersion("v2.3.7", "v2.4.0-rc.2"), false);
});
