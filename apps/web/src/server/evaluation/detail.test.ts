import assert from "node:assert/strict";
import test from "node:test";

import { buildFlaggedCases, buildRubricBaseline } from "./detail.ts";

const scorecard = { overallScore: 75.42, qualityScore: 77.33, complianceScore: 74.33, groundingScore: 76.33, actionabilityScore: 72.67, efficiencyScore: 75.87, weights: { quality: 0.25, compliance: 0.35, grounding: 0.1, actionability: 0.1 } };
const cases = [
  { caseId: "positive-1", prompt: "p", verdict: "pass", quality: 94, compliance: 100, grounding: 96, actionability: 92 },
  { caseId: "edge-1", prompt: "e", verdict: "investigate", quality: 82, compliance: 92, grounding: 78, actionability: 76 },
  { caseId: "negative-1", prompt: "n", verdict: "fail", quality: 56, compliance: 31, grounding: 55, actionability: 50 },
];

test("first import is its own baseline; failing and investigate cases are flagged, worst first", () => {
  const latest = { scorecard, case_results: cases };
  const rubric = buildRubricBaseline(latest, undefined);
  assert.equal(rubric[0]?.label, "Overall");
  assert.equal(rubric[0]?.baseline, rubric[0]?.candidate);
  const flagged = buildFlaggedCases(latest, undefined);
  assert.deepEqual(flagged.map((item) => item.caseId), ["negative-1", "edge-1"]);
  assert.equal(flagged[0]?.rubric, "compliance");
  assert.equal(flagged[0]?.delta, 0);
});

test("later imports compare against the previous scorecard", () => {
  const previous = { scorecard, case_results: cases };
  const latest = { scorecard: { ...scorecard, overallScore: 70 }, case_results: cases.map((item) => (item.caseId === "edge-1" ? { ...item, quality: 60 } : item)) };
  assert.equal(buildRubricBaseline(latest, previous)[0]?.direction, "down");
  assert.ok((buildFlaggedCases(latest, previous).find((item) => item.caseId === "edge-1")?.delta ?? 0) < 0);
  assert.deepEqual(buildRubricBaseline({ scorecard: null }, undefined), []);
});
