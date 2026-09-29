// Development-only synthetic telemetry so the Skill Intelligence UI is usable
// without a database or a running worker. Everything is pushed through the
// real service functions (ingest → feedback → job → gate) so local screens
// exercise the same code paths production does.

import type { OptimizationCaseResult, SkillListItem, SkillRuntime } from "@savant/types";

import { buildFallbackSkillSourceContent } from "../../lib/skill-builder.ts";
import { createSeededRandom, hashStringToSeed } from "../../lib/skill-intelligence/statistics.ts";

import type { SkillIntelligenceDeps } from "./ports.ts";
import {
  claimOptimizationJob,
  ingestSkillRun,
  recordSkillFeedback,
  recordSkillOutcome,
  requestOptimization,
  submitOptimizationResult,
} from "./service.ts";

type GlobalWithSeeds = typeof globalThis & { __savantSkillIntelligenceSeeded?: Set<string> };

const RUNTIMES: SkillRuntime[] = ["openai", "claude", "codex", "copilot", "vscode"];
const DAY_MS = 24 * 60 * 60 * 1000;

const DEMO_LOCK = [
  "",
  "<!-- SAVANT:LOCK security-policy -->",
  "## Mandatory Human Approval",
  "- Production changes produced with this skill require explicit human sign-off.",
  "- Never include credentials, tokens, or customer secrets in outputs.",
  "<!-- SAVANT:ENDLOCK -->",
].join("\n");

export function buildDevelopmentSkillContent(skill: SkillListItem): string {
  return `${buildFallbackSkillSourceContent({
    skillId: skill.id,
    skillUuid: skill.skillUuid,
    name: skill.name,
    description: skill.description,
    tier: skill.tier,
    owner: skill.owner,
    team: skill.team,
    repo: skill.repo,
    repoProvider: skill.repoProvider,
    branch: skill.branch,
    ref: skill.ref,
    candidateRef: skill.candidateRef,
  })}\n${DEMO_LOCK}\n`;
}

function buildDevelopmentCandidate(content: string): string {
  const marker = "- Define the expected inputs, outputs, and decision boundaries.";
  return content.replace(
    marker,
    [
      marker,
      "- For every alternative considered, state its operational complexity and ongoing cost.",
      "- Close with the recommended option and how reversible that decision is.",
    ].join("\n"),
  );
}

function syntheticCases(seed: string): OptimizationCaseResult[] {
  const random = createSeededRandom(hashStringToSeed(seed));
  const cases: OptimizationCaseResult[] = [];
  for (let index = 0; index < 42; index += 1) {
    const baseline = 78 + random() * 12;
    const runtime = RUNTIMES[index % 4] as SkillRuntime;
    const lift = runtime === "copilot" ? 7 : 4.5;
    cases.push({
      caseId: `val-${index + 1}`,
      partition: "validation",
      runtime,
      baseline: Math.round(baseline * 10) / 10,
      candidate: Math.round((baseline + lift + (random() - 0.4) * 3) * 10) / 10,
      dimensions: {
        completeness: { baseline: Math.round(baseline + 3), candidate: Math.round(baseline + 8) },
        "security-compliance": { baseline: 100, candidate: 100 },
        "format-compliance": { baseline: 97, candidate: 98 },
      },
      baselineLatencyMs: 1800,
      candidateLatencyMs: 1832,
      baselineCost: 0.012,
      candidateCost: 0.01225,
    });
  }
  for (let index = 0; index < 24; index += 1) {
    const baseline = 90 + random() * 8;
    cases.push({
      caseId: `reg-${index + 1}`,
      partition: "regression",
      runtime: RUNTIMES[index % 4] as SkillRuntime,
      baseline: Math.round(baseline * 10) / 10,
      candidate: Math.round((baseline + random() * 1.5) * 10) / 10,
    });
  }
  for (let index = 0; index < 8; index += 1) {
    cases.push({ caseId: `hold-${index + 1}`, partition: "holdout", baseline: 82, candidate: 86 + random() * 2 });
  }
  return cases;
}

export async function seedDevelopmentSkillIntelligence(deps: SkillIntelligenceDeps, organizationId: string): Promise<void> {
  const holder = globalThis as GlobalWithSeeds;
  holder.__savantSkillIntelligenceSeeded ??= new Set();
  if (holder.__savantSkillIntelligenceSeeded.has(organizationId)) {
    return;
  }
  holder.__savantSkillIntelligenceSeeded.add(organizationId);
  try {
    await seedRuns(deps, organizationId);
  } catch (error) {
    holder.__savantSkillIntelligenceSeeded.delete(organizationId);
    throw error;
  }
}

