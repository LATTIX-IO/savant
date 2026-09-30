import assert from "node:assert/strict";
import test from "node:test";

import { safetyFindings } from "./findings.ts";
import { packageFingerprint, parseSkillSpectorReport, SCANNABLE_FILE } from "./skillspector.ts";

const REPORT = {
  skill: { name: "exporter", source: "/tmp/x", scanned_at: "2026-09-30T00:00:00Z" },
  risk_assessment: { score: 72, severity: "HIGH", recommendation: "DO_NOT_INSTALL" },
  issues: [
    { id: "DE-003", category: "data_exfiltration", severity: "HIGH", confidence: 0.9, title: "Uploads workspace files to an external URL", location: { file: "scripts/sync.py", start_line: 14 } },
    { id: "PI-001", category: "prompt_injection", severity: "MEDIUM", confidence: 0.6, message: "Instruction to ignore prior rules", location: { file: "SKILL.md", start_line: 3 } },
  ],
  metadata: { skillspector_version: "1.4.0", llm_requested: false, llm_available: false },
};

test("parses SkillSpector JSON reports", () => {
  const parsed = parseSkillSpectorReport(REPORT);
  assert.equal(parsed.recommendation, "DO_NOT_INSTALL");
  assert.equal(parsed.riskScore, 72);
  assert.equal(parsed.issues[1]?.title, "Instruction to ignore prior rules");
  assert.equal(parsed.issues[0]?.file, "scripts/sync.py");
  assert.equal(parsed.llmUsed, false);
  assert.equal(parsed.scannerVersion, "1.4.0");
  assert.equal(parseSkillSpectorReport({}).recommendation, null);
});

test("scan results become assessment findings: blockers for DO_NOT_INSTALL, nothing for SAFE", () => {
  const base = { commitSha: "abc", llmUsed: false, scannerVersion: "1", error: null, scannedAt: "2026-09-30T00:00:00Z" };
  const findings = safetyFindings([
    { ...base, skillId: "a", sourcePath: "tier2/x/a", status: "complete", riskScore: 72, severity: "HIGH", recommendation: "DO_NOT_INSTALL", issues: parseSkillSpectorReport(REPORT).issues },
    { ...base, skillId: "b", sourcePath: "tier2/x/b", status: "complete", riskScore: 5, severity: "LOW", recommendation: "SAFE", issues: [] },
    { ...base, skillId: "*", sourcePath: "*", status: "unavailable", riskScore: null, severity: null, recommendation: null, issues: [], error: "Sandbox not enabled" },
  ]);
  assert.deepEqual(findings.map((finding) => `${finding.code}:${finding.severity}`), ["SAFETY_SCAN_UNAVAILABLE:info", "SAFETY_DO_NOT_INSTALL:blocker"]);
  assert.match(findings[1]?.detail ?? "", /high data exfiltration: Uploads workspace files.*scripts\/sync\.py:14/);
});

test("package fingerprints are order-independent and only text files are scanned", () => {
  assert.equal(packageFingerprint({ "a.md": "1", "b.py": "2" }), packageFingerprint({ "b.py": "2", "a.md": "1" }));
  assert.notEqual(packageFingerprint({ "a.md": "1" }), packageFingerprint({ "a.md": "2" }));
  assert.ok(SCANNABLE_FILE.test("scripts/run.py") && SCANNABLE_FILE.test("SKILL.md") && SCANNABLE_FILE.test("requirements.txt"));
  assert.ok(!SCANNABLE_FILE.test("assets/logo.png"));
});
