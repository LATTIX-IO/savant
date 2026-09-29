// Opt-in integration test for the Postgres store and the full service loop.
// Skipped unless PG_SMOKE_URL points at a disposable database that has
// db/schema/*.sql applied (e.g. a local Postgres, or PGlite's socket server).
//
//   PG_SMOKE_URL=<disposable-postgres-url> node --test --experimental-strip-types \
//     apps/web/src/server/skill-intelligence/postgres-store.integration.test.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import type { OptimizationCaseResult } from "@savant/types";

import { createPostgresSkillIntelligenceStore } from "./postgres-store.ts";
import type { SkillIntelligenceDeps } from "./ports.ts";
import { claimOptimizationJob, getSkillIntelligence, ingestSkillRun, recordSkillFeedback, recordSkillOutcome, requestOptimization, reviewRecommendation, runIntelligenceSweep, submitOptimizationResult, updateIntelligenceSettings } from "./service.ts";

const SKILL_MD = "# Memo\n\n## Procedure\n- Compare alternatives.\n- Recommend one.\n\n<!-- SAVANT:LOCK p -->\n## Approval\nSign-off required.\n<!-- SAVANT:ENDLOCK -->";

test("postgres store full loop", { skip: !process.env.PG_SMOKE_URL }, async (t) => {
  const sql = postgres(process.env.PG_SMOKE_URL!, { max: 1, prepare: false });
  t.after(() => sql.end({ timeout: 1 }));
  const [org] = await sql<{ id: string }[]>`insert into organizations (slug, display_name) values ('smoke', 'Smoke') returning id`;
  const ORG = org!.id;
  // PGlite multiplexes a single connection; serialize queries so postgres.js
  // pipelining cannot interleave responses. Harmless (just slower) on Postgres.
  let chain: Promise<unknown> = Promise.resolve();
  const serialized = new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      if (Array.isArray(args[0]) && "raw" in (args[0] as object)) {
        const run = chain.then(() => Reflect.apply(target, thisArg, args) as Promise<unknown>);
        chain = run.catch(() => undefined);
        return run;
      }
      return Reflect.apply(target, thisArg, args);
    },
    get(target, key, receiver) {
      if (key === "begin") {
        return (fn: (tx: unknown) => Promise<unknown>) => {
          const run = chain.then(() => target.begin(fn as never));
          chain = run.catch(() => undefined);
          return run;
        };
      }
      return Reflect.get(target, key, receiver);
    },
  }) as typeof sql;
  const store = createPostgresSkillIntelligenceStore(serialized, { encryptionKey: randomBytes(32) });
  const skill = { skillId: "memo", name: "Memo", tier: 3 as const, owner: null, baseVersion: "v1.0.0", classification: "internal" as const, evalBenchmark: 90, regressionStability: 95, authoredEvalCases: 12, versionHistory: [] };
  const deps: SkillIntelligenceDeps = {
    store, artifactsEnabled: true,
    events: { emit: async () => {} },
    releases: { stageCandidate: async () => ({ staged: true, releaseRequestId: "00000000-0000-4000-8000-00000000000a", commitSha: null }) },
    catalog: { listSkills: async () => [skill], getSkill: async (_o, id) => (id === "memo" ? skill : null), getSkillContent: async () => ({ content: SKILL_MD, live: true }), getDependents: async () => ({ direct: 0, transitive: 0, suiteSkillIds: [] }) },
  };

  await updateIntelligenceSettings(deps, { organizationId: ORG, body: { telemetryMode: "full-trajectories" }, actor: { subject: "a", userId: null } });
  for (let i = 0; i < 50; i += 1) {
    const r = await ingestSkillRun(deps, { organizationId: ORG, body: { runId: `r${i}`, skillId: "memo", skillVersionId: "v1.0.0", connectorId: "sdk", runtime: i % 2 ? "claude" : "openai", startedAt: new Date(Date.now() - i * 3600e3).toISOString(), telemetryLevel: "full", success: i % 4 !== 0, input: `task ${i} mail x@y.com`, output: "out", trajectory: [{ kind: "message", content: "hi" }], userRef: "u1" } });
    assert.equal(r.accepted, true);
    await recordSkillFeedback(deps, { organizationId: ORG, runId: `r${i}`, body: i % 4 === 0 ? { kind: "explicit", categories: ["insufficient-detail"], rubricDimension: "depth", rating: 2 } : { kind: "passive", signal: "accepted-after-edit", editRatio: 0.05 } });
    if (i % 5 === 0) await recordSkillOutcome(deps, { organizationId: ORG, runId: `r${i}`, body: { taskOutcome: "succeeded", humanAccepted: true } });
  }
  const dup = await ingestSkillRun(deps, { organizationId: ORG, body: { runId: "r1", skillId: "memo", skillVersionId: "v1", connectorId: "sdk", runtime: "openai", startedAt: new Date().toISOString(), telemetryLevel: "outcome" } });
  assert.equal(dup.accepted, false);

  const artifacts = await store.listRunArtifacts(ORG, ["r3"]);
  assert.equal(artifacts.get("r3")?.input, "task 3 mail [REDACTED:email]");
  const [raw] = await sql<{ encrypted_payload: string }[]>`select encrypted_payload from skill_run_artifacts limit 1`;
  assert.ok(raw!.encrypted_payload.startsWith("v1:") && !raw!.encrypted_payload.includes("task"));

  const intel = await getSkillIntelligence(deps, { organizationId: ORG, skillIdentifier: "memo" });
  assert.equal(intel.health.runCount, 50);
  assert.ok(intel.clusters.some((c) => c.label === "Rubric: depth"));
  assert.equal(intel.eligibility.eligible, true, intel.eligibility.blockers.join(" "));

  await requestOptimization(deps, { organizationId: ORG, skillIdentifier: "memo", request: {}, actor: { subject: "a", userId: null } });
  await assert.rejects(requestOptimization(deps, { organizationId: ORG, skillIdentifier: "memo", request: {}, actor: { subject: "a", userId: null } }), /already queued/);
  const bundle = await claimOptimizationJob(deps);
  assert.ok(bundle);
  assert.equal(await claimOptimizationJob(deps), null);
  const cases: OptimizationCaseResult[] = [
    ...Array.from({ length: 36 }, (_, i): OptimizationCaseResult => ({ caseId: `v${i}`, partition: "validation", runtime: "openai", baseline: 80 + (i % 5), candidate: 86 + (i % 5) })),
    ...Array.from({ length: 5 }, (_, i): OptimizationCaseResult => ({ caseId: `g${i}`, partition: "regression", runtime: "openai", baseline: 90, candidate: 91 })),
  ];
  const res = await submitOptimizationResult(deps, { jobId: bundle.jobId, result: { schemaVersion: 1, jobId: bundle.jobId, leaseToken: bundle.leaseToken, status: "completed", candidateContent: SKILL_MD.replace("- Recommend one.", "- Recommend one.\n- Explain depth."), cases, datasets: [{ partition: "train", caseCount: 3, runIds: ["r1"], datasetHash: "h", curationSummary: {} }], provenance: { engine: "skillopt", engineDisplayName: "Microsoft SkillOpt", version: "0.2.0", sourceCommit: null, optimizerModel: "m", optimizerBackend: "azure-openai", configHash: "c" } } });
  assert.ok(res.recommendationId);
  const rec = await store.getRecommendation(ORG, res.recommendationId!);
  assert.equal(rec?.validation.passed, true, JSON.stringify(rec?.validation.gate));
  const listed = await store.listRecommendations(ORG, { skillId: "memo", statuses: ["ready-for-review"] });
  assert.equal(listed.length, 1);
  const jobs = await store.listJobs(ORG, "memo", 5);
  assert.equal(jobs[0]?.status, "completed");
  assert.equal(jobs[0]?.recommendationId, res.recommendationId);

  const rejected = await reviewRecommendation(deps, { organizationId: ORG, recommendationId: res.recommendationId!, request: { decision: "reject", reasons: ["overfit", "style-regression"] }, actor: { userRef: "u", displayName: "u", role: "Owner", subject: "u", userId: null } });
  assert.equal(rejected.status, "rejected");
  assert.deepEqual((await store.listRejectionSignals(ORG, "memo")).map((s) => s.reason).sort(), ["overfit", "style-regression"]);

  const sweep = await runIntelligenceSweep(deps, { organizationId: ORG });
  assert.equal(sweep.snapshots, 1);
  assert.equal((await store.listHealthSnapshots(ORG, new Date(0).toISOString())).length, 1);
  const token = await store.createIngestToken({ organizationId: ORG, label: "t", tokenHash: "h1", connectorId: null, userId: null });
  assert.equal((await store.resolveIngestToken("h1"))?.tokenId, token.tokenId);
  await sql.end();
});