async function seedRuns(deps: SkillIntelligenceDeps, organizationId: string): Promise<void> {

  const now = (deps.now?.() ?? new Date()).getTime();
  const skills = await deps.catalog.listSkills(organizationId);

  for (const [skillIndex, skill] of skills.entries()) {
    const random = createSeededRandom(hashStringToSeed(skill.skillId));
    const runCount = 40 + Math.floor(random() * 80);
    const weakRuntime = RUNTIMES[skillIndex % RUNTIMES.length];

    for (let index = 0; index < runCount; index += 1) {
      const runtime = RUNTIMES[Math.floor(random() * RUNTIMES.length)] as SkillRuntime;
      const penalty = runtime === weakRuntime ? 0.3 : 0;
      const recency = index / runCount;
      const failing = random() < 0.12 + penalty + (skillIndex % 3 === 2 ? recency * 0.2 : 0);
      const runId = `dev-${skill.skillId}-${index}`;

      await ingestSkillRun(deps, {
        organizationId,
        body: {
          runId,
          skillId: skill.skillId,
          skillVersionId: skill.baseVersion,
          connectorId: runtime === "copilot" ? "copilot-extension" : "savant-sdk",
          runtime,
          model: runtime === "claude" ? "claude-sonnet-5" : runtime === "openai" ? "gpt-5" : `${runtime}-default`,
          startedAt: new Date(now - Math.floor(random() * 45 * DAY_MS)).toISOString(),
          telemetryLevel: runtime === "copilot" ? "io" : runtime === "vscode" ? "outcome" : "full",
          success: !failing,
          latencyMs: Math.round(900 + random() * 2400),
          inputTokens: Math.round(800 + random() * 3000),
          outputTokens: Math.round(300 + random() * 1500),
          estimatedCost: Math.round((0.004 + random() * 0.02) * 10_000) / 10_000,
          taskArchetype: ["memo", "review", "summary", "brief"][Math.floor(random() * 4)],
          input: `Request ${index % 37} for ${skill.name}: ${["architecture choice", "vendor contract", "incident", "roadmap"][index % 4]} #${index % 37}`,
          output: `Draft output ${index}`,
          userRef: `dev-user-${index % 9}`,
        },
      });

      if (failing) {
        const categories = random() < 0.6 ? ["insufficient-detail"] : random() < 0.5 ? ["missing-knowledge"] : ["too-verbose"];
        await recordSkillFeedback(deps, {
          organizationId,
          runId,
          body: {
            kind: "explicit",
            categories,
            rating: 2,
            ...(categories[0] === "insufficient-detail" ? { rubricDimension: "operational trade-off analysis" } : {}),
          },
        });
        await recordSkillFeedback(deps, {
          organizationId,
          runId,
          body: { kind: "passive", signal: "accepted-after-edit", editRatio: 0.2 + random() * 0.3 },
        });
      } else {
        await recordSkillFeedback(deps, {
          organizationId,
          runId,
          body: random() < 0.7
            ? { kind: "passive", signal: "accepted-untouched" }
            : { kind: "passive", signal: "accepted-after-edit", editRatio: random() * 0.1 },
        });
      }

      if (random() < 0.3) {
        await recordSkillOutcome(deps, { organizationId, runId, body: { taskOutcome: failing ? "failed" : "succeeded" } });
      }
    }
  }

  // One worked example so the Improvements tab and queue render real gate output.
  const target = skills.find((skill) => skill.tier === 2) ?? skills[0];
  if (!target) {
    return;
  }

  try {
    await requestOptimization(deps, {
      organizationId,
      skillIdentifier: target.skillId,
      request: { trigger: "failure-cluster" },
      actor: { subject: "savant:dev-fixtures", userId: null },
      bypassEvidenceGate: true,
    });
    const bundle = await claimOptimizationJob(deps);
    if (!bundle || bundle.skill.skillId !== target.skillId) {
      return;
    }
    await submitOptimizationResult(deps, {
      jobId: bundle.jobId,
      result: {
        schemaVersion: 1,
        jobId: bundle.jobId,
        leaseToken: bundle.leaseToken,
        status: "completed",
        candidateContent: buildDevelopmentCandidate(bundle.skill.skillMd),
        editRationales: [],
        inferredPattern: "Existing instructions emphasize comparing alternatives but never require an operating-cost or reversibility comparison.",
        cases: syntheticCases(target.skillId),
        provenance: {
          engine: "skillopt",
          engineDisplayName: "Microsoft SkillOpt",
          version: "0.2.0",
          sourceCommit: null,
          optimizerModel: "mock",
          optimizerBackend: "mock (development fixture)",
          configHash: "development",
        },
      },
    });
  } catch {
    // Fixture seeding is best-effort; the UI still works without the example.
  }
}
