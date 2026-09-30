"use client";

import type { AssessmentFinding, ChangeProposal } from "@savant/types";
import { useEffect, useState } from "react";

import { approveChangeProposal, fetchSkillAssessment, proposeAssessmentFixes, rejectChangeProposal } from "@/lib/git-connections-client";
import { extractWorkspaceSlugFromPathname } from "@/lib/tenant-paths";

const CHIP: Record<AssessmentFinding["severity"], string> = { blocker: "chip-blood", warning: "chip-brass", info: "chip-paper" };

function repositoriesHref(): string {
  const slug = typeof window === "undefined" ? null : extractWorkspaceSlugFromPathname(window.location.pathname);
  return slug ? `/o/${encodeURIComponent(slug)}/repositories` : "/repositories";
}

/** Assessment findings for this skill from its repository's latest post-sync assessment. */
export function SkillAssessmentFindings({ skillId, refreshToken }: { skillId: string; refreshToken: number }) {
  const [findings, setFindings] = useState<AssessmentFinding[] | null>(null);
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ChangeProposal | null>(null);
  const [message, setMessage] = useState<{ tone: "default" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSkillAssessment(skillId)
      .then((response) => {
        if (active) {
          setFindings(response.data.findings.filter((finding) => finding.status !== "dismissed"));
          setRepositoryId(response.data.repositoryId);
        }
      })
      .catch(() => {
        if (active) setFindings([]);
      });
    return () => {
      active = false;
    };
  }, [skillId, refreshToken]);

  if (!findings || findings.length === 0) {
    return null;
  }

  const fixable = findings.filter((finding) => finding.fix && finding.status === "open");

  async function proposeAll() {
    if (!repositoryId) return;
    setBusy(true);
    try {
      const response = await proposeAssessmentFixes(repositoryId, fixable.map((finding) => finding.fingerprint));
      setProposal(response.data);
      setMessage({ tone: "default", text: `Proposed ${response.data.files.length} file change${response.data.files.length === 1 ? "" : "s"}. Approve to open a pull request.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The fix could not be proposed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-hd">
        <div className="panel-title">Needs attention · {findings.length}</div>
        <div className="row" style={{ gap: 6 }}>
          {fixable.length > 0 && !proposal && (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !repositoryId} onClick={() => void proposeAll()}>
              {busy ? "Preparing…" : `Propose fix${fixable.length > 1 ? `es (${fixable.length})` : ""}`}
            </button>
          )}
          <a className="btn btn-sm btn-ghost" href={repositoriesHref()}>Repository assessment</a>
        </div>
      </div>
      <div className="panel-bd col" style={{ gap: 8 }}>
        {message && <div className={`note ${message.tone === "error" ? "blood" : ""}`}><span style={{ fontSize: 12.5 }}>{message.text}</span></div>}
        {proposal && <SkillProposalNotice proposal={proposal} onUpdated={setProposal} />}
        {findings.map((finding) => (
          <div key={finding.fingerprint} className="col" style={{ gap: 2 }}>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className={`chip ${CHIP[finding.severity]}`} style={{ height: 18, fontSize: 10 }}>{finding.severity}</span>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{finding.title}</span>
              {finding.status === "proposed" && <span className="chip chip-slate" style={{ height: 18, fontSize: 10 }}>fix proposed</span>}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.4 }}>
              <span className="muted">{finding.detail} </span>
              <strong>Next step:</strong> {finding.remediation}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pending change proposal with approve / reject; approval opens a pull request. */
export function SkillProposalNotice({ proposal, onUpdated }: { proposal: ChangeProposal; onUpdated: (proposal: ChangeProposal) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: typeof approveChangeProposal) {
    setBusy(true);
    setError(null);
    try {
      onUpdated((await action(proposal.id)).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="note" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, marginBottom: 12 }}>
      <div style={{ fontSize: 12.5 }}>
        <strong>{proposal.title}</strong> · {proposal.files.map((file) => file.path).join(", ")}
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--blood, #a33)" }}>{error}</div>}
      {proposal.pullRequestUrl ? (
        <a className="btn btn-sm" href={proposal.pullRequestUrl} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
          View pull request #{proposal.pullRequestNumber}
        </a>
      ) : proposal.status === "rejected" ? (
        <span className="muted" style={{ fontSize: 12 }}>Rejected — nothing was written to the repository.</span>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act(approveChangeProposal)}>
            {busy ? "Opening pull request…" : "Approve & open pull request"}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void act(rejectChangeProposal)}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
