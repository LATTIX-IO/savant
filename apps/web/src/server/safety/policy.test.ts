import assert from "node:assert/strict";
import test from "node:test";

import { executionLimitations, liveRunInstructions } from "../evaluation/limitations.ts";
import { computeVerdict } from "../hub/analysis.ts";
import { safetyFindings } from "./findings.ts";
import { safetyDecision } from "./policy.ts";

test("CAUTION below the pass risk passes under policy; raw output stays in the finding", () => {
  assert.equal(safetyDecision("CAUTION", 12, 20), "pass_low_risk");
  assert.equal(safetyDecision("CAUTION", 20, 20), "caution");
  assert.equal(safetyDecision("SAFE", 0, 20), "pass");
  assert.equal(safetyDecision("DO_NOT_INSTALL", 5, 20), "block");
  assert.equal(computeVerdict({ findings: [], safetyRecommendation: "CAUTION", safetyRiskScore: 12, evalStatus: "complete", evalScore: 80 }), "validated");
  assert.equal(computeVerdict({ findings: [], safetyRecommendation: "CAUTION", safetyRiskScore: 34, evalStatus: "complete", evalScore: 80 }), "caution");

  const findings = safetyFindings([{ skillId: "a", sourcePath: "tier2/x/a", commitSha: "c", status: "complete", riskScore: 12, severity: "LOW", recommendation: "CAUTION", issues: [], llmUsed: false, scannerVersion: "2", error: null, scannedAt: "2026-09-30T00:00:00Z" }]);
  assert.equal(findings[0]?.code, "SAFETY_LOW_RISK");
  assert.equal(findings[0]?.severity, "info");
  assert.match(findings[0]?.detail ?? "", /SkillSpector: CAUTION · severity LOW · risk 12\/100/);
});

test("limitations explain what a chat-only run can't exercise; small references are included", () => {
  const limitations = executionLimitations({ skillMd: "Run `python scripts/build.py` then open the PDF.", files: [{ path: "scripts/build.py" }] });
  assert.deepEqual(limitations.map((item) => item.code), ["SCRIPTS", "TOOLS", "MEDIA"]);
  const context = liveRunInstructions("# Skill", [{ path: "references/a.md", content: "A" }, { path: "LICENSE.txt", content: "L" }, { path: "references/big.md", content: "x".repeat(20_000) }]);
  assert.equal(context.included, 1);
  assert.equal(context.omitted, 1);
  assert.match(context.instructions, /<reference path="references\/a.md">/);
});
