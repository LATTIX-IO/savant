import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseApprovalVisuals,
  buildReleaseStageVisuals,
  findReleaseBundleSignal,
  normalizeReleaseProgress,
  summarizeReleaseReadiness,
} from "./release-flow.ts";

const SAMPLE_RELEASE = {
  id: "rel_123",
  skill: "legal.contract-review-assistant",
  candidateRef: "v1.9.0-rc.2",
  candidateCommit: "9ab3c1d",
  fromEnv: "staging",
  toEnv: "production",
  requested: "Ari Chen",
  when: "18m ago",
  approvalsDone: 1,
  approvalsRequired: 2,
  approvalsBlocked: null,
  readinessPct: 78,
  readiness: [
    { label: "Bundle signed & built", ok: true, meta: "Build 884 passed" },
    { label: "Reviewer approval", ok: true, meta: "Ari Chen signed off" },
    { label: "Security review", ok: null, meta: "Awaiting queue" },
  ],
  targets: ["prod-us-east", "prod-eu-west"],
} as const;

test("normalizeReleaseProgress accepts both percentage and fraction inputs", () => {
  assert.equal(normalizeReleaseProgress(78), 0.78);
  assert.equal(normalizeReleaseProgress(0.78), 0.78);
  assert.equal(normalizeReleaseProgress(140), 1);
});

test("summarizeReleaseReadiness classifies passing, pending, and blocked checks", () => {
  const summary = summarizeReleaseReadiness(SAMPLE_RELEASE.readiness, SAMPLE_RELEASE.readinessPct);

  assert.equal(summary.completion, 0.78);
  assert.equal(summary.passedCount, 2);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.blockedCount, 0);
  assert.equal(summary.total, 3);
});

test("buildReleaseStageVisuals maps source and target stages from live release data", () => {
  const visuals = buildReleaseStageVisuals(SAMPLE_RELEASE);

  assert.deepEqual(
    visuals.map((visual) => ({
      stage: visual.stage,
      state: visual.state,
      statusLabel: visual.statusLabel,
    })),
    [
      { stage: "draft", state: "completed", statusLabel: "Completed" },
      { stage: "staging", state: "current", statusLabel: "Current" },
      { stage: "production", state: "target", statusLabel: "Target" },
    ],
  );
  assert.match(visuals[2]!.meta, /78% release ready/i);
});

test("buildReleaseApprovalVisuals prefers explicit approval-style readiness checks", () => {
  const approvals = buildReleaseApprovalVisuals(SAMPLE_RELEASE);

  assert.deepEqual(approvals, [
    {
      label: "Reviewer approval",
      meta: "Ari Chen signed off",
      state: "passed",
    },
    {
      label: "Security review",
      meta: "Awaiting queue",
      state: "pending",
    },
  ]);
});

test("findReleaseBundleSignal returns the bundle/build readiness check when present", () => {
  assert.deepEqual(findReleaseBundleSignal(SAMPLE_RELEASE.readiness), {
    label: "Bundle signed & built",
    meta: "Build 884 passed",
    state: "passed",
  });
});
