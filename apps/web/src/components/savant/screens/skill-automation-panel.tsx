"use client";

import type { ChangeProposal } from "@savant/types";
import { useEffect, useState } from "react";

import {
  fetchChangeProposal,
  fetchSkillAutomation,
  startSkillEvalGeneration,
  type SkillAutomation,
  type SkillAutomationRun,
  type SkillSafetyScan,
} from "@/lib/git-connections-client";

import { EvalLimitationsNote, SafetyBreakdown } from "@/components/catalog/safety-breakdown";

import { SkillProposalNotice } from "./skill-assessment-findings";

const RUN_CHIP: Record<SkillAutomationRun["status"], string> = {
  queued: "chip-paper",
  running: "chip-brass",
  complete: "chip-moss",
  needs_review: "chip-brass",
  failed: "chip-blood",
};

const DECISION_CHIP: Record<string, string> = { accepted: "chip-moss", rejected: "chip-blood", needs_review: "chip-brass" };
const VERDICT_CHIP: Record<string, string> = { pass: "chip-moss", investigate: "chip-brass", fail: "chip-blood" };
const SAFETY_CHIP: Record<string, string> = { SAFE: "chip-moss", CAUTION: "chip-brass", DO_NOT_INSTALL: "chip-blood" };

const STAGE_LABEL: Record<string, string> = {
  drafting: "LLM drafting cases",
  validating: "Jev validating drafts",
  executing: "LLM running the skill on accepted cases",
  scoring: "Jev scoring outputs",
};

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string | undefined }) {
  return (
    <div className="col" style={{ gap: 2, minWidth: 96 }}>
      <span className="subtle" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 600 }}>{value}</span>
      {hint && <span className="subtle" style={{ fontSize: 11 }}>{hint}</span>}
    </div>
  );
}

