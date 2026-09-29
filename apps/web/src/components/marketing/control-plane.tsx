"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import { SavantIcon } from "@/components/brand/savant-icon";
import { trackMarketingEvent } from "@/lib/marketing-analytics";

type TabKey = "changes" | "approvals" | "audit";

const TABS: { key: TabKey; label: string }[] = [
  { key: "changes", label: "Recent changes" },
  { key: "approvals", label: "Approval queue" },
  { key: "audit", label: "Audit" },
];

type ChangeRow = {
  skill: string;
  delta?: string;
  version: string;
  state: "candidate" | "regression" | "staged" | "production";
  when: string;
};

const CHANGES: ChangeRow[] = [
  { skill: "Architecture Review", delta: "+4.8", version: "v2.5.0", state: "candidate", when: "4m" },
  { skill: "Incident Triage", version: "v3.1.0", state: "regression", when: "26m" },
  { skill: "Proposal Response", delta: "+3.1", version: "v1.9.0", state: "staged", when: "1h" },
  { skill: "Engineering RFC Reviewer", delta: "+2.1", version: "v4.0.2", state: "production", when: "3h" },
];

const STATE_LABEL: Record<ChangeRow["state"], string> = {
  candidate: "Candidate",
  regression: "Regression detected",
  staged: "Staged",
  production: "Production",
};

const APPROVALS = [
  { skill: "Architecture Review", tier: 1, waiting: "Security review", age: "8m" },
  { skill: "Contract Clause Reviewer", tier: 1, waiting: "Compliance", age: "44m" },
  { skill: "PR Summarizer", tier: 2, waiting: "Skill owner", age: "1h" },
  { skill: "RFP Response Drafter", tier: 2, waiting: "Skill owner", age: "2h" },
];

const AUDIT = [
  { who: "ari.chen", action: "promoted", target: "Engineering RFC Reviewer → production", when: "12m" },
  { who: "policy", action: "held release", target: "Incident Triage v3.1.0 · latency regression", when: "26m" },
  { who: "okta scim", action: "synced", target: "3 members → legal-reviewers", when: "1h" },
  { who: "jdv", action: "rolled back", target: "Incident Triage → v3.0.4", when: "3h" },
];

// Weekly eval-health samples for the sparkline (percent).
const HEALTH = [88, 89, 88, 90, 91, 90, 92, 92, 93, 93, 94, 94];

export function ControlPlane() {
  const [tab, setTab] = useState<TabKey>("changes");
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (key: TabKey) => {
    if (key === tab) return;
    setTab(key);
    trackMarketingEvent("product_demo_interaction", { tab: key });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (event.key === "Home" || event.key === "End" || delta !== 0) {
      event.preventDefault();
      const next =
        event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + delta + TABS.length) % TABS.length;
      const target = TABS[next];
      if (!target) return;
      select(target.key);
      tabRefs.current[next]?.focus();
    }
  };

  const min = Math.min(...HEALTH) - 2;
  const max = Math.max(...HEALTH);

  return (
    <div className="cp" role="group" aria-label="Savant workspace preview (interactive demo)">
      <div className="cp-bar">
        <div className="cp-brand">
          <SavantIcon size={18} />
          <span>Savant</span>
          <span className="cp-crumb">acme / platform</span>
        </div>
        <span className="cp-env">
          <span className="cp-env-dot" aria-hidden="true" />
          Production
        </span>
      </div>

      <div className="cp-top">
        <div className="cp-cell">
          <div className="cp-cell-label">Skill health</div>
          <div className="cp-figure">
            <span className="num">94</span>
            <span className="cp-figure-unit">%</span>
          </div>
          <div className="cp-cell-meta">Eval pass rate · 147 skills in production</div>
          <svg className="cp-spark" viewBox="0 0 120 32" aria-hidden="true" preserveAspectRatio="none">
            {HEALTH.map((value, i) => {
              const h = ((value - min) / (max - min)) * 28 + 4;
              return <rect key={i} x={i * 10} y={32 - h} width={6} height={h} data-last={i === HEALTH.length - 1} />;
            })}
          </svg>
        </div>
        <div className="cp-cell">
          <div className="cp-cell-label">Approval queue</div>
          <div className="cp-figure">
            <span className="num">4</span>
            <span className="cp-figure-text">awaiting review</span>
          </div>
          <div className="cp-cell-meta">2 tier-1 · oldest 2h · none past SLA</div>
          <div className="cp-queue" aria-hidden="true">
            {APPROVALS.map((a) => (
              <span key={a.skill} data-tier={a.tier} />
            ))}
          </div>
        </div>
      </div>

      <div className="cp-tabs" role="tablist" aria-label="Workspace activity">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`${baseId}-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${baseId}-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => select(t.key)}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id={`${baseId}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="cp-panel"
        tabIndex={0}
      >
        {tab === "changes" ? (
          <table className="cp-table">
            <thead>
              <tr>
                <th scope="col">Skill</th>
                <th scope="col">Δ quality</th>
                <th scope="col">Version</th>
                <th scope="col">State</th>
                <th scope="col" className="cp-when">When</th>
              </tr>
            </thead>
            <tbody>
              {CHANGES.map((row) => (
                <tr key={row.skill} data-state={row.state}>
                  <th scope="row">{row.skill}</th>
                  <td className="num cp-delta">{row.delta ?? "—"}</td>
                  <td className="num">{row.version}</td>
                  <td>
                    <span className="cp-state" data-state={row.state}>
                      {row.state === "regression" ? <span className="cp-state-mark" aria-hidden="true">!</span> : null}
                      {STATE_LABEL[row.state]}
                    </span>
                  </td>
                  <td className="cp-when">{row.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === "approvals" ? (
          <table className="cp-table">
            <thead>
              <tr>
                <th scope="col">Skill</th>
                <th scope="col">Tier</th>
                <th scope="col">Waiting on</th>
                <th scope="col" className="cp-when">Age</th>
              </tr>
            </thead>
            <tbody>
              {APPROVALS.map((row) => (
                <tr key={row.skill}>
                  <th scope="row">{row.skill}</th>
                  <td>
                    <span className="cp-tier">T{row.tier}</span>
                  </td>
                  <td>{row.waiting}</td>
                  <td className="cp-when">{row.age}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === "audit" ? (
          <ol className="cp-audit">
            {AUDIT.map((event) => (
              <li key={event.target}>
                <span className="cp-audit-who">{event.who}</span>
                <span className="cp-audit-what">
                  {event.action} <span>{event.target}</span>
                </span>
                <span className="cp-when">{event.when}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
