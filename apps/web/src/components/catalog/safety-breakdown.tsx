import { describeSafetyDecision, SAFETY_DECISION_LABEL, safetyDecision } from "@/server/safety/policy";
import type { EvalLimitation } from "@/server/evaluation/limitations";

/**
 * SkillSpector's raw output (numeric risk, recommendation and severity) next
 * to Savant's policy decision, so the policy never hides the scanner's view.
 * Works in server and client components.
 */
export function SafetyBreakdown({
  safety,
  compact = false,
}: {
  safety: { status?: string; riskScore: number | null; recommendation: string | null; severity: string | null; llmUsed?: boolean | undefined; scannerVersion?: string | null | undefined } | null;
  compact?: boolean;
}) {
  if (!safety || safety.status === "unavailable" || safety.recommendation === null) {
    return <span style={{ fontSize: 12.5, opacity: 0.75 }}>{safety?.status === "unavailable" ? "Safety scanning is temporarily unavailable." : "SkillSpector scan pending."}</span>;
  }
  const decision = safetyDecision(safety.recommendation, safety.riskScore);
  const cells: Array<[string, string]> = [
    ["Risk score", `${safety.riskScore ?? "—"}/100`],
    ["Recommendation", safety.recommendation.replace(/_/g, " ")],
    ["Severity", safety.severity ?? "—"],
    ["Savant decision", SAFETY_DECISION_LABEL[decision]],
  ];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
        {cells.map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.7 }}>{label}</div>
            <div style={{ fontSize: compact ? 14 : 17, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>
      {!compact && (
        <div style={{ fontSize: 12.5, opacity: 0.85 }}>
          {describeSafetyDecision(decision)}
          {safety.scannerVersion ? ` SkillSpector ${safety.scannerVersion}${safety.llmUsed ? ", static + LLM review" : ", static analysis"}.` : ""}
        </div>
      )}
    </div>
  );
}

/** Explains what the chat-only live run couldn't exercise, next to the score. */
export function EvalLimitationsNote({ limitations }: { limitations: EvalLimitation[] | undefined | null }) {
  if (!limitations || limitations.length === 0) {
    return null;
  }
  return (
    <div style={{ fontSize: 12.5, borderLeft: "3px solid var(--brass, #b58a3c)", padding: "6px 10px", display: "grid", gap: 4 }}>
      <strong style={{ fontSize: 12.5 }}>Why this score may understate the skill</strong>
      <span>The live evaluation is a chat-only run: the model follows the skill&apos;s instructions but can&apos;t execute its scripts, call tools or reach the network.</span>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {limitations.map((limitation) => <li key={limitation.code}>{limitation.message}</li>)}
      </ul>
      <span>Live telemetry from real runs (via the Savant skill router) replaces this estimate as it accumulates.</span>
    </div>
  );
}
