import type { ReactNode } from "react";

import { Ic } from "@/components/savant/icons";

type Tile = {
  icon: ReactNode;
  title: string;
  body: string;
  meta: string[];
  status: string;
};

const TILES: Tile[] = [
  {
    icon: <Ic.Repo style={{ width: 18, height: 18 }} />,
    title: "Repositories as the source of truth",
    body: "Your Git repo holds the skill content; Savant references it and never copies. Webhook sync keeps everything live across GitHub, GitLab, Azure DevOps, and Bitbucket.",
    meta: ["webhook sync", "branch-protected", "source of truth"],
    status: "in sync",
  },
  {
    icon: <Ic.Eval style={{ width: 18, height: 18 }} />,
    title: "Evaluations",
    body: "Every candidate runs against a rubric the moment it lands. Regressions are flagged before the approval round even starts.",
    meta: ["rubric checked-in", "deltas vs baseline", "approval-blocking"],
    status: "running",
  },
  {
    icon: <Ic.Policy style={{ width: 18, height: 18 }} />,
    title: "Approvals & policy as code",
    body: "Tier-based policies decide who approves what — owner, security, compliance. Codified once in the repo, enforced at every release.",
    meta: ["tiered approvals", "policy.yaml", "audit-bound"],
    status: "enforced",
  },
  {
    icon: <Ic.Release style={{ width: 18, height: 18 }} />,
    title: "Releases with a lifecycle rail",
    body: "Promote through draft → staging → production along a single observable rail. Auto-pin on regression. Rollback is one click.",
    meta: ["staging burn-in", "signed releases", "1-click rollback"],
    status: "stable",
  },
  {
    icon: <Ic.Audit style={{ width: 18, height: 18 }} />,
    title: "Audit",
    body: "Immutable record of every governance event. Exportable for compliance. Stream to SIEM.",
    meta: ["7-year retention", "SIEM stream", "immutable log"],
    status: "append-only",
  },
  {
    icon: <Ic.Connectors style={{ width: 18, height: 18 }} />,
    title: "Distribution",
    body: "Approved skills flow to managed sync agents, native integrations, and downstream release hooks without forking the source of truth.",
    meta: ["managed sync", "native integrations", "release hooks"],
    status: "fan-out",
  },
];

export function CapabilitySurface() {
  return (
    <div className="cap-surface">
      {TILES.map((t, i) => (
        <article
          key={t.title}
          className="cap-row"
          data-reveal
          data-reveal-delay={Math.min(i, 5)}
        >
          <div className="cap-row-index">/{String(i + 1).padStart(2, "0")}</div>
          <div className="cap-row-main">
            <div className="cap-row-titleline">
              <div className="cap-row-icon">{t.icon}</div>
              <h3>{t.title}</h3>
            </div>
            <p>{t.body}</p>
          </div>
          <div className="cap-row-meta">
            <span className="cap-row-status">{t.status}</span>
            <div className="cap-row-tags">
              {t.meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
