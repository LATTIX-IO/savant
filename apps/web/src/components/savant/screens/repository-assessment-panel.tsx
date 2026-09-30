"use client";

import type { AssessmentFinding, AssessmentSeverity, ChangeProposal, RepositoryAssessment } from "@savant/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  approveChangeProposal,
  fetchRepositoryAssessment,
  proposeAssessmentFixes,
  rejectChangeProposal,
  setAssessmentFindingDismissed,
} from "@/lib/git-connections-client";

const SEVERITY_ORDER: AssessmentSeverity[] = ["blocker", "warning", "info"];
const SEVERITY_LABEL: Record<AssessmentSeverity, string> = { blocker: "Blockers", warning: "Warnings", info: "Suggestions" };
const SEVERITY_CHIP: Record<AssessmentSeverity, string> = { blocker: "chip-blood", warning: "chip-brass", info: "chip-paper" };

const PROPOSAL_STATUS: Record<ChangeProposal["status"], { label: string; chip: string }> = {
  pending_approval: { label: "awaiting approval", chip: "chip-brass" },
  opening_pr: { label: "opening PR…", chip: "chip-slate" },
  pr_open: { label: "PR open", chip: "chip-moss" },
  merged: { label: "merged", chip: "chip-moss" },
  closed: { label: "PR closed", chip: "chip-paper" },
  failed: { label: "failed", chip: "chip-blood" },
  rejected: { label: "rejected", chip: "chip-paper" },
};

function scoreChip(score: number): string {
  return score >= 85 ? "chip-moss" : score >= 60 ? "chip-brass" : "chip-blood";
}

function FileDiff({ file }: { file: ChangeProposal["files"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: 5 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="row"
        style={{ width: "100%", justifyContent: "space-between", padding: "6px 8px", background: "transparent", border: 0, cursor: "pointer", color: "var(--ink)", fontSize: 12 }}
      >
        <span className="mono">{file.path}</span>
        <span className="chip chip-paper" style={{ height: 20, fontSize: 10.5 }}>{file.action === "create" ? "new file" : "modified"}</span>
      </button>
      {open && (
        <div style={{ display: "grid", gridTemplateColumns: file.previousContent !== null ? "1fr 1fr" : "1fr", gap: 6, padding: 8, borderTop: "1px solid var(--rule)" }}>
          {file.previousContent !== null && (
            <pre className="mono" style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", opacity: 0.7 }}>{file.previousContent}</pre>
          )}
          <pre className="mono" style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>{file.content}</pre>
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  busy,
  onApprove,
  onReject,
}: {
  proposal: ChangeProposal;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const status = PROPOSAL_STATUS[proposal.status];
  const actionable = proposal.status === "pending_approval" || proposal.status === "failed";
  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: 6, padding: 10 }} className="col">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{proposal.title}</span>
        <span className={`chip ${status.chip}`}><span className="dot" />{status.label}</span>
      </div>
      {proposal.error && <div className="note blood" style={{ marginTop: 6 }}><span style={{ fontSize: 12 }}>{proposal.error}</span></div>}
      <div className="col" style={{ gap: 4, marginTop: 8 }}>
        {proposal.files.map((file) => <FileDiff key={file.path} file={file} />)}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {actionable && (
          <>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={onApprove}>
              {busy ? "Opening pull request…" : proposal.status === "failed" ? "Retry: approve & open PR" : "Approve & open pull request"}
            </button>
            {proposal.status === "pending_approval" && (
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={onReject}>Reject</button>
            )}
          </>
        )}
        {proposal.pullRequestUrl && (
          <a className="btn btn-sm" href={proposal.pullRequestUrl} target="_blank" rel="noreferrer">
            View pull request #{proposal.pullRequestNumber}
          </a>
        )}
      </div>
      {actionable && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Approving opens a pull request on a new branch against {proposal.baseBranch}. It merges through the repository&apos;s normal review and branch protection rules.
        </div>
      )}
    </div>
  );
}

/**
 * Post-sync assessment for a repository: what's missing or inconsistent, what
 * limits quality, and fixes Savant can propose as a pull request.
 */
