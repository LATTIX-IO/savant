import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuditEventRecord,
  buildConnectorDashboardMetrics,
  buildConnectorRecord,
  buildEvaluationDashboardMetrics,
  buildEvaluationRunListItem,
  buildPolicySummary,
  buildReleaseDashboardMetrics,
  buildReleaseHistoryItem,
  buildRepositoryProjectionMetadata,
  buildSkillProjectionMetadata,
  buildOverviewKpis,
  deriveSkillTeamFromSourcePath,
  formatRelativeControlPlaneTime,
  mapRepositorySyncStatus,
  resolveAuditRangeLowerBound,
  resolveIndexedEvalDatasetLabel,
  serializeControlPlaneTimestamp,
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

test("serializeControlPlaneTimestamp returns ISO strings for valid timestamps", () => {
  assert.equal(
    serializeControlPlaneTimestamp("2026-05-22T11:00:00.000Z"),
    "2026-05-22T11:00:00.000Z",
  );
  assert.equal(serializeControlPlaneTimestamp(null), null);
});

test("resolveAuditRangeLowerBound returns the expected lower bounds for audit filters", () => {
  const now = new Date("2026-05-22T12:00:00.000Z");

  assert.equal(
    resolveAuditRangeLowerBound("24h", now)?.toISOString(),
    "2026-05-21T12:00:00.000Z",
  );
  assert.equal(
    resolveAuditRangeLowerBound("7d", now)?.toISOString(),
    "2026-05-15T12:00:00.000Z",
  );
  assert.equal(resolveAuditRangeLowerBound("all", now), null);
});

test("buildAuditEventRecord formats relative timing and enriches known skill targets", () => {
  const result = buildAuditEventRecord(
    {
      actor_type: "user",
      actor_ref: "auth0|owner-123",
      category: "release",
      action: "Released",
      target_type: "skill",
      target_ref: "11111111-1111-4111-8111-111111111111",
      occurred_at: "2026-05-22T11:30:00.000Z",
    },
    { identity: null },
    {
      skillNames: new Map([["11111111-1111-4111-8111-111111111111", "Contract Clause Reviewer"]]),
    },
    new Date("2026-05-22T12:00:00.000Z"),
  );

  assert.deepEqual(result, {
    occurredAt: "2026-05-22T11:30:00.000Z",
    when: "30 minutes ago",
    time: "11:30",
    who: "auth0|owner-123",
    action: "Released",
    target: "Contract Clause Reviewer",
    category: "release",
    node: "moss",
  });
});

test("buildPolicySummary normalizes policy rows into live policy records", () => {
  const result = buildPolicySummary(
    {
      id: "11111111-1111-4111-8111-111111111111",
      policy_key: "prod-approvals",
      name: "Production releases require 2 approvers",
      policy_type: "approval",
      scope_type: "environment",
      scope_ref: "production",
      state: "active",
      rules: [
        { rule: "Owner approval", value: "Required" },
        { rule: "Reviewer approval", value: "Required from a non-owner team member" },
      ],
      updated_by_name: "platform-admins",
      updated_at: "2026-05-22T11:00:00.000Z",
      binding_count: 2,
    },
    [
      {
        occurredAt: "2026-05-22T11:30:00.000Z",
        when: "30 minutes ago",
        who: "platform-admins",
        action: "Updated",
        detail: "Policy definition",
        status: "info",
      },
    ],
    new Date("2026-05-22T12:00:00.000Z"),
  );

  assert.deepEqual(result, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Production releases require 2 approvers",
    type: "approval",
    scope: "Environment · production",
    state: "active",
    affects: 2,
    appliedBy: "platform-admins",
    updated: "1 hour ago",
    rules: [
      { rule: "Owner approval", value: "Required" },
      { rule: "Reviewer approval", value: "Required from a non-owner team member" },
    ],
    recentActivity: [
      {
        occurredAt: "2026-05-22T11:30:00.000Z",
        when: "30 minutes ago",
        who: "platform-admins",
        action: "Updated",
        detail: "Policy definition",
        status: "info",
      },
    ],
  });
});

