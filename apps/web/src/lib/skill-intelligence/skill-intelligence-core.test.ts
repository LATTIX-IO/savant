import assert from "node:assert/strict";
import test from "node:test";

import { scoreEditRatio, scoreFeedbackEvent, aggregateWeakLabel } from "./feedback-signals.ts";
import { clusterFailures } from "./failure-clusters.ts";
import { computeCohorts, computeSkillHealth, computeTelemetryCoverage, type AnalyzedRun } from "./health.ts";
import { parseLockedRegions, verifyLockedRegionsUnchanged } from "./locked-sections.ts";
import {
  normalizeSkillIntelligenceSettings,
  resolveChangeBudget,
  resolveStoredTelemetryLevel,
  resolveTierThresholds,
  selectOptimizerProvider,
  DEFAULT_EVIDENCE_THRESHOLDS,
  DEFAULT_SKILL_INTELLIGENCE_SETTINGS,
} from "./policy.ts";
import { containsSecret, redactText } from "./redaction.ts";
import { classifyEvidenceStrength, pairedBootstrapInterval } from "./statistics.ts";
import { applyEdits, deriveEdits, renderUnifiedDiff, verifyChangeBudget } from "./skill-diff.ts";
import { detectTriggers, evaluateOptimizationEligibility } from "./triggers.ts";

function run(overrides: Partial<AnalyzedRun> & { runId: string }): AnalyzedRun {
  return {
    runtime: "openai",
    model: "gpt-x",
    skillVersionId: "v1.0.0",
    connectorId: "sdk",
    telemetryLevel: "full",
    success: true,
    startedAt: "2026-09-20T12:00:00.000Z",
    latencyMs: 1000,
    estimatedCost: 0.01,
    weakLabel: 0.8,
    taskArchetype: "memo",
    businessUnit: null,
    inputStructure: null,
    inputFingerprint: overrides.runId,
    feedbackCategories: [],
    passiveSignals: [],
    rubricFailures: [],
    editRatio: null,
    humanAccepted: null,
    taskOutcome: null,
    outputScore: null,
    ...overrides,
  };
}

// Credential-shaped test values are assembled at runtime so the repository's
// secret scanner never sees a key-like literal in source.
const FAKE = {
  openai: ["sk", "proj", "abcdefghijklmnopqrstuvwxyz0123"].join("-"),
  github: `${"gh"}p_${"abcdefghijklmnopqrstuvwxyz0123456789"}`,
  aws: `${"AK"}IA${"ABCDEFGHIJKLMNOP"}`,
  connection: `${"postgres"}://admin:${"hunter"}2@db.internal:5432/app`,
  privateKey: ["-----BEGIN RSA PRIVATE", "KEY-----", "MIIEow", "-----END RSA PRIVATE", "KEY-----"]
    .join(" ")
    .replace("KEY----- MIIEow -----END", "KEY-----\nMIIEow\n-----END"),
};

// --- redaction -------------------------------------------------------------

test("redactText strips secrets unconditionally and PII only when configured", () => {
  const input = [
    `key ${FAKE.openai}`,
    `gh ${FAKE.github}`,
    `aws ${FAKE.aws}`,
    `db ${FAKE.connection}`,
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123",
    "password=SuperSecret99",
    "mail jane.doe@example.com",
  ].join("\n");

  const secretsOnly = redactText(input);
  assert.ok(!secretsOnly.text.includes(FAKE.openai));
  assert.ok(!secretsOnly.text.includes(FAKE.github));
  assert.ok(!secretsOnly.text.includes(FAKE.aws));
  assert.ok(!secretsOnly.text.includes("hunter2"));
  assert.ok(!secretsOnly.text.includes("SuperSecret99"));
  assert.ok(secretsOnly.text.includes("password=[REDACTED:credential-assignment]"));
  assert.ok(secretsOnly.text.includes("jane.doe@example.com"), "PII untouched without configuration");
  assert.equal(containsSecret(secretsOnly.text), false);

  const withPii = redactText(input, { piiClasses: ["email"] });
  assert.ok(!withPii.text.includes("jane.doe@example.com"));
  assert.equal(withPii.counts.email, 1);
});

test("redactText only treats Luhn-valid digit runs as card numbers", () => {
  const result = redactText("card 4111 1111 1111 1111 order 1234 5678 9012 3456", { piiClasses: ["credit-card"] });
  assert.ok(result.text.includes("[REDACTED:credit-card]"));
  assert.ok(result.text.includes("1234 5678 9012 3456"));
});

