"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Ic, ProviderIcon } from "@/components/savant/icons";
import {
  CommitRef,
  Delta,
  EnvPill,
  ProvenanceRail,
  type ProvenanceStep,
  ScoreBar,
  Tier,
} from "@/components/savant/primitives";
import {
  APPROVAL_TIMELINE,
  COMMENTS,
  RUBRIC_BASELINE,
  SKILLS,
  type Skill,
} from "@/lib/savant-data";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";

type TabKey = "evaluation" | "versions" | "access" | "activity";

export function SkillScreen({ skillId }: { skillId: string }) {
  const skill = SKILLS.find((s) => s.id === skillId) ?? SKILLS[0]!;
  const [tab, setTab] = useState<TabKey>("evaluation");
  const baselineScore = skill.score ?? 0;
  const pathname = usePathname() || "/";
  const catalogHref = buildTenantAwareAppPath(pathname, "/skills") as Route;

  const railSteps: ProvenanceStep[] = [
    {
      label: "Repository",
      value: skill.repo,
      meta: (
        <span className="row" style={{ gap: 4 }}>
          <ProviderIcon p={skill.repoProvider} size={9} />
          <span className="muted">{skill.repoProvider}</span>
        </span>
      ),
      state: "ok",
    },
    {
      label: "Reference",
      value: skill.candidateRef !== "—" ? skill.candidateRef : skill.ref,
      meta: (
        <span className="mono subtle" style={{ fontSize: 10.5 }}>
          {skill.candidateCommit !== "—" ? skill.candidateCommit : skill.commit} · {skill.branch}
        </span>
      ),
      state: "ok",
    },
    {
      label: "Evaluation",
      value: skill.status.startsWith("candidate-running")
        ? "Running · 184 / 248"
        : "248 cases · 6 flagged",
      meta: (
        <span className="muted">
          Baseline {skill.score?.toFixed(1) ?? "—"} → cand {(baselineScore + 0.6).toFixed(1)}
        </span>
      ),
      state: "warn",
    },
    {
      label: "Approval",
      value: "2 of 3 approved",
      meta: <span className="muted">awaiting compliance</span>,
      state: "now",
    },
    {
      label: "Release",
      value: skill.channel === "production" ? `Production · ${skill.ref}` : "Not released",
      meta: (
        <span className="muted">
          {skill.channel === "production" ? "Pinned 2d ago" : "Promote after approval"}
        </span>
      ),
      state: skill.channel === "production" ? "ok" : "",
    },
  ];

  return (
    <div className="page-inner">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="page-head-meta">
            <Link href={catalogHref} className="link">
              Catalog
            </Link>
            <span className="sep">/</span>
            <span>{skill.team}</span>
            <span className="sep">/</span>
            <span>Tier {skill.tier}</span>
          </div>
          <div className="row" style={{ gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
            <h1 className="h-display">{skill.name}</h1>
            <Tier n={skill.tier} />
            <EnvPill env={skill.channel} />
          </div>
          <div className="page-head-sub">{skill.description}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost">
            <Ic.ExternalLink className="b-icon" />
            View in {skill.repoProvider}
          </button>
          <button type="button" className="btn btn-danger">
            Reject candidate
          </button>
          <button type="button" className="btn btn-brass">
            <Ic.Check className="b-icon" />
            Approve for release
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Lifecycle
        </div>
        <ProvenanceRail steps={railSteps} />
      </div>

      <div
        style={{
          borderBottom: "1px solid var(--rule)",
          marginBottom: 20,
          display: "flex",
          gap: 0,
        }}
      >
        {(
          [
            ["evaluation", "Evaluation", "6 regressions"],
            ["versions", "Versions", `${skill.versionCount}`],
            ["access", "Access"],
            ["activity", "Activity"],
          ] as Array<[TabKey, string, string?]>
        ).map(([k, label, badge]) => (
          <div
            key={k}
            onClick={() => setTab(k)}
            className={`tab ${tab === k ? "active" : ""}`}
            style={{ padding: "0 18px" }}
          >
            <span>{label}</span>
            {badge ? <span className="tab-count">{badge}</span> : null}
          </div>
        ))}
      </div>

      {tab === "evaluation" && <EvalTab skill={skill} />}
      {tab === "versions" && <VersionsTab skill={skill} />}
      {tab === "access" && <AccessTab />}
      {tab === "activity" && <ActivityTab />}
    </div>
  );
}

function EvalTab({ skill }: { skill: Skill }) {
  const overallDelta = +0.6;
  const baselineScore = skill.score ?? 0;
  return (
    <div className="split wide">
      <div className="col" style={{ gap: "var(--gutter)", minWidth: 0 }}>
        <div className="note brass">
          <Ic.Warn className="n-icon" />
          <div className="grow">
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--brass-deep)" }}>
              Candidate introduces 2 regressions and 4 improvements over baseline.
            </div>
            <div
              style={{ fontSize: 12, color: "var(--brass-deep)", opacity: 0.8, marginTop: 2 }}
            >
              Eval set: <span className="mono">contract-corpus-v9.eval</span> · 248 cases · ran 58m
              ago · 24s
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: "var(--panel)", borderColor: "var(--rule-2)" }}
          >
            View regressions <Ic.ChevR className="b-icon" />
          </button>
        </div>

        <div className="ab">
          <div className="ab-side">
            <div className="ab-head">
              <div className="ab-label">Baseline</div>
              <span className="chip chip-paper">production</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <CommitRef commit={skill.commit} label={skill.ref} />
              <span className="subtle" style={{ fontSize: 11.5 }}>
                shipped 6d ago
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="row" style={{ gap: 14, marginBottom: 8 }}>
                <Score label="Overall" value={baselineScore} />
                <Score label="Pass rate" value={91.3} unit="%" />
                <Score label="Latency p95" value={2.8} unit="s" />
              </div>
              <div className="ab-snippet">{`{
  "summary": "Standard 3-year SaaS NDA. Clauses align with master playbook v6.",
  "risk_flags": [],
  "recommend": "approve"
}`}</div>
            </div>
          </div>
          <div className="ab-side">
            <div className="ab-head">
              <div className="ab-label">Candidate</div>
              <span className="chip chip-brass">awaiting approval</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <CommitRef commit={skill.candidateCommit} label={skill.candidateRef} />
              <span className="subtle" style={{ fontSize: 11.5 }}>
                by {skill.owner} · 1h ago
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="row" style={{ gap: 14, marginBottom: 8 }}>
                <Score label="Overall" value={baselineScore + overallDelta} delta={overallDelta} />
                <Score label="Pass rate" value={93.5} delta={+2.2} unit="%" />
                <Score label="Latency p95" value={3.1} delta={+0.3} unit="s" worseUp />
              </div>
              <div className="ab-snippet">{`{
  "summary": "Standard 3-year SaaS NDA with non-standard mutual indemnity clause (§7.4).",
  "risk_flags": [
    "non-standard indemnity scope — deviates from master playbook v6",
    "auto-renewal language uses 60-day instead of 30-day notice"
  ],
  "recommend": "review"
}`}</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Rubric breakdown</div>
            <div className="row" style={{ gap: 6 }}>
              <span className="row" style={{ gap: 5, fontSize: 11.5, color: "var(--muted)" }}>
                <span style={{ width: 1, height: 10, background: "var(--ink-3)" }} /> baseline
              </span>
              <span
                className="row"
                style={{ gap: 5, fontSize: 11.5, color: "var(--muted)", marginLeft: 12 }}
              >
                <span style={{ width: 8, height: 6, background: "var(--moss)", borderRadius: 2 }} />{" "}
                candidate
              </span>
            </div>
          </div>
          <div className="panel-bd">
            {RUBRIC_BASELINE.map((r, i) => (
              <ScoreBar key={i} {...r} />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="row" style={{ gap: 10 }}>
              <div className="panel-title">Flagged cases</div>
              <span className="chip chip-blood">6 regressions</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn btn-sm">
                Filter
              </button>
              <button type="button" className="btn btn-sm">
                Open in eval ↗
              </button>
            </div>
          </div>
          <div className="panel-bd tight">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Case</th>
                  <th>Description</th>
                  <th>Rubric</th>
                  <th style={{ textAlign: "right" }}>Baseline</th>
                  <th style={{ textAlign: "right" }}>Candidate</th>
                  <th style={{ textAlign: "right" }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                <FlagRow id="0117" desc="Mutual NDA with non-standard indemnity" rubric="Clause extraction precision" b={1.0} c={0.55} />
                <FlagRow id="0142" desc="MSA with custom termination clause" rubric="Clause extraction precision" b={0.94} c={0.71} />
                <FlagRow id="0089" desc="Vendor agreement with auto-renewal language" rubric="Tone compliance" b={0.97} c={0.88} />
                <FlagRow id="0203" desc="Procurement DPA — schedule 3 omitted" rubric="Risk flag recall" b={0.81} c={0.74} />
                <FlagRow id="0226" desc="Non-standard governing law" rubric="Clause extraction precision" b={0.9} c={0.79} />
                <FlagRow id="0234" desc="Indemnity carve-out for IP infringement" rubric="Tone compliance" b={0.96} c={0.91} />
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: "var(--gutter)" }}>
        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Approval timeline</div>
            <span className="chip chip-brass">
              <span className="dot" />
              awaiting compliance
            </span>
          </div>
          <div className="panel-bd">
            <div className="tl">
              {APPROVAL_TIMELINE.map((e, i) => (
                <div className="tl-item" key={i}>
                  <span className={`tl-node ${e.node}`} />
                  <div>
                    <div className="tl-pri">
                      <b>{e.who}</b> <span className="muted">{e.action}</span>
                    </div>
                    <div className="tl-sec">{e.role}</div>
                  </div>
                  <div className="tl-meta">{e.when}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Required approvals</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>
              2 of 3
            </span>
          </div>
          <div className="panel-bd tight">
            <ApprovalRow role="Skill owner" who="ari.chen" status="approved" when="1h ago" />
            <ApprovalRow role="Security" who="sasha.gw" status="approved" when="30m ago" />
            <ApprovalRow role="Compliance" who="—" status="pending" when="—" />
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Reviewer notes</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>
              {COMMENTS.length}
            </span>
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {COMMENTS.map((c, i) => (
              <div key={i} className="col" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="avatar sm">{c.who.slice(0, 2).toUpperCase()}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{c.who}</span>
                  <span className="subtle" style={{ fontSize: 11.5 }}>
                    {c.when}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                    paddingLeft: 28,
                  }}
                >
                  {c.text}
                </div>
              </div>
            ))}
            <textarea
              placeholder="Add a note for reviewers…"
              style={{
                background: "var(--linen)",
                border: "1px solid var(--rule-2)",
                borderRadius: 5,
                padding: "10px 12px",
                fontSize: 12.5,
                resize: "none",
                outline: "none",
                minHeight: 60,
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FlagRow({
  id,
  desc,
  rubric,
  b,
  c,
}: {
  id: string;
  desc: string;
  rubric: string;
  b: number;
  c: number;
}) {
  const delta = c - b;
  return (
    <tr>
      <td>
        <span className="mono num">#{id}</span>
      </td>
      <td>{desc}</td>
      <td className="muted" style={{ fontSize: 12 }}>
        {rubric}
      </td>
      <td className="mono num" style={{ textAlign: "right" }}>
        {b.toFixed(2)}
      </td>
      <td className="mono num" style={{ textAlign: "right", color: "var(--oxblood)" }}>
        {c.toFixed(2)}
      </td>
      <td style={{ textAlign: "right" }}>
        <Delta v={delta * 100} />
      </td>
    </tr>
  );
}

function Score({
  label,
  value,
  delta,
  unit,
  worseUp,
}: {
  label: string;
  value: number;
  delta?: number;
  unit?: string;
  worseUp?: boolean;
}) {
  let deltaColor = "var(--subtle)";
  if (delta != null) {
    const bad = worseUp ? delta > 0 : delta < 0;
    deltaColor = bad ? "var(--oxblood)" : "var(--moss)";
  }
  return (
    <div className="col" style={{ gap: 2 }}>
      <div className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div className="row" style={{ gap: 6, alignItems: "baseline" }}>
        <span className="h-display" style={{ fontSize: 20 }}>
          {value.toFixed(1)}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{unit || ""}</span>
        </span>
        {delta != null && (
          <span className="mono num" style={{ fontSize: 11, color: deltaColor }}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
            {unit || ""}
          </span>
        )}
      </div>
    </div>
  );
}

function ApprovalRow({
  role,
  who,
  status,
  when,
}: {
  role: string;
  who: string;
  status: "approved" | "pending";
  when: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--rule)",
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>{role}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {who === "—" ? "Awaiting reviewer assignment" : who}
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {status === "approved" ? (
          <span className="chip chip-moss">
            <Ic.Check style={{ width: 10, height: 10 }} />
            Approved
          </span>
        ) : (
          <span className="chip chip-brass">
            <Ic.Clock style={{ width: 10, height: 10 }} />
            Pending
          </span>
        )}
        <span
          className="subtle"
          style={{ fontSize: 11.5, width: 56, textAlign: "right" as const }}
        >
          {when}
        </span>
      </div>
    </div>
  );
}

type Version = {
  ref: string;
  commit: string;
  who: string;
  when: string;
  channel: "candidate" | "production" | "archived";
  score: number;
  delta: number;
};

function VersionsTab({ skill }: { skill: Skill }) {
  const versions: Version[] = [
    { ref: "v2.4.0-rc.2", commit: "8a31cf2", who: skill.owner, when: "1h ago", channel: "candidate", score: 92.0, delta: +0.6 },
    { ref: "v2.3.7", commit: "a13f9c2", who: "ari.chen", when: "6d ago", channel: "production", score: 91.4, delta: +0.4 },
    { ref: "v2.3.6", commit: "44dd1ab", who: "ari.chen", when: "11d ago", channel: "production", score: 91.0, delta: +0.7 },
    { ref: "v2.3.5", commit: "c0918dd", who: "kalia.b", when: "18d ago", channel: "archived", score: 90.3, delta: +1.2 },
    { ref: "v2.3.4", commit: "1bea90e", who: "kalia.b", when: "26d ago", channel: "archived", score: 89.1, delta: -0.4 },
    { ref: "v2.3.3", commit: "5fa12bb", who: "ari.chen", when: "32d ago", channel: "archived", score: 89.5, delta: +0.9 },
  ];
  return (
    <div className="panel">
      <div className="panel-hd">
        <div className="panel-title">Version history</div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm">
            Compare versions
          </button>
          <button type="button" className="btn btn-sm">
            Export
          </button>
        </div>
      </div>
      <div className="panel-bd tight">
        <table className="tbl">
          <thead>
            <tr>
              <th>Version</th>
              <th>Commit</th>
              <th>Author</th>
              <th>Channel</th>
              <th>Released</th>
              <th style={{ textAlign: "right" }}>Score</th>
              <th style={{ textAlign: "right" }}>Δ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v, i) => (
              <tr key={i}>
                <td>
                  <span className="mono num" style={{ color: "var(--ink)", fontWeight: 500 }}>
                    {v.ref}
                  </span>
                </td>
                <td>
                  <CommitRef commit={v.commit} />
                </td>
                <td className="muted">{v.who}</td>
                <td>
                  {v.channel === "candidate" ? (
                    <span className="chip chip-brass">candidate</span>
                  ) : v.channel === "production" ? (
                    <EnvPill env="production" />
                  ) : (
                    <span className="chip chip-paper">archived</span>
                  )}
                </td>
                <td className="subtle">{v.when}</td>
                <td className="mono num" style={{ textAlign: "right" }}>
                  {v.score.toFixed(1)}
                </td>
                <td style={{ textAlign: "right" }}>
                  <Delta v={v.delta} />
                </td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn btn-sm">
                    Diff
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccessTab() {
  const groups = [
    { name: "legal-readers", members: 24, perm: "view + use", source: "Okta · synced", last: "12m ago" },
    { name: "legal-owners", members: 6, perm: "edit + review", source: "Okta · synced", last: "1h ago" },
    { name: "platform-admins", members: 3, perm: "approve + release", source: "manual", last: "2d ago" },
    { name: "all-employees", members: 412, perm: "request access", source: "Okta · synced", last: "12m ago" },
  ];
  const pols = [
    { rule: "Cannot be used outside", value: "Production environment" },
    { rule: "Distribution blocked for", value: "Local sync agent (Tier 1 restriction)" },
    { rule: "Required at runtime", value: "User must be member of legal-readers" },
    { rule: "Customer-managed key", value: "Disabled · org-managed key in use" },
  ];
  return (
    <div className="grid-2" style={{ alignItems: "flex-start" }}>
      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Groups with access</div>
          <button type="button" className="btn btn-sm">
            <Ic.Plus className="b-icon" />
            Add group
          </button>
        </div>
        <div className="panel-bd tight">
          <table className="tbl">
            <thead>
              <tr>
                <th>Group</th>
                <th>Members</th>
                <th>Permissions</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Last sync</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={i}>
                  <td>
                    <span className="mono" style={{ color: "var(--ink)" }}>
                      {g.name}
                    </span>
                  </td>
                  <td className="num">{g.members}</td>
                  <td className="muted">{g.perm}</td>
                  <td>
                    <span className="chip chip-paper">{g.source}</span>
                  </td>
                  <td className="subtle" style={{ textAlign: "right" }}>
                    {g.last}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Access policy</div>
          <button type="button" className="btn btn-sm">
            Edit policy
          </button>
        </div>
        <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pols.map((p, i) => (
            <div
              key={i}
              style={{
                padding: "10px 12px",
                border: "1px solid var(--rule)",
                borderRadius: 4,
                background: "var(--linen)",
              }}
            >
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 3 }}>
                {p.rule}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{p.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityTab() {
  const events: Array<{ when: string; who: string; action: string; target: ReactNode; node: "moss" | "brass" | "blood" | "slate" }> = [
    { when: "8m ago", who: "compliance", action: "Held approval", target: "candidate v2.4.0-rc.2", node: "brass" },
    { when: "30m ago", who: "sasha.gw", action: "Approved", target: "security review", node: "moss" },
    { when: "58m ago", who: "eval-runner", action: "Completed eval", target: "248 cases · 24s", node: "slate" },
    { when: "1h ago", who: "ari.chen", action: "Submitted candidate", target: "v2.4.0-rc.2", node: "slate" },
    { when: "6d ago", who: "ari.chen", action: "Released", target: "v2.3.7 → production", node: "moss" },
    { when: "6d ago", who: "compliance", action: "Approved", target: "v2.3.7", node: "moss" },
    { when: "7d ago", who: "sasha.gw", action: "Approved", target: "v2.3.7", node: "moss" },
    { when: "8d ago", who: "eval-runner", action: "Completed eval", target: "v2.3.7-rc.1 · 246 cases", node: "slate" },
    { when: "11d ago", who: "ari.chen", action: "Released", target: "v2.3.6 → production", node: "moss" },
  ];
  return (
    <div className="panel">
      <div className="panel-hd">
        <div className="panel-title">Activity log</div>
        <button type="button" className="btn btn-sm">
          Export log
        </button>
      </div>
      <div className="panel-bd">
        <div className="tl">
          {events.map((e, i) => (
            <div className="tl-item" key={i}>
              <span className={`tl-node ${e.node}`} />
              <div>
                <div className="tl-pri">
                  <b>{e.who}</b> <span className="muted">{e.action.toLowerCase()}</span> {e.target}
                </div>
              </div>
              <div className="tl-meta">{e.when}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