test("buildReleaseHistoryItem normalizes release rows into timeline history records", () => {
  const result = buildReleaseHistoryItem(
    {
      skill_id: "legal/contract-review-assistant",
      source_ref: "v2.4.0-rc.2",
      to_environment: "production",
      status: "rolled_back",
      created_at: "2026-05-22T10:00:00.000Z",
      updated_at: "2026-05-22T11:00:00.000Z",
      requested_by: "ari.chen",
      actor_name: "jdv",
      final_event_at: "2026-05-22T11:30:00.000Z",
      release_ref: "v2.4.0",
    },
    new Map([["legal/contract-review-assistant", { name: "Contract Review Assistant" }]]),
    new Date("2026-05-22T12:00:00.000Z"),
  );

  assert.deepEqual(result, {
    ref: "v2.4.0",
    skill: "Contract Review Assistant",
    env: "production",
    who: "jdv",
    when: "30 minutes ago",
    outcome: "rolled-back",
  });
});

test("buildReleaseDashboardMetrics summarizes release KPIs from live release state", () => {
  const result = buildReleaseDashboardMetrics({
    activeCandidates: 3,
    blockedCandidates: 1,
    readyCandidates: 1,
    averageTurnaroundDaysLast30d: 2.4,
    averageTurnaroundDaysPrev30d: 3,
    releasedCountLast30d: 5,
    rollbackCountLast30d: 1,
    latestRollback: {
      skill: "Incident Triage",
      when: "9 days ago",
    },
    pinnedInProduction: 7,
    newPinsLast7d: 2,
  });

  assert.deepEqual(result, [
    {
      key: "active-candidates",
      label: "Active candidates",
      value: 3,
      trendLabel: "1 blocked by approvals",
      trend: "down",
    },
    {
      key: "release-turnaround",
      label: "Release turnaround",
      value: 2.4,
      unit: "d",
      displayDecimals: 1,
      trendLabel: "↓ 0.6d vs prior 30d",
      trend: "up",
    },
    {
      key: "rollbacks-30d",
      label: "Rollbacks · 30d",
      value: 1,
      trendLabel: "Incident Triage · 9 days ago",
      trend: "down",
    },
    {
      key: "pinned-in-production",
      label: "Pinned in production",
      value: 7,
      trendLabel: "+2 this week",
      trend: "up",
    },
  ]);
});


test("buildEvaluationRunListItem normalizes indexed evaluation rows into dashboard runs", () => {
  const result = buildEvaluationRunListItem({
    result_id: "11111111-1111-4111-8111-111111111111",
    skill_id: "legal/contract-review-assistant",
    skill_name: "Contract Review Assistant",
    skill_tier: "tier2",
    run_external_id: "eval_123",
    dataset_logical_name: "contract-corpus-v9",
    dataset_source_path: "eval/datasets/contracts.yaml",
    total_cases: 120,
    passed_cases: 114,
    failed_cases: 6,
    status: "failed",
    executed_at: "2026-05-22T11:30:00.000Z",
    indexed_at: "2026-05-22T11:35:00.000Z",
    score_delta: -3.4,
    comparison_commit_sha: "abcdef1234567890",
  });

  assert.deepEqual(result, {
    id: "11111111-1111-4111-8111-111111111111",
    skillId: "legal/contract-review-assistant",
    skill: "Contract Review Assistant",
    skillTier: 2,
    ref: "abcdef1",
    dataset: "contract-corpus-v9",
    cases: 120,
    passed: 114,
    failed: 6,
    started: formatRelativeControlPlaneTime("2026-05-22T11:30:00.000Z"),
    startedAt: "2026-05-22T11:30:00.000Z",
    duration: "—",
    passRate: 95,
    delta: -3.4,
    status: "failed",
  });
});

test("buildEvaluationDashboardMetrics summarizes live indexed evaluation metrics", () => {
  const result = buildEvaluationDashboardMetrics({
    totalSkills: 12,
    evaluatedSkills: 9,
    averageCasesPerRun: 184.2,
    totalRuns: 15,
    regressionsLast24h: 2,
    latestRegressionSkill: "Contract Review Assistant",
    medianPassRate: 94.6,
    runningRuns: 1,
    regressionRuns: 3,
  });

  assert.deepEqual(result, [
    {
      key: "coverage",
      label: "Coverage",
      value: 75,
      unit: "%",
      displayDecimals: 1,
      trendLabel: "9 of 12 skills",
      trend: "up",
    },
    {
      key: "avg-cases",
      label: "Avg cases per run",
      value: 184.2,
      trendLabel: "15 indexed runs",
      trend: "flat",
    },
    {
      key: "regressions-24h",
      label: "Regressions · 24h",
      value: 2,
      trendLabel: "Contract Review Assistant",
      trend: "down",
    },
    {
      key: "median-pass-rate",
      label: "Median pass rate",
      value: 94.6,
      unit: "%",
      displayDecimals: 1,
      trendLabel: "1 running · 3 with regressions",
      trend: "down",
    },
  ]);
});