test("redactText removes private key blocks", () => {
  const result = redactText(FAKE.privateKey);
  assert.equal(result.text, "[REDACTED:private-key]");
});

// --- feedback --------------------------------------------------------------

test("weak labels follow the specified polarity", () => {
  assert.equal(scoreFeedbackEvent({ kind: "passive", signal: "accepted-untouched" }), 1);
  assert.ok(scoreEditRatio(0.05) > 0.5, "5% edit is positive");
  assert.ok(scoreEditRatio(0.4) < 0, "40% edit is weak/negative");
  assert.ok(scoreFeedbackEvent({ kind: "passive", signal: "discarded" }) < 0);
  assert.equal(scoreFeedbackEvent({ kind: "explicit", rating: 5 }), 1);
  assert.equal(
    scoreFeedbackEvent({ kind: "explicit", rating: 5, categories: ["unsafe-recommendation"] }),
    -1,
    "an unsafe flag is never averaged away",
  );
  assert.equal(aggregateWeakLabel([{ derivedScore: 1, reporterRole: "user" }, { derivedScore: -1, reporterRole: "sme" }]), -0.3333);
});

// --- health / cohorts -----------------------------------------------------

test("computeSkillHealth reports component dimensions, trends, and coverage", () => {
  const now = new Date("2026-09-29T00:00:00.000Z");
  const runs: AnalyzedRun[] = [];
  for (let index = 0; index < 20; index += 1) {
    runs.push(run({ runId: `old-${index}`, startedAt: "2026-09-18T00:00:00.000Z", success: true, weakLabel: 0.9 }));
    runs.push(run({ runId: `new-${index}`, startedAt: "2026-09-26T00:00:00.000Z", success: index % 2 === 0, weakLabel: index % 2 === 0 ? 0.9 : -0.5, telemetryLevel: index < 10 ? "full" : "io" }));
  }

  const health = computeSkillHealth("skill-a", runs, { evalBenchmark: 94, regressionStability: 90, now });
  assert.equal(health.runCount, 40);
  assert.equal(health.dimensions.find((dimension) => dimension.key === "task-success")?.score, 75);
  assert.equal(health.dimensions.find((dimension) => dimension.key === "eval-benchmark")?.score, 94);
  assert.ok(health.trend7d != null && health.trend7d < 0, "recent regression shows as a negative trend");
  assert.equal(health.fullTrajectoryCoverage, 75);
  assert.ok(health.composite != null);
});

test("computeCohorts flags an underperforming runtime", () => {
  const runs: AnalyzedRun[] = [];
  for (let index = 0; index < 30; index += 1) {
    runs.push(run({ runId: `o-${index}`, runtime: "openai" }));
    runs.push(run({ runId: `c-${index}`, runtime: "copilot", success: index % 3 === 0, weakLabel: index % 3 === 0 ? 0.5 : -0.6 }));
  }
  const cohorts = computeCohorts(runs, ["runtime"]);
  assert.equal(cohorts.find((cohort) => cohort.cohortKey === "copilot")?.flagged, true);
  assert.equal(cohorts.find((cohort) => cohort.cohortKey === "openai")?.flagged, false);

  const coverage = computeTelemetryCoverage(runs);
  assert.equal(coverage.length, 2);
  assert.equal(coverage[0]?.dominantLevel, "full");
});

// --- clustering & triggers -------------------------------------------------

test("clusterFailures groups by structured signals and reports the remainder", () => {
  const runs = [
    ...Array.from({ length: 6 }, (_, index) => run({ runId: `m-${index}`, success: false, weakLabel: -0.6, feedbackCategories: ["missing-knowledge"], runtime: index % 2 ? "claude" : "openai" })),
    ...Array.from({ length: 4 }, (_, index) => run({ runId: `r-${index}`, success: false, weakLabel: -0.4, rubricFailures: ["trade-off analysis"] })),
    run({ runId: "lonely", success: false, weakLabel: -0.2 }),
    run({ runId: "fine" }),
  ];
  const clusters = clusterFailures(runs);
  assert.equal(clusters[0]?.clusterId, "category-missing-knowledge");
  assert.equal(clusters[0]?.runCount, 6);
  assert.deepEqual(clusters[0]?.runtimes, ["claude", "openai"]);
  assert.ok(clusters.some((cluster) => cluster.basis === "rubric-dimension" && cluster.runCount === 4));
  assert.equal(clusters.at(-1)?.clusterId, "uncategorized");
  assert.equal(clusters.at(-1)?.runCount, 1);
});

