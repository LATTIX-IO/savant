import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverviewKpis,
  deriveSkillTeamFromSourcePath,
  formatRelativeControlPlaneTime,
  mapRepositorySyncStatus,
} from "./read-model-db.ts";

test("formatRelativeControlPlaneTime returns compact human-friendly relative labels", () => {
  const now = new Date("2026-05-22T12:00:00.000Z");

  assert.equal(
    formatRelativeControlPlaneTime("2026-05-22T11:00:00.000Z", now),
    "1 hour ago",
  );
  assert.equal(
    formatRelativeControlPlaneTime("2026-05-22T11:59:45.000Z", now),
    "just now",
  );
  assert.equal(
    formatRelativeControlPlaneTime(null, now),
    "never",
  );
});

test("deriveSkillTeamFromSourcePath prefers manifest metadata and otherwise falls back to path segments", () => {
  assert.equal(
    deriveSkillTeamFromSourcePath(
      "tier2/methodology/legal/contract-review-assistant/SKILL.md",
      { team: "risk" },
    ),
    "risk",
  );

  assert.equal(
    deriveSkillTeamFromSourcePath(
      "tier2/methodology/legal/contract-review-assistant/SKILL.md",
      null,
    ),
    "legal",
  );

  assert.equal(
    deriveSkillTeamFromSourcePath(
      "tier3/workflow/research/triage-helper/SKILL.md",
      null,
    ),
    "research",
  );
});

test("mapRepositorySyncStatus normalizes repository and sync states into UI states", () => {
  assert.equal(mapRepositorySyncStatus("connected", "ok"), "ok");
  assert.equal(mapRepositorySyncStatus("warning", "ok"), "warn");
  assert.equal(mapRepositorySyncStatus("connected", "error"), "stale");
  assert.equal(mapRepositorySyncStatus("disabled", null), "stale");
});

test("buildOverviewKpis derives summary metrics from tenant-scoped counts", () => {
  const result = buildOverviewKpis({
    indexedSkills: 8,
    productionSkills: 3,
    skillsWithEvaluations: 6,
    completedReviews: 5,
    approvedReviews: 4,
    averageReleaseTurnaroundDays: 2.42,
    releasedCount: 2,
  });

  assert.deepEqual(result, [
    {
      key: "skills-in-production",
      label: "Skills in production",
      value: 3,
      deltaLabel: "8 indexed total",
      trend: "flat",
    },
    {
      key: "eval-coverage",
      label: "Eval coverage",
      value: 75,
      unit: "%",
      deltaLabel: "6 with evaluations",
      trend: "flat",
    },
    {
      key: "first-pass-acceptance",
      label: "First-pass acceptance",
      value: 80,
      unit: "%",
      deltaLabel: "5 completed reviews",
      trend: "flat",
    },
    {
      key: "release-turnaround",
      label: "Release turnaround",
      value: 2.4,
      unit: "d",
      deltaLabel: "2 completed releases",
      trend: "flat",
    },
  ]);
});
