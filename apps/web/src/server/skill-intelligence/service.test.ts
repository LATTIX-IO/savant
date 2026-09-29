import assert from "node:assert/strict";
import test from "node:test";

import type { OptimizationCaseResult, OptimizationJobResult } from "@savant/types";

import type { CatalogSkill, IntelligenceEvent, SkillIntelligenceDeps, StageResult } from "./ports.ts";
import {
  claimOptimizationJob,
  getOrganizationIntelligence,
  getSkillIntelligence,
  ingestSkillRun,
  recordSkillFeedback,
  requestOptimization,
  reviewRecommendation,
  runIntelligenceSweep,
  SkillIntelligenceError,
  submitOptimizationResult,
  updateIntelligenceSettings,
} from "./service.ts";
import { createMemorySkillIntelligenceStore } from "./store.ts";

const ORG = "org-1";
// Assembled at runtime so no credential-shaped literal appears in source.
const FAKE_OPENAI_KEY = ["sk", "proj", "abcdefghijklmnopqrstuvwx"].join("-");
const FAKE_GITHUB_TOKEN = `${"gh"}p_${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
const NOW = new Date("2026-09-29T12:00:00.000Z");

const SKILL_MD = [
  "# Technical Design Memo",
  "",
  "## Procedure",
  "- Compare architecture alternatives.",
  "- Recommend one option.",
  "",
  "<!-- SAVANT:LOCK security-policy -->",
  "## Mandatory Human Approval",
  "Production deployment requires sign-off.",
  "<!-- SAVANT:ENDLOCK -->",
].join("\n");

const CANDIDATE_MD = SKILL_MD.replace(
  "- Compare architecture alternatives.",
  "- Compare architecture alternatives.\n- Analyze operational complexity for every alternative.",
);

function createHarness(overrides: { tier?: 1 | 2 | 3; classification?: CatalogSkill["classification"] } = {}) {
  const store = createMemorySkillIntelligenceStore();
  const events: IntelligenceEvent[] = [];
  const staged: string[] = [];
  const skill: CatalogSkill = {
    skillId: "technical-design-memo",
    name: "Technical Design Memo",
    tier: overrides.tier ?? 2,
    owner: "ari.chen",
    baseVersion: "v2.4.0",
    classification: overrides.classification ?? "internal",
    evalBenchmark: 91,
    regressionStability: 95,
    authoredEvalCases: 12,
    versionHistory: [{ ref: "v2.4.0", releasedAt: "2026-09-01T00:00:00.000Z", score: 88, delta: 1.2 }],
  };

  const deps: SkillIntelligenceDeps = {
    store,
    artifactsEnabled: true,
    now: () => NOW,
    events: { emit: async (event) => { events.push(event); } },
    releases: {
      stageCandidate: async ({ recommendation }): Promise<StageResult> => {
        staged.push(recommendation.recommendationId);
        return { staged: true, releaseRequestId: `release-${staged.length}`, commitSha: "abc1234" };
      },
    },
    catalog: {
      listSkills: async () => [skill],
      getSkill: async (_org, identifier) => (identifier === skill.skillId ? skill : null),
      getSkillContent: async () => ({ content: SKILL_MD, live: true }),
      getDependents: async () => ({ direct: 0, transitive: 0, suiteSkillIds: [] }),
    },
  };

  return { deps, store, events, staged, skill };
}

async function seedRuns(deps: SkillIntelligenceDeps, count = 60) {
  for (let index = 0; index < count; index += 1) {
    const failing = index % 4 === 0;
    const startedAt = new Date(NOW.getTime() - (index % 20) * 24 * 60 * 60 * 1000).toISOString();
    await ingestSkillRun(deps, {
      organizationId: ORG,
      body: {
        runId: `run-${index}`,
        skillId: "technical-design-memo",
        skillVersionId: "v2.4.0",
        connectorId: "savant-sdk",
        runtime: index % 3 === 0 ? "claude" : "openai",
        model: "model-a",
        startedAt,
        telemetryLevel: "full",
        success: !failing,
        latencyMs: 1200 + index,
        input: `Design memo request ${index} for service ${index % 17}. api_key=${FAKE_OPENAI_KEY}${index}`,
        output: `Memo ${index}`,
        userRef: `user-${index % 5}@example.com`,
      },
    });
    if (failing) {
      await recordSkillFeedback(deps, {
        organizationId: ORG,
        runId: `run-${index}`,
        body: { kind: "explicit", categories: ["insufficient-detail"], rubricDimension: "trade-off analysis", rating: 2, comment: "email me at jane@example.com" },
      });
    } else {
      await recordSkillFeedback(deps, { organizationId: ORG, runId: `run-${index}`, body: { kind: "passive", signal: "accepted-untouched" } });
    }
  }
}

function passingCases(): OptimizationCaseResult[] {
  const cases: OptimizationCaseResult[] = [];
  for (let index = 0; index < 36; index += 1) {
    cases.push({
      caseId: `val-${index}`,
      partition: "validation",
      runtime: index % 2 ? "claude" : "openai",
      baseline: 80 + (index % 6),
      candidate: 86 + (index % 6),
      dimensions: {
        "security-compliance": { baseline: 100, candidate: 100 },
        completeness: { baseline: 88, candidate: 95 },
      },
      baselineLatencyMs: 1000,
      candidateLatencyMs: 1018,
    });
  }
  for (let index = 0; index < 10; index += 1) {
    cases.push({ caseId: `reg-${index}`, partition: "regression", baseline: 92, candidate: 93 });
  }
  cases.push({ caseId: "hold-1", partition: "holdout", baseline: 84, candidate: 88 });
  return cases;
}

function workerResult(bundle: { jobId: string; leaseToken: string }, overrides: Partial<OptimizationJobResult> = {}): OptimizationJobResult {
  return {
    schemaVersion: 1,
    jobId: bundle.jobId,
    leaseToken: bundle.leaseToken,
    status: "completed",
    candidateContent: CANDIDATE_MD,
    editRationales: [{ baseStart: 4, rationale: "Runs lacked operational trade-off analysis." }],
    inferredPattern: "Instructions emphasize alternatives but not operating cost.",
    cases: passingCases(),
    datasets: [{ partition: "train", caseCount: 30, runIds: ["run-1"], datasetHash: "h", curationSummary: { deduplicated: 2 } }],
    provenance: {
      engine: "skillopt",
      engineDisplayName: "Microsoft SkillOpt",
      version: "0.2.0",
      sourceCommit: null,
      optimizerModel: "gpt-opt",
      optimizerBackend: "azure-openai",
      configHash: "cfg",
    },
    ...overrides,
  };
}

test("ingestion redacts secrets and configured PII before persistence and pseudonymizes actors", async () => {
  const { deps, store } = createHarness();
  const result = await ingestSkillRun(deps, {
    organizationId: ORG,
    body: {
      runId: "r1",
      skillId: "technical-design-memo",
      skillVersionId: "v2.4.0",
      connectorId: "sdk",
      runtime: "openai",
      startedAt: NOW.toISOString(),
      telemetryLevel: "full",
      input: `token ${FAKE_GITHUB_TOKEN} for bob@example.com`,
      trajectory: [{ kind: "tool-call", name: "search", content: "Bearer abcdefghijklmnopqrstuvwxyz" }],
      userRef: "bob@example.com",
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.storedTelemetryLevel, "io", "default capture mode stores inputs/outputs, not trajectories");
  assert.deepEqual(result.droppedFields, ["trajectory"]);
  assert.equal(result.redactionApplied, true);

  const artifacts = await store.listRunArtifacts(ORG, ["r1"]);
  const stored = artifacts.get("r1")?.input ?? "";
  assert.ok(!stored.includes(FAKE_GITHUB_TOKEN));
  assert.ok(!stored.includes("bob@example.com"));

  const duplicate = await ingestSkillRun(deps, { organizationId: ORG, body: { runId: "r1", skillId: "technical-design-memo", skillVersionId: "v2.4.0", connectorId: "sdk", runtime: "openai", startedAt: NOW.toISOString(), telemetryLevel: "outcome" } });
  assert.equal(duplicate.accepted, false);

  const unknown = await ingestSkillRun(deps, { organizationId: ORG, body: { runId: "r2", skillId: "nope", skillVersionId: "v1", connectorId: "sdk", runtime: "openai", startedAt: NOW.toISOString(), telemetryLevel: "outcome" } });
  assert.equal(unknown.accepted, false);
});

test("skills with optimization telemetry disabled keep outcome metrics only", async () => {
  const { deps } = createHarness();
  await updateIntelligenceSettings(deps, {
    organizationId: ORG,
    body: { optimizationDisabledSkills: ["technical-design-memo"] },
    actor: { subject: "admin", userId: null },
  });
  const result = await ingestSkillRun(deps, {
    organizationId: ORG,
    body: { runId: "s1", skillId: "technical-design-memo", skillVersionId: "v2.4.0", connectorId: "sdk", runtime: "openai", startedAt: NOW.toISOString(), telemetryLevel: "full", input: "secret stuff" },
  });
  assert.equal(result.storedTelemetryLevel, "outcome");
  assert.deepEqual(result.droppedFields, ["input"]);

  await assert.rejects(
    requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "a", userId: null } }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "optimization_disabled",
  );
});

test("optimization is refused without minimum evidence", async () => {
  const { deps } = createHarness();
  await seedRuns(deps, 8);
  await assert.rejects(
    requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "a", userId: null } }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "insufficient_evidence",
  );
});

test("full governed loop: observe → optimize → validate → human approval → staging release", async () => {
  const { deps, events, staged } = createHarness();
  await seedRuns(deps);

  const intelligence = await getSkillIntelligence(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo" });
  assert.equal(intelligence.health.runCount, 60);
  assert.equal(intelligence.eligibility.eligible, true, intelligence.eligibility.blockers.join(" "));
  assert.ok(intelligence.clusters.some((cluster) => cluster.label === "Rubric: trade-off analysis"));

  const job = await requestOptimization(deps, {
    organizationId: ORG,
    skillIdentifier: "technical-design-memo",
    request: {},
    actor: { subject: "owner", userId: "u-owner" },
  });
  assert.equal(job.status, "queued");

  const bundle = await claimOptimizationJob(deps);
  assert.ok(bundle);
  assert.equal(bundle.mode, "optimize");
  assert.equal(bundle.skill.skillMd, SKILL_MD);
  assert.equal(bundle.runs.length, 60);
  assert.ok(bundle.runs.every((run) => !(run.input ?? "").includes("sk-proj-")), "bundle carries sanitized inputs only");
  assert.equal(bundle.changeBudget.aggressiveness, "conservative");
  assert.equal(await claimOptimizationJob(deps), null, "a leased job is not handed out twice");

  await assert.rejects(
    submitOptimizationResult(deps, { jobId: bundle.jobId, result: { ...workerResult(bundle), leaseToken: "forged" } }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "job_lease_invalid",
  );

  const submitted = await submitOptimizationResult(deps, { jobId: bundle.jobId, result: workerResult(bundle) });
  assert.equal(submitted.status, "completed");
  assert.ok(submitted.recommendationId);

  const [recommendation] = await deps.store.listRecommendations(ORG, { skillId: "technical-design-memo" });
  assert.ok(recommendation);
  assert.equal(recommendation.status, "ready-for-review");
  assert.equal(recommendation.validation.passed, true, JSON.stringify(recommendation.validation.gate, null, 2));
  assert.equal(recommendation.requiredApprovals, 2, "Tier 2 requires owner + SME");
  assert.equal(recommendation.candidateVersion, "v2.5.0");
  assert.deepEqual(recommendation.lockedRegions, ["security-policy"]);
  assert.match(recommendation.proposedPatch, /\+- Analyze operational complexity/);
  assert.equal(recommendation.edits[0]?.rationale, "Runs lacked operational trade-off analysis.");
  assert.ok(recommendation.explanation.observed.length > 0);
  assert.ok(recommendation.explanation.evidence.includes("bootstrap interval"));
  assert.equal(recommendation.provenance.engineDisplayName, "Microsoft SkillOpt");

  const reviewer = (name: string) => ({ userRef: name, displayName: name, role: "Admin" as const, subject: name, userId: name });

  const first = await reviewRecommendation(deps, {
    organizationId: ORG,
    recommendationId: recommendation.recommendationId,
    request: { decision: "approve" },
    actor: reviewer("owner"),
  });
  assert.equal(first.status, "ready-for-review", "one approval is not enough for Tier 2");
  assert.equal(staged.length, 0);

  await assert.rejects(
    reviewRecommendation(deps, { organizationId: ORG, recommendationId: recommendation.recommendationId, request: { decision: "approve" }, actor: reviewer("owner") }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "duplicate_approval",
  );

  const second = await reviewRecommendation(deps, {
    organizationId: ORG,
    recommendationId: recommendation.recommendationId,
    request: { decision: "approve" },
    actor: reviewer("sme"),
  });
  assert.equal(second.status, "approved");
  assert.equal(second.releaseRequestId, "release-1", "approval hands off to the release rail, never production");
  assert.equal(staged.length, 1);

  const actions = events.map((event) => event.action);
  for (const expected of [
    "optimization.triggered",
    "optimization.started",
    "optimization.completed",
    "recommendation.created",
    "recommendation.reviewed",
    "candidate.approved",
    "skill.version.released",
  ]) {
    assert.ok(actions.includes(expected), `missing audit event ${expected}`);
  }

  const org = await getOrganizationIntelligence(deps, { organizationId: ORG });
  assert.equal(org.activeSkills, 1);
  assert.equal(org.runsThisMonth, 60);
});

test("the control plane rejects a worker candidate that edits a locked region", async () => {
  const { deps } = createHarness();
  await seedRuns(deps);
  await requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "o", userId: null } });
  const bundle = await claimOptimizationJob(deps);
  assert.ok(bundle);

  await submitOptimizationResult(deps, {
    jobId: bundle.jobId,
    result: workerResult(bundle, { candidateContent: CANDIDATE_MD.replace("requires sign-off", "is automatic") }),
  });
  const [recommendation] = await deps.store.listRecommendations(ORG, {});
  assert.ok(recommendation);
  assert.equal(recommendation.validation.passed, false);
  assert.equal(recommendation.validation.gate.find((entry) => entry.key === "locked-rules")?.passed, false);

  await assert.rejects(
    reviewRecommendation(deps, {
      organizationId: ORG,
      recommendationId: recommendation.recommendationId,
      request: { decision: "approve" },
      actor: { userRef: "x", displayName: "x", role: "Owner", subject: "x", userId: "x" },
    }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "validation_gate_failed",
  );
});

test("a safety regression blocks the gate even when the total score improves", async () => {
  const { deps } = createHarness();
  await seedRuns(deps);
  await requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "o", userId: null } });
  const bundle = await claimOptimizationJob(deps);
  assert.ok(bundle);
  const cases = passingCases().map((entry) => entry.partition === "validation"
    ? { ...entry, dimensions: { "security-compliance": { baseline: 100, candidate: 96 } } }
    : entry);
  await submitOptimizationResult(deps, { jobId: bundle.jobId, result: workerResult(bundle, { cases }) });
  const [recommendation] = await deps.store.listRecommendations(ORG, {});
  assert.ok(recommendation);
  assert.ok(recommendation.validation.delta > 0);
  assert.equal(recommendation.validation.passed, false);
  assert.equal(recommendation.validation.gate.find((entry) => entry.key === "critical-safety")?.passed, false);
});

test("human modification voids approvals and forces re-evaluation of the exact new artifact", async () => {
  const { deps } = createHarness({ tier: 3 });
  await seedRuns(deps);
  await requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "o", userId: null } });
  const bundle = await claimOptimizationJob(deps);
  assert.ok(bundle);
  await submitOptimizationResult(deps, { jobId: bundle.jobId, result: workerResult(bundle) });
  const [recommendation] = await deps.store.listRecommendations(ORG, {});
  assert.ok(recommendation);

  const actor = { userRef: "owner", displayName: "owner", role: "Owner" as const, subject: "owner", userId: "owner" };
  const modified = await reviewRecommendation(deps, {
    organizationId: ORG,
    recommendationId: recommendation.recommendationId,
    request: { decision: "modify", candidateContent: CANDIDATE_MD.replace("every alternative", "each alternative") },
    actor,
  });
  assert.equal(modified.status, "evaluating");
  assert.equal(modified.requiresReevaluation, true);

  await assert.rejects(
    reviewRecommendation(deps, { organizationId: ORG, recommendationId: recommendation.recommendationId, request: { decision: "approve" }, actor }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "recommendation_not_ready",
  );

  await assert.rejects(
    reviewRecommendation(deps, {
      organizationId: ORG,
      recommendationId: recommendation.recommendationId,
      request: { decision: "modify", candidateContent: CANDIDATE_MD.replace("requires sign-off", "optional") },
      actor,
    }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "locked_region_modified",
  );

  const reevaluation = await claimOptimizationJob(deps);
  assert.ok(reevaluation);
  assert.equal(reevaluation.mode, "evaluate-only");
  assert.ok(reevaluation.candidateOverride?.includes("each alternative"));

  const evaluateOnlyResult = workerResult(reevaluation);
  delete evaluateOnlyResult.candidateContent;
  await submitOptimizationResult(deps, { jobId: reevaluation.jobId, result: evaluateOnlyResult });
  const refreshed = await deps.store.getRecommendation(ORG, recommendation.recommendationId);
  assert.equal(refreshed?.status, "ready-for-review");
  assert.equal(refreshed?.requiresReevaluation, false);

  const approved = await reviewRecommendation(deps, { organizationId: ORG, recommendationId: recommendation.recommendationId, request: { decision: "approve" }, actor });
  assert.equal(approved.status, "approved", "Tier 3 needs a single approval");
});

test("rejections require structured reasons that feed later optimization bundles", async () => {
  const { deps } = createHarness();
  await seedRuns(deps);
  await requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "o", userId: null } });
  const bundle = await claimOptimizationJob(deps);
  assert.ok(bundle);
  await submitOptimizationResult(deps, { jobId: bundle.jobId, result: workerResult(bundle) });
  const [recommendation] = await deps.store.listRecommendations(ORG, {});
  assert.ok(recommendation);
  const actor = { userRef: "owner", displayName: "owner", role: "Owner" as const, subject: "owner", userId: "owner" };

  await assert.rejects(
    reviewRecommendation(deps, { organizationId: ORG, recommendationId: recommendation.recommendationId, request: { decision: "reject" }, actor }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "rejection_reason_required",
  );

  await reviewRecommendation(deps, {
    organizationId: ORG,
    recommendationId: recommendation.recommendationId,
    request: { decision: "reject", reasons: ["overfit"], comment: "Too narrow — please ignore this prose." },
    actor,
  });

  await requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "o", userId: null } });
  const next = await claimOptimizationJob(deps);
  assert.deepEqual(next?.rejectionSignals, [{ reason: "overfit", count: 1 }]);
  assert.ok(!JSON.stringify(next).includes("please ignore this prose"), "rejection prose never reaches the optimizer");
});

test("restricted skills are never sent to an optimizer provider", async () => {
  const { deps } = createHarness({ classification: "restricted" });
  await seedRuns(deps);
  await assert.rejects(
    requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "o", userId: null } }),
    (error: unknown) => error instanceof SkillIntelligenceError && error.code === "optimizer_provider_not_permitted",
  );
});

test("the sweep snapshots health and auto-enqueues only when the mode allows it", async () => {
  const { deps } = createHarness();
  await seedRuns(deps);

  await updateIntelligenceSettings(deps, { organizationId: ORG, body: { autoOptimizationMode: "observe" }, actor: { subject: "a", userId: null } });
  const observed = await runIntelligenceSweep(deps, { organizationId: ORG });
  assert.equal(observed.snapshots, 1);
  assert.deepEqual(observed.enqueued, []);

  await updateIntelligenceSettings(deps, { organizationId: ORG, body: { autoOptimizationMode: "recommend" }, actor: { subject: "a", userId: null } });
  const recommended = await runIntelligenceSweep(deps, { organizationId: ORG });
  assert.deepEqual(recommended.enqueued, ["technical-design-memo"]);
});

test("claimed bundles match the shared worker contract fixture consumed by the Python worker", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(await readFile(
    new URL("../../../../../packages/schemas/fixtures/optimization-job-bundle.example.json", import.meta.url),
    "utf8",
  )) as Record<string, unknown> & { skill: Record<string, unknown>; runs: Array<Record<string, unknown>>; changeBudget: Record<string, unknown> };

  const { deps } = createHarness();
  await seedRuns(deps);
  await requestOptimization(deps, { organizationId: ORG, skillIdentifier: "technical-design-memo", request: {}, actor: { subject: "o", userId: null } });
  const bundle = await claimOptimizationJob(deps);
  assert.ok(bundle);

  const keys = (value: object) => Object.keys(value).sort();
  assert.deepEqual(keys(bundle), keys(fixture));
  assert.deepEqual(keys(bundle.skill), keys(fixture.skill));
  assert.deepEqual(keys(bundle.changeBudget), keys(fixture.changeBudget));
  assert.deepEqual(keys(bundle.runs[0] ?? {}), keys(fixture.runs[0] ?? {}));
});