test("eligibility enforces minimum evidence and tier multipliers", () => {
  const runs = Array.from({ length: 40 }, (_, index) => run({
    runId: `run-${index}`,
    success: index % 4 !== 0,
    weakLabel: index % 4 === 0 ? -0.6 : 0.8,
    feedbackCategories: index % 4 === 0 ? ["insufficient-detail"] : [],
  }));
  const clusters = clusterFailures(runs);
  const base = {
    runs,
    clusters,
    thresholds: DEFAULT_EVIDENCE_THRESHOLDS,
    authoredEvalCases: 4,
    telemetryDisabled: false,
    providerBlocker: null,
    lastOptimizationAt: null,
    now: new Date("2026-09-29T00:00:00.000Z"),
  };

  const tier2 = evaluateOptimizationEligibility({ ...base, tier: 2 });
  assert.equal(tier2.eligible, true, tier2.blockers.join(" "));
  assert.ok(tier2.triggers.some((finding) => finding.trigger === "failure-cluster"));

  const tier1 = evaluateOptimizationEligibility({ ...base, tier: 1 });
  assert.equal(tier1.eligible, false, "Tier 1 requires doubled evidence");
  assert.deepEqual(resolveTierThresholds(DEFAULT_EVIDENCE_THRESHOLDS, 1).minRuns, 60);

  const disabled = evaluateOptimizationEligibility({ ...base, tier: 2, telemetryDisabled: true });
  assert.equal(disabled.eligible, false);
  assert.deepEqual(disabled.triggers, []);
});

test("detectTriggers finds new environments and high edit rates", () => {
  const now = new Date("2026-09-29T00:00:00.000Z");
  const runs = [
    ...Array.from({ length: 10 }, (_, index) => run({ runId: `old-${index}`, startedAt: "2026-09-01T00:00:00.000Z", editRatio: 0.3 })),
    ...Array.from({ length: 6 }, (_, index) => run({ runId: `new-${index}`, runtime: "codex", startedAt: "2026-09-27T00:00:00.000Z", editRatio: 0.3 })),
  ];
  const findings = detectTriggers({ runs, clusters: [], thresholds: DEFAULT_EVIDENCE_THRESHOLDS, lastOptimizationAt: null, now });
  assert.ok(findings.some((finding) => finding.trigger === "new-environment" && finding.detail.includes("codex")));
  assert.ok(findings.some((finding) => finding.trigger === "high-edit-rate"));
});

// --- policy ------------------------------------------------------------------

test("capture mode caps the stored telemetry level", () => {
  assert.equal(resolveStoredTelemetryLevel("full", "metrics-only"), "outcome");
  assert.equal(resolveStoredTelemetryLevel("full", "inputs-outputs"), "io");
  assert.equal(resolveStoredTelemetryLevel("io", "full-trajectories"), "io");
});

test("tier ceilings clamp optimization aggressiveness", () => {
  assert.equal(resolveChangeBudget("exploratory", 1).aggressiveness, "conservative");
  assert.equal(resolveChangeBudget("exploratory", 2).aggressiveness, "balanced");
  assert.equal(resolveChangeBudget("exploratory", 3).aggressiveness, "exploratory");
  assert.deepEqual(resolveChangeBudget("conservative", 2).allowedOperations, ["add", "replace"]);
});

test("optimizer provider governance respects classification", () => {
  const settings = { allowedOptimizerProviders: ["openai-public", "azure-openai", "local-unknown"] as const };
  const mutable = { allowedOptimizerProviders: [...settings.allowedOptimizerProviders] };
  assert.deepEqual(selectOptimizerProvider(mutable, "confidential"), { allowed: true, provider: "azure-openai" });
  assert.equal(selectOptimizerProvider(mutable, "confidential", "openai-public").allowed, false);
  assert.equal(selectOptimizerProvider(mutable, "restricted").allowed, false);
  assert.deepEqual(selectOptimizerProvider(mutable, "public"), { allowed: true, provider: "openai-public" });
});

test("settings normalization never admits an autonomous deployment mode", () => {
  const normalized = normalizeSkillIntelligenceSettings({
    autoOptimizationMode: "autonomous-production-deployment",
    telemetryMode: "full-trajectories",
    thresholds: { minRuns: 50, minDistinctTasks: -3 },
    allowedOptimizerProviders: ["azure-openai", "made-up"],
  });
  assert.equal(normalized.autoOptimizationMode, DEFAULT_SKILL_INTELLIGENCE_SETTINGS.autoOptimizationMode);
  assert.equal(normalized.telemetryMode, "full-trajectories");
  assert.equal(normalized.thresholds.minRuns, 50);
  assert.equal(normalized.thresholds.minDistinctTasks, DEFAULT_EVIDENCE_THRESHOLDS.minDistinctTasks);
  assert.deepEqual(normalized.allowedOptimizerProviders, ["azure-openai"]);
});