test("buildConnectorRecord normalizes connector rows into dashboard records", () => {
  const result = buildConnectorRecord(
    {
      id: "connector-123",
      connector_key: "github-actions",
      category: "native",
      kind: "Native — push",
      status: "healthy",
      config: {
        displayName: "GitHub Actions",
        version: "1.4.2",
        skillCount: 18,
        userCount: 0,
        scopeLabel: "Tier 1 & Tier 2 production",
      },
      installed_by_name: "platform-admins",
      updated_at: "2026-05-22T11:00:00.000Z",
      enabled_target_count: 3,
      total_target_count: 3,
      enabled_targets: ["github-actions", "staging", "production"],
      latest_run_status: "succeeded",
      latest_run_started_at: "2026-05-22T11:45:00.000Z",
      latest_run_completed_at: "2026-05-22T11:50:00.000Z",
      sync_runs_24h: 12,
      successful_runs_24h: 11,
      failed_runs_24h: 1,
    },
    new Date("2026-05-22T12:00:00.000Z"),
  );

  assert.deepEqual(result, {
    id: "connector-123",
    name: "GitHub Actions",
    category: "native",
    kind: "Native — push",
    status: "healthy",
    lastSync: "10 minutes ago",
    version: "1.4.2",
    skills: 18,
    users: 0,
    scope: "Tier 1 & Tier 2 production",
  });
});

test("buildConnectorDashboardMetrics summarizes connector KPIs from live connector state", () => {
  const result = buildConnectorDashboardMetrics({
    activeConnectors: 8,
    totalConnectors: 10,
    enabledTargets: 14,
    localConnectors: 4,
    nativeConnectors: 2,
    notifyConnectors: 3,
    bundleConnectors: 1,
    syncRuns24h: 19,
    successfulRuns24h: 18,
    failedRuns24h: 1,
    issues: 2,
    degradedCount: 1,
    warningCount: 1,
    offlineCount: 0,
  });

  assert.deepEqual(result, [
    {
      key: "active-connectors",
      label: "Active connectors",
      value: 8,
      trendLabel: "10 total",
      trend: "down",
    },
    {
      key: "enabled-targets",
      label: "Enabled targets",
      value: 14,
      trendLabel: "4 local · 2 native · 3 notify · 1 bundle",
      trend: "up",
    },
    {
      key: "sync-runs-24h",
      label: "Sync runs · 24h",
      value: 19,
      trendLabel: "18 successful · 1 failed",
      trend: "down",
    },
    {
      key: "issues",
      label: "Issues",
      value: 2,
      trendLabel: "1 degraded · 1 warning",
      trend: "down",
    },
  ]);
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

test("buildRepositoryProjectionMetadata surfaces indexed and sync freshness timestamps", () => {
  assert.deepEqual(
    buildRepositoryProjectionMetadata({
      last_indexed_at: "2026-05-22T10:45:00.000Z",
      last_successful_sync_at: "2026-05-22T10:50:00.000Z",
      last_webhook_at: null,
    }),
    {
      indexedAt: "2026-05-22T10:45:00.000Z",
      lastSuccessfulSyncAt: "2026-05-22T10:50:00.000Z",
      lastWebhookAt: null,
    },
  );
});

test("buildSkillProjectionMetadata preserves Git provenance from indexed skills", () => {
  assert.deepEqual(
    buildSkillProjectionMetadata({
      source_path: "tier2/methodology/legal/contract-review-assistant/SKILL.md",
      source_commit_sha: "8a31cf2d5f9a",
      last_indexed_at: "2026-05-22T11:30:00.000Z",
    }),
    {
      sourcePath: "tier2/methodology/legal/contract-review-assistant/SKILL.md",
      sourceCommitSha: "8a31cf2d5f9a",
      indexedAt: "2026-05-22T11:30:00.000Z",
    },
  );
});

test("resolveIndexedEvalDatasetLabel prefers the logical name before falling back to the source path", () => {
  assert.equal(
    resolveIndexedEvalDatasetLabel({
      dataset_logical_name: "contract-corpus-v9",
      dataset_source_path: "evals/datasets/contracts.yaml",
    }),
    "contract-corpus-v9",
  );

  assert.equal(
    resolveIndexedEvalDatasetLabel({
      dataset_logical_name: null,
      dataset_source_path: "evals/datasets/contracts.yaml",
    }),
    "evals/datasets/contracts.yaml",
  );
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
