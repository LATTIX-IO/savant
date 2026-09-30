/**
 * How Savant turns a SkillSpector result into a decision. SkillSpector's own
 * recommendation is conservative: many packages come back CAUTION with a very
 * low risk score. Savant passes CAUTION below SKILLSPECTOR_PASS_RISK (default
 * 20) while always showing SkillSpector's raw output — the numeric risk and
 * both qualitative ratings (recommendation and severity) — next to the
 * decision, so nothing is hidden by the policy.
 */

export type SafetyDecision = "pass" | "pass_low_risk" | "caution" | "block" | "unknown";

export function safetyPassRisk(env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env): number {
  const value = Number(env.SKILLSPECTOR_PASS_RISK);
  return Number.isFinite(value) && value >= 0 ? value : 20;
}

export function safetyDecision(recommendation: string | null | undefined, riskScore: number | null | undefined, threshold = safetyPassRisk()): SafetyDecision {
  if (recommendation === "DO_NOT_INSTALL") return "block";
  if (recommendation === "SAFE") return "pass";
  if (recommendation === "CAUTION") return riskScore !== null && riskScore !== undefined && riskScore < threshold ? "pass_low_risk" : "caution";
  return "unknown";
}

export const SAFETY_DECISION_LABEL: Record<SafetyDecision, string> = {
  pass: "Passed",
  pass_low_risk: "Passed (low risk)",
  caution: "Review advised",
  block: "Blocked",
  unknown: "Not scanned",
};

export function describeSafetyDecision(decision: SafetyDecision, threshold = safetyPassRisk()): string {
  switch (decision) {
    case "pass":
      return "SkillSpector rated the package safe.";
    case "pass_low_risk":
      return `SkillSpector rated it CAUTION, but its risk score is below ${threshold}/100, so Savant's policy passes it. Its findings are still listed for review.`;
    case "caution":
      return `SkillSpector rated it CAUTION with a risk score of ${threshold}/100 or more; review the findings before use.`;
    case "block":
      return "SkillSpector recommends not installing this package.";
    default:
      return "No completed SkillSpector scan yet.";
  }
}