// --- locks, diff, budget ---------------------------------------------------

const BASE_SKILL = [
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

test("locked regions are parsed and verified byte-for-byte", () => {
  const parsed = parseLockedRegions(BASE_SKILL);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.regions[0]?.id, "security-policy");

  assert.equal(verifyLockedRegionsUnchanged(BASE_SKILL, BASE_SKILL.replace("Recommend one option.", "Recommend exactly one option.")).ok, true);
  const tampered = verifyLockedRegionsUnchanged(BASE_SKILL, BASE_SKILL.replace("requires sign-off", "is automatic"));
  assert.equal(tampered.ok, false);
  assert.match(tampered.violations[0] ?? "", /security-policy/);
  assert.equal(verifyLockedRegionsUnchanged(BASE_SKILL, BASE_SKILL.split("<!-- SAVANT:LOCK")[0] ?? "").ok, false);
  assert.equal(parseLockedRegions("<!-- SAVANT:LOCK a -->\nno end").errors.length, 1);
});

test("deriveEdits produces bounded edits that can be partially applied", () => {
  const candidate = BASE_SKILL
    .replace("- Compare architecture alternatives.", "- Compare architecture alternatives.\n- Analyze operational complexity for every alternative.")
    .replace("- Recommend one option.", "- Recommend one option, noting implementation reversibility.");

  const edits = deriveEdits(BASE_SKILL, candidate, [{ baseStart: 4, rationale: "61 runs lacked reversibility." }]);
  assert.ok(edits.length >= 1);
  assert.ok(edits.every((edit) => edit.section === "Procedure"));
  assert.equal(applyEdits(BASE_SKILL, edits), candidate, "all edits reproduce the candidate");

  if (edits.length === 2) {
    const partial = applyEdits(BASE_SKILL, [edits[0]!]);
    assert.ok(partial.includes("operational complexity"));
    assert.ok(!partial.includes("reversibility"));
  }

  const patch = renderUnifiedDiff(BASE_SKILL, candidate);
  assert.match(patch, /^--- a\/SKILL\.md/);
  assert.match(patch, /\+- Analyze operational complexity/);

  const budget = verifyChangeBudget(BASE_SKILL, edits, resolveChangeBudget("conservative", 2));
  assert.equal(budget.ok, true, budget.violations.join(" "));
});

test("verifyChangeBudget rejects edits inside locked regions and oversize changes", () => {
  const touchingLock = BASE_SKILL.replace("requires sign-off", "requires two sign-offs");
  const lockEdits = deriveEdits(BASE_SKILL, touchingLock);
  const lockCheck = verifyChangeBudget(BASE_SKILL, lockEdits, resolveChangeBudget("exploratory", 3));
  assert.equal(lockCheck.ok, false);
  assert.ok(lockCheck.violations.some((violation) => violation.includes("locked region")));

  const huge = `${BASE_SKILL}\n${Array.from({ length: 30 }, (_, index) => `- extra rule ${index}`).join("\n")}`;
  const hugeCheck = verifyChangeBudget(BASE_SKILL, deriveEdits(BASE_SKILL, huge), resolveChangeBudget("conservative", 2));
  assert.equal(hugeCheck.ok, false);

  const deletion = BASE_SKILL.replace("- Recommend one option.\n", "");
  const deleteCheck = verifyChangeBudget(BASE_SKILL, deriveEdits(BASE_SKILL, deletion), resolveChangeBudget("conservative", 2));
  assert.ok(deleteCheck.violations.some((violation) => violation.includes('"delete"')));
});

// --- statistics --------------------------------------------------------------

test("bootstrap intervals are deterministic and drive evidence strength", () => {
  const pairs = Array.from({ length: 40 }, (_, index) => ({ baseline: 80 + (index % 5), candidate: 85 + (index % 5) }));
  const first = pairedBootstrapInterval(pairs, { seed: 7 });
  const second = pairedBootstrapInterval(pairs, { seed: 7 });
  assert.deepEqual(first, second);
  assert.equal(classifyEvidenceStrength(first, 10), "high");

  const noisy = [{ baseline: 80, candidate: 90 }, { baseline: 90, candidate: 80 }, { baseline: 85, candidate: 86 }];
  assert.equal(classifyEvidenceStrength(pairedBootstrapInterval(noisy, { seed: 7 }), 10), "insufficient");
});
