import type { AssessmentFinding } from "@savant/types";

import { fingerprintFinding } from "../assessment/assess.ts";

/** A stored scan, as the assessment and skill page read it. */
export type StoredSafetyScan = {
  skillId: string;
  sourcePath: string;
  commitSha: string;
  status: "complete" | "failed" | "unavailable";
  riskScore: number | null;
  severity: string | null;
  recommendation: string | null;
  issues: Array<{ id: string; category: string; severity: string; title: string; file: string | null; line: number | null; confidence: number | null; explanation?: string | null; remediation?: string | null }>;
  llmUsed: boolean;
  scannerVersion: string | null;
  error: string | null;
  scannedAt: string;
};

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

function describeIssues(scan: StoredSafetyScan): string {
  const top = [...scan.issues]
    .sort((left, right) => SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity))
    .slice(0, 4)
    .map((issue) => `${issue.severity.toLowerCase()} ${issue.category.replace(/_/g, " ")}: ${issue.title}${issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})` : ""}`);
  const more = scan.issues.length > top.length ? ` and ${scan.issues.length - top.length} more` : "";
  return `${top.join("; ")}${more}.`;
}

/** Turns the latest scan per skill into assessment findings. */
export function safetyFindings(scans: readonly StoredSafetyScan[]): AssessmentFinding[] {
  const findings: AssessmentFinding[] = [];
  const unavailable = scans.find((scan) => scan.status === "unavailable");
  if (unavailable) {
    findings.push({
      fingerprint: fingerprintFinding("SAFETY_SCAN_UNAVAILABLE", "repository::"),
      code: "SAFETY_SCAN_UNAVAILABLE",
      severity: "info",
      scope: "repository",
      skillId: null,
      path: null,
      title: "Skill safety scanning is unavailable",
      detail: unavailable.error ?? "SkillSpector could not run.",
      remediation: "Safety scans run in a Vercel Sandbox. Check the project's Sandbox access; the next sync retries automatically.",
      fix: null,
      status: "open",
    });
  }

  for (const scan of scans) {
    if (scan.status === "failed") {
      findings.push({
        fingerprint: fingerprintFinding("SAFETY_SCAN_FAILED", `skill:${scan.skillId}:${scan.sourcePath}`),
        code: "SAFETY_SCAN_FAILED",
        severity: "info",
        scope: "skill",
        skillId: scan.skillId,
        path: scan.sourcePath,
        title: "Safety scan didn't complete",
        detail: scan.error ?? "SkillSpector produced no report for this package.",
        remediation: "It's retried on the next sync. If it keeps failing, the package may be too large or malformed.",
        fix: null,
        status: "open",
      });
      continue;
    }
    if (scan.status !== "complete" || scan.recommendation === "SAFE" || scan.recommendation === null) {
      continue;
    }
    const blocking = scan.recommendation === "DO_NOT_INSTALL";
    findings.push({
      fingerprint: fingerprintFinding(blocking ? "SAFETY_DO_NOT_INSTALL" : "SAFETY_CAUTION", `skill:${scan.skillId}:${scan.sourcePath}`),
      code: blocking ? "SAFETY_DO_NOT_INSTALL" : "SAFETY_CAUTION",
      severity: blocking ? "blocker" : "warning",
      scope: "skill",
      skillId: scan.skillId,
      path: scan.sourcePath,
      title: blocking
        ? `SkillSpector flags this skill as unsafe to install (risk ${scan.riskScore ?? "?"}/100)`
        : `SkillSpector found security risks to review (risk ${scan.riskScore ?? "?"}/100)`,
      detail: scan.issues.length > 0 ? describeIssues(scan) : `Overall severity ${scan.severity ?? "unknown"}.`,
      remediation: blocking
        ? "Don't release this skill until the flagged instructions, scripts or dependencies are fixed or confirmed as false positives."
        : "Review the flagged patterns; fix them or dismiss the finding if they're intended.",
      fix: null,
      status: "open",
    });
  }
  return findings;
}