export function RepositoryAssessmentPanel({
  repositoryId,
  refreshToken,
  onNotice,
}: {
  repositoryId: string;
  refreshToken: number;
  onNotice: (tone: "default" | "error", message: string) => void;
}) {
  const [assessment, setAssessment] = useState<RepositoryAssessment | null>(null);
  const [proposals, setProposals] = useState<ChangeProposal[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    fetchRepositoryAssessment(repositoryId)
      .then((response) => {
        if (!active) return;
        setAssessment(response.data.assessment);
        setProposals(response.data.proposals);
        setSelected(new Set());
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [repositoryId, refreshToken, reload]);

  const findings = useMemo(() => (assessment?.findings ?? []).filter((finding) => showDismissed || finding.status !== "dismissed"), [assessment, showDismissed]);
  const fixableOpen = findings.filter((finding) => finding.fix && finding.status === "open");
  const refresh = useCallback(() => setReload((value) => value + 1), []);

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    try {
      onNotice("default", await action());
      refresh();
    } catch (error) {
      onNotice("error", error instanceof Error ? error.message : "The action failed.");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  function toggle(finding: AssessmentFinding) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(finding.fingerprint)) next.delete(finding.fingerprint);
      else next.add(finding.fingerprint);
      return next;
    });
  }

  if (state === "loading") {
    return <div className="muted" style={{ fontSize: 12 }}>Loading assessment…</div>;
  }
  if (state === "error") {
    return <div className="note blood"><span style={{ fontSize: 12.5 }}>The assessment could not be loaded.</span></div>;
  }
  if (!assessment) {
    return (
      <div className="col" style={{ gap: 6 }}>
        <div className="eyebrow">Assessment</div>
        <div className="muted" style={{ fontSize: 12.5 }}>No assessment yet. Savant assesses the repository automatically after the next successful sync.</div>
      </div>
    );
  }

  const { summary } = assessment;
  const openProposals = proposals.filter((proposal) => ["pending_approval", "opening_pr", "failed"].includes(proposal.status));
  const history = proposals.filter((proposal) => !openProposals.includes(proposal)).slice(0, 5);

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow">Assessment · {assessment.commitSha.slice(0, 7)}</div>
        <span className={`chip ${scoreChip(summary.score)}`}><span className="dot" />score {summary.score}/100</span>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", fontSize: 12 }}>
        <span className="chip chip-blood">{summary.blockers} blocker{summary.blockers === 1 ? "" : "s"}</span>
        <span className="chip chip-brass">{summary.warnings} warning{summary.warnings === 1 ? "" : "s"}</span>
        <span className="chip chip-paper">{summary.infos} suggestion{summary.infos === 1 ? "" : "s"}</span>
        <span className="muted">
          {summary.skillsIndexed} of {summary.skillsDiscovered} skills imported{summary.skillsSkipped ? ` · ${summary.skillsSkipped} skipped` : ""}
        </span>
      </div>

      {openProposals.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <div className="eyebrow">Proposed changes</div>
          {openProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              busy={busy === proposal.id}
              onApprove={() => void run(proposal.id, async () => {
                const response = await approveChangeProposal(proposal.id);
                return `Pull request #${response.data.pullRequestNumber} opened. It merges through the repository's review rules; Savant picks up the change on the next sync.`;
              })}
              onReject={() => void run(proposal.id, async () => {
                await rejectChangeProposal(proposal.id);
                return "Proposal rejected. Nothing was written to the repository.";
              })}
            />
          ))}
        </div>
      )}

      {findings.length === 0 ? (
        <div className="note"><span style={{ fontSize: 12.5 }}>No open findings. This repository meets everything Savant checks for.</span></div>
      ) : (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={selected.size === 0 || busy !== null}
              onClick={() => void run("propose", async () => {
                const response = await proposeAssessmentFixes(repositoryId, [...selected]);
                return `Proposed ${response.data.files.length} file change${response.data.files.length === 1 ? "" : "s"}. Review the diff and approve to open a pull request.`;
              })}
            >
              {busy === "propose" ? "Preparing fix…" : `Propose fix${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </button>
            {fixableOpen.length > 0 && (
              <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => setSelected(new Set(fixableOpen.map((finding) => finding.fingerprint)))}>
                Select all fixable ({fixableOpen.length})
              </button>
            )}
            <label className="row muted" style={{ gap: 6, fontSize: 11.5 }}>
              <input type="checkbox" checked={showDismissed} onChange={(event) => setShowDismissed(event.target.checked)} />
              Show dismissed
            </label>
          </div>

          {SEVERITY_ORDER.map((severity) => {
            const group = findings.filter((finding) => finding.severity === severity);
            if (group.length === 0) return null;
            return (
              <div key={severity} className="col" style={{ gap: 6 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{SEVERITY_LABEL[severity]} · {group.length}</div>
                {group.map((finding) => (
                  <div key={finding.fingerprint} className="row" style={{ gap: 8, alignItems: "flex-start", opacity: finding.status === "dismissed" ? 0.55 : 1 }}>
                    <input
                      type="checkbox"
                      aria-label={`Select fix for ${finding.title}`}
                      disabled={!finding.fix || finding.status !== "open"}
                      checked={selected.has(finding.fingerprint)}
                      onChange={() => toggle(finding)}
                      style={{ marginTop: 3 }}
                    />
                    <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <span className={`chip ${SEVERITY_CHIP[severity]}`} style={{ height: 18, fontSize: 10 }}>{finding.code.replace(/_/g, " ").toLowerCase()}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{finding.title}</span>
                        {finding.status === "proposed" && <span className="chip chip-slate" style={{ height: 18, fontSize: 10 }}>fix proposed</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{finding.detail}</div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                        <strong>Next step:</strong> {finding.remediation}
                        {finding.fix && finding.status === "open" ? <span className="muted"> (auto-fix: {finding.fix.description})</span> : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={busy !== null}
                      onClick={() => void run(finding.fingerprint, async () => {
                        await setAssessmentFindingDismissed(repositoryId, finding.fingerprint, finding.status !== "dismissed");
                        return finding.status === "dismissed" ? "Finding restored." : "Finding dismissed. It stays dismissed on future syncs.";
                      })}
                    >
                      {finding.status === "dismissed" ? "Restore" : "Dismiss"}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}

      {history.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Recent proposals</div>
          {history.map((proposal) => (
            <div key={proposal.id} className="row" style={{ gap: 8, fontSize: 12, flexWrap: "wrap" }}>
              <span className={`chip ${PROPOSAL_STATUS[proposal.status].chip}`} style={{ height: 18, fontSize: 10 }}>{PROPOSAL_STATUS[proposal.status].label}</span>
              <span>{proposal.title}</span>
              {proposal.pullRequestUrl && <a href={proposal.pullRequestUrl} target="_blank" rel="noreferrer">#{proposal.pullRequestNumber}</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