function RunDetails({ run }: { run: SkillAutomationRun }) {
  const [showCases, setShowCases] = useState(false);
  const metrics = run.metrics;
  const live = run.status === "queued" || run.status === "running";
  const verdictByCase = new Map(run.samples.map((sample) => [sample.caseId, sample]));

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className={`chip ${RUN_CHIP[run.status]}`}>{run.status.replace("_", " ")}</span>
        <span className="subtle" style={{ fontSize: 12 }}>
          {run.mode === "alignment" ? "Alignment check against the committed answer key" : "Generated evaluation set"}
          {" · "}{run.trigger === "sync" ? "started by sync" : "started manually"}
          {" · "}{new Date(run.createdAt).toLocaleString()}
        </span>
      </div>

      {live && (
        <div className="note">
          <span style={{ fontSize: 12.5 }}>
            {run.status === "queued" ? "Waiting to start…" : `${STAGE_LABEL[metrics.stage ?? ""] ?? "Working"}${run.rounds ? ` · round ${run.rounds}` : ""} · ${run.cases.length} draft${run.cases.length === 1 ? "" : "s"} so far`}
          </span>
        </div>
      )}
      {run.error && <div className={`note ${run.status === "failed" ? "blood" : "brass"}`}><span style={{ fontSize: 12.5 }}>{run.error}</span></div>}

      {!live && run.status !== "failed" && (
        <>
          <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
            {run.scorecard?.overallScore !== undefined && (
              <Metric
                label={run.mode === "alignment" ? "Generated score" : "Provisional baseline"}
                value={run.scorecard.overallScore}
                hint={`${run.scorecard.passCount ?? 0} pass · ${run.scorecard.investigateCount ?? 0} investigate · ${run.scorecard.failCount ?? 0} fail`}
              />
            )}
            <Metric label="Accepted by Jev" value={`${metrics.accepted ?? 0}/${metrics.drafted ?? 0}`} hint={`Without Jev all ${metrics.drafted ?? 0} drafts would ship`} />
            <Metric label="Rejected" value={metrics.rejected ?? 0} hint={`${metrics.needsReview ?? 0} held for review`} />
            <Metric label="Rounds" value={run.rounds} hint={metrics.durationMs ? `${Math.round(metrics.durationMs / 1000)}s · ${metrics.llmCalls ?? 0} LLM / ${metrics.judgeCalls ?? 0} Jev calls` : undefined} />
          </div>

          <EvalLimitationsNote limitations={metrics.limitations} />

          {run.alignment && (
            <div className="note">
              <div className="col" style={{ gap: 4, fontSize: 12.5 }}>
                <span>
                  <strong>Alignment:</strong> generated {run.alignment.generatedOverall} vs committed {run.alignment.committedOverall}
                  {" "}({signed(run.alignment.overallDelta)}) · covers {Math.round(run.alignment.coverage * 100)}% of the {run.alignment.committedCases} committed case{run.alignment.committedCases === 1 ? "" : "s"}
                </span>
                <span className="subtle">
                  {Object.entries(run.alignment.dimensionDeltas).map(([dimension, delta]) => `${dimension} ${signed(delta)}`).join(" · ")}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {run.cases.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setShowCases((value) => !value)}>
            {showCases ? "Hide" : "Show"} {run.cases.length} drafted case{run.cases.length === 1 ? "" : "s"}
          </button>
          {showCases && (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Kind</th>
                  <th>Case</th>
                  <th style={{ width: 110 }}>Jev decision</th>
                  <th style={{ width: 100 }}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {run.cases.map((item) => {
                  const sample = verdictByCase.get(item.caseId);
                  return (
                    <tr key={`${item.caseId}-${item.round}`}>
                      <td><span className="mono" style={{ fontSize: 11 }}>{item.kind}</span></td>
                      <td>
                        <div style={{ fontSize: 12.5 }}>{item.prompt.length > 180 ? `${item.prompt.slice(0, 180)}…` : item.prompt}</div>
                        {item.validation.reasons.length > 0 && <div className="subtle" style={{ fontSize: 11 }}>{item.validation.reasons.join("; ")}</div>}
                      </td>
                      <td><span className={`chip ${DECISION_CHIP[item.validation.decision] ?? "chip-paper"}`} style={{ height: 18, fontSize: 10 }}>{item.validation.decision.replace("_", " ")}</span></td>
                      <td>{sample ? <span className={`chip ${VERDICT_CHIP[sample.verdict] ?? "chip-paper"}`} style={{ height: 18, fontSize: 10 }}>{sample.verdict}</span> : <span className="subtle">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function SafetyDetails({ scan }: { scan: SkillSafetyScan | null }) {
  if (!scan) {
    return <span className="subtle" style={{ fontSize: 12.5 }}>Not scanned yet. SkillSpector runs in the background after each sync.</span>;
  }
  if (scan.status !== "complete") {
    return <div className="note brass"><span style={{ fontSize: 12.5 }}>{scan.error ?? "The last safety scan didn't complete."}</span></div>;
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      <SafetyBreakdown safety={scan} />
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`chip ${SAFETY_CHIP[scan.recommendation ?? ""] ?? "chip-paper"}`}>{(scan.recommendation ?? "unknown").replace(/_/g, " ").toLowerCase()}</span>
        <span style={{ fontSize: 13 }}>{scan.issues.length} issue{scan.issues.length === 1 ? "" : "s"}</span>
        <span className="subtle" style={{ fontSize: 11.5 }}>
          {scan.llmUsed ? "static + LLM review" : "static analysis"} · {scan.commitSha.slice(0, 7)} · {new Date(scan.scannedAt).toLocaleString()}
        </span>
      </div>
      {scan.issues.slice(0, 8).map((issue) => (
        <div key={`${issue.id}-${issue.file ?? ""}-${issue.line ?? ""}`} className="row" style={{ gap: 6, fontSize: 12.5, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 10.5 }}>{issue.severity}</span>
          <span>{issue.category.replace(/_/g, " ")}: {issue.title}</span>
          {issue.file && <span className="subtle mono" style={{ fontSize: 11 }}>{issue.file}{issue.line ? `:${issue.line}` : ""}</span>}
          {(issue.explanation || issue.remediation) && (
            <div className="subtle" style={{ fontSize: 11.5, flexBasis: "100%" }}>
              {issue.explanation}{issue.explanation && issue.remediation ? " " : ""}{issue.remediation ? `Fix: ${issue.remediation}` : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Evaluation generation (LLM drafts → Jev validates → LLM executes → Jev
 * scores) and SkillSpector safety results for one skill.
 */
export function SkillAutomationPanel({ skillId }: { skillId: string }) {
  const [automation, setAutomation] = useState<SkillAutomation | null>(null);
  const [proposal, setProposal] = useState<ChangeProposal | null>(null);
  const [message, setMessage] = useState<{ tone: "default" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const latest = automation?.runs[0] ?? null;
  const live = latest?.status === "queued" || latest?.status === "running";

  useEffect(() => {
    let active = true;
    fetchSkillAutomation(skillId)
      .then((response) => {
        if (active) setAutomation(response.data);
      })
      .catch((error: unknown) => {
        if (active) setMessage({ tone: "error", text: error instanceof Error ? error.message : "Automation status is unavailable." });
      });
    return () => {
      active = false;
    };
  }, [skillId, refresh]);

  // Poll while a run is in progress.
  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(() => setRefresh((value) => value + 1), 5000);
    return () => clearTimeout(timer);
  }, [live, automation]);

  const proposalId = latest?.proposalId ?? null;
  useEffect(() => {
    if (!proposalId) return;
    let active = true;
    fetchChangeProposal(proposalId).then((response) => {
      if (active) setProposal(response.data);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [proposalId]);

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      await startSkillEvalGeneration(skillId);
      setRefresh((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Generation could not be started." });
    } finally {
      setBusy(false);
    }
  }

  const servicesMissing = automation && (!automation.services.nim || !automation.services.jev);

  return (
    <>
      <div className="panel">
        <div className="panel-hd">
          <div className="col" style={{ gap: 2 }}>
            <div className="panel-title">Evaluation generation</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>
              {automation?.services.generationModel ?? "NVIDIA NIM"} drafts and runs cases · {automation?.services.judgeModel ?? "Jev"} validates and scores
            </span>
          </div>
          {automation && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy || live || !automation.canGenerate}
              title={servicesMissing ? "NVIDIA_NIM_API_KEY and JEV_API_KEY must be configured" : !automation.canGenerate ? "Requires an admin or repository manager" : undefined}
              onClick={() => void generate()}
            >
              {busy ? "Starting…" : live ? "Running…" : automation.hasAnswerKey ? "Run alignment check" : latest ? "Regenerate evaluations" : "Generate evaluations"}
            </button>
          )}
        </div>
        <div className="panel-bd col" style={{ gap: 12 }}>
          {message && <div className={`note ${message.tone === "error" ? "blood" : ""}`}><span style={{ fontSize: 12.5 }}>{message.text}</span></div>}
          {!automation && !message && <span className="subtle" style={{ fontSize: 12.5 }}>Loading…</span>}
          {automation && !latest && (
            <span className="subtle" style={{ fontSize: 12.5 }}>
              {automation.hasAnswerKey
                ? "This skill has a committed, scored dataset. An alignment check generates an independent set and compares it with the answer key."
                : "This skill has no scored evaluation set. Generation drafts cases from SKILL.md, keeps the ones Jev validates, runs the skill on them, and proposes the dataset as a pull request."}
            </span>
          )}
          {latest && <RunDetails run={latest} />}
          {proposal && <SkillProposalNotice proposal={proposal} onUpdated={setProposal} />}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <div className="col" style={{ gap: 2 }}>
            <div className="panel-title">Skill safety</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>NVIDIA SkillSpector · prompt injection, exfiltration, excessive agency, dangerous code, supply chain</span>
          </div>
        </div>
        <div className="panel-bd">
          {automation ? <SafetyDetails scan={automation.safety} /> : <span className="subtle" style={{ fontSize: 12.5 }}>Loading…</span>}
        </div>
      </div>
    </>
  );
}
