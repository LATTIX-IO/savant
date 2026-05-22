"use client";

import type { Route } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type {
  OverviewKpi,
  OverviewPayload,
  ReleaseQueueItem as ReleaseQueueRecord,
} from "@savant/types";

import { Ic, ProviderIcon } from "@/components/savant/icons";
import {
  CommitRef,
  Delta,
  EnvPill,
  Tier,
} from "@/components/savant/primitives";
import { useOnboarding } from "@/components/savant/onboarding-context";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import type { AuthOverview } from "@/lib/auth0-session";

function kpiByKey(overview: OverviewPayload, key: OverviewKpi["key"]): OverviewKpi {
  return overview.kpis.find((item) => item.key === key) ?? {
    key,
    label: key,
    value: 0,
    deltaLabel: "No data yet",
    trend: "flat",
  };
}

function renderInlineEmptyState(message: string) {
  return (
    <div className="note brass">
      <Ic.Warn className="n-icon" />
      <span>{message}</span>
    </div>
  );
}

export function OverviewScreen({ auth, overview }: { auth: AuthOverview; overview: OverviewPayload }) {
  const { show } = useOnboarding();
  const pathname = usePathname() || "/";
  const skillsHref = buildTenantAwareAppPath(pathname, "/skills") as Route;
  const evaluationsHref = buildTenantAwareAppPath(pathname, "/evaluations") as Route;
  const auditHref = buildTenantAwareAppPath(pathname, "/audit") as Route;
  const skillsInProduction = kpiByKey(overview, "skills-in-production");
  const evalCoverage = kpiByKey(overview, "eval-coverage");
  const firstPassAcceptance = kpiByKey(overview, "first-pass-acceptance");
  const releaseTurnaround = kpiByKey(overview, "release-turnaround");

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/00</span>
            <span className="sep">—</span>
            <span>Overview</span>
          </div>
          <h1 className="h-display">The state of every governed skill, in one place.</h1>
          <div className="page-head-sub">
            {overview.counts.skillsUnderGovernance} skills under governance. {overview.counts.pendingApprovals} candidates awaiting approval. {overview.counts.activeRegressionAlerts} regression alerts currently require attention.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost">
            <Ic.Refresh className="b-icon" />
            <span>Resync repositories</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={show}>
            <Ic.Plus className="b-icon" />
            <span>Connect repository</span>
          </button>
        </div>
      </div>

      <AuthStatusPanel auth={auth} />

      <div className="kpi-strip" style={{ marginBottom: 24 }}>
        <div className="kpi">
          <div className="kpi-label">{skillsInProduction.label}</div>
          <div className="kpi-value num">{skillsInProduction.value}</div>
          <div className={`kpi-trend ${skillsInProduction.trend}`}>{skillsInProduction.deltaLabel}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{evalCoverage.label}</div>
          <div className="kpi-value num">
            {evalCoverage.value}<span style={{ fontSize: 16, color: "var(--muted)" }}>{evalCoverage.unit ?? ""}</span>
          </div>
          <div className={`kpi-trend ${evalCoverage.trend}`}>{evalCoverage.deltaLabel}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{firstPassAcceptance.label}</div>
          <div className="kpi-value num">
            {firstPassAcceptance.value}<span style={{ fontSize: 16, color: "var(--muted)" }}>{firstPassAcceptance.unit ?? ""}</span>
          </div>
          <div className={`kpi-trend ${firstPassAcceptance.trend}`}>{firstPassAcceptance.deltaLabel}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{releaseTurnaround.label}</div>
          <div className="kpi-value num">
            {releaseTurnaround.value}<span style={{ fontSize: 16, color: "var(--muted)" }}>{releaseTurnaround.unit ?? ""}</span>
          </div>
          <div className={`kpi-trend ${releaseTurnaround.trend}`}>{releaseTurnaround.deltaLabel}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd">
              <div className="row" style={{ gap: 10 }}>
                <div className="panel-title">Awaiting approval</div>
                <span className="chip chip-brass">
                  <span className="dot" />
                  {overview.counts.pendingApprovals} pending
                </span>
              </div>
              <div className="panel-actions">
                <Link className="btn btn-sm" href={skillsHref}>
                  View all
                  <Ic.ChevR className="b-icon" />
                </Link>
              </div>
            </div>
            <div className="panel-bd tight">
              {overview.approvals.length === 0 ? renderInlineEmptyState("No approvals are pending for this workspace.") : (
                <table className="tbl">
                  <tbody>
                    {overview.approvals.map((approval) => {
                      const skillHref = buildTenantAwareAppPath(pathname, `/skills/${encodeURIComponent(approval.id)}`) as Route;

                      return (
                        <tr key={`${approval.id}-${approval.version}`}>
                          <td style={{ width: "42%" }}>
                            <Link href={skillHref} className="tbl-name" style={{ color: "inherit" }}>
                              <div className="tbl-name-text">
                                <span className="pri">{approval.skill}</span>
                                <span className="sec">{approval.change}</span>
                              </div>
                            </Link>
                          </td>
                          <td>
                            <Tier n={parseInt(approval.tier.slice(1), 10)} />
                          </td>
                          <td className="mono num" style={{ color: "var(--ink-3)" }}>
                            {approval.version}
                          </td>
                          <td>
                            <span className="chip chip-paper">
                              <Ic.Lock style={{ width: 10, height: 10 }} />
                              {approval.blocking}
                            </span>
                          </td>
                          <td className="subtle" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {approval.when}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Recently changed</div>
              <div className="panel-actions">
                <span className="subtle" style={{ fontSize: 11.5 }}>
                  Last 24h
                </span>
              </div>
            </div>
            <div className="panel-bd tight">
              {overview.recentChanges.length === 0 ? renderInlineEmptyState("No recent indexed changes have been recorded yet.") : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Skill</th>
                      <th>Commit</th>
                      <th>Author</th>
                      <th>Channel</th>
                      <th style={{ textAlign: "right" }}>Δ score</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recentChanges.map((change, index) => (
                      <tr key={`${change.skill}-${index}`}>
                        <td>
                          <span className="skill-name">{change.skill}</span>
                        </td>
                        <td>
                          <CommitRef commit={change.ref} />
                        </td>
                        <td className="muted">{change.who}</td>
                        <td>
                          <EnvPill env={change.env} />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <Delta v={change.delta === "flat" ? "flat" : parseFloat(change.delta)} />
                        </td>
                        <td className="subtle" style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                          {change.when}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="row" style={{ gap: 10 }}>
                <div className="panel-title">Regression alerts</div>
                <span className="chip chip-blood">
                  <Ic.Warn style={{ width: 10, height: 10 }} />{overview.counts.activeRegressionAlerts} active
                </span>
              </div>
              <div className="panel-actions">
                <Link className="btn btn-sm" href={evaluationsHref}>
                  Open eval dashboard
                  <Ic.ChevR className="b-icon" />
                </Link>
              </div>
            </div>
            <div className="panel-bd">
              {overview.regressions.length === 0 ? renderInlineEmptyState("No active regression alerts are open for this workspace.") : (
                <div className="col" style={{ gap: 10 }}>
                  {overview.regressions.map((regression, index) => (
                    <div
                      key={`${regression.skill}-${index}`}
                      className="row between"
                      style={{
                        padding: "10px 12px",
                        border: "1px solid var(--rule)",
                        borderRadius: 5,
                        background: "var(--linen)",
                      }}
                    >
                      <div className="col" style={{ gap: 2 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="skill-name">{regression.skill}</span>
                          <span className="dot-sep">·</span>
                          <span className="muted" style={{ fontSize: 12.5 }}>
                            {regression.metric}
                          </span>
                        </div>
                        <div className="row" style={{ gap: 10, fontSize: 11.5 }}>
                          <span className="mono subtle">
                            {regression.from}
                            {regression.unit || ""}
                          </span>
                          <Ic.Arrow style={{ width: 10, height: 10, color: "var(--faint)" }} />
                          <span className="mono" style={{ color: "var(--oxblood)" }}>
                            {regression.to}
                            {regression.unit || ""}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`chip ${
                          regression.severity === "critical"
                            ? "chip-blood"
                            : regression.severity === "moderate"
                              ? "chip-brass"
                              : "chip-paper"
                        }`}
                      >
                        {regression.severity}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd">
              <div className="row" style={{ gap: 10 }}>
                <div className="panel-title">Repositories</div>
                <span className="subtle" style={{ fontSize: 11.5 }}>
                  {overview.counts.connectedRepositories} connected
                </span>
              </div>
              <div className="panel-actions">
                <button type="button" className="btn btn-sm" onClick={show}>
                  <Ic.Plus className="b-icon" />
                  Add
                </button>
              </div>
            </div>
            <div className="panel-bd tight">
              {overview.repositories.length === 0 ? renderInlineEmptyState("No repositories are connected to this workspace yet.") : (
                <div className="list">
                  {overview.repositories.map((repository) => (
                    <div className="list-item" key={repository.id}>
                      <ProviderIcon p={repository.provider} size={14} />
                      <div className="col" style={{ gap: 2, minWidth: 0 }}>
                        <div
                          className="li-pri mono"
                          style={{
                            fontSize: 12.5,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {repository.name}
                        </div>
                        <div className="li-sec">
                          <Ic.Branch
                            style={{ width: 9, height: 9, display: "inline", verticalAlign: "-1px", marginRight: 3 }}
                          />
                          {repository.branch} · {repository.skills} skills
                        </div>
                      </div>
                      <div className="row" style={{ marginLeft: "auto", gap: 8 }}>
                        {repository.status === "warn" ? (
                          <span className="chip chip-brass">attention</span>
                        ) : repository.status === "stale" ? (
                          <span className="chip chip-blood">offline</span>
                        ) : null}
                        <span className="subtle" style={{ fontSize: 11 }}>
                          {repository.lastSync}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Audit highlights</div>
              <Link className="btn btn-sm" href={auditHref}>
                Full log
                <Ic.ExternalLink className="b-icon" />
              </Link>
            </div>
            <div className="panel-bd">
              {overview.auditHighlights.length === 0 ? renderInlineEmptyState("No tenant audit events have been recorded yet.") : (
                <div className="tl">
                  {overview.auditHighlights.map((event, index) => (
                    <div className="tl-item" key={`${event.target}-${index}`}>
                      <span className={`tl-node ${event.node}`} />
                      <div>
                        <div className="tl-pri">
                          <b>{event.who}</b> <span className="muted">{event.action.toLowerCase()}</span>{" "}
                          <span>{event.target}</span>
                        </div>
                      </div>
                      <div className="tl-meta">{event.when}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Release queue</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>
                Next 24h
              </span>
            </div>
            <div className="panel-bd">
              {overview.releaseQueue.length === 0 ? renderInlineEmptyState("No releases are queued for this workspace right now.") : (
                <div className="col" style={{ gap: 12 }}>
                  {overview.releaseQueue.map((item) => (
                    <ReleaseQueueCard key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthStatusPanel({ auth }: { auth: AuthOverview }) {
  if (!auth.viewer.isAuthenticated) {
    return (
      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-hd">
          <div>
            <div className="panel-title">Authentication</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              Auth0 is wired into this Next.js 16 app using the official server-side session SDK.
            </div>
          </div>
          <span className="chip chip-paper">Auth0 · ready</span>
        </div>
        <div className="panel-bd">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div className="col" style={{ gap: 4 }}>
              <div className="skill-name" style={{ fontSize: 13 }}>
                You&apos;re browsing Savant as a guest.
              </div>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                Use the sign-in and sign-up entry pages below to test Universal Login,
                callback handling, and logout from the dashboard.
              </div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <a href="/signup" className="btn btn-sm">
                Sign up
              </a>
              <a href="/signin" className="btn btn-sm">
                Log in
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <div className="panel-hd">
        <div>
          <div className="panel-title">Authentication</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            Auth0 session active. The profile below is coming from the server-side session.
          </div>
        </div>
        <span className="chip chip-moss">
          <span className="dot" />
          session active
        </span>
      </div>
      <div className="panel-bd">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 16,
            alignItems: "flex-start",
          }}
        >
          <div className="col" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <span className="avatar sm">{auth.viewer.initials}</span>
              <div className="col" style={{ gap: 2 }}>
                <div className="skill-name" style={{ fontSize: 13.5 }}>
                  {auth.viewer.displayName}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {auth.viewer.subtitle}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {auth.fields.map((field) => (
                <span key={field.label} className="ref">
                  {field.label}: {field.value}
                </span>
              ))}
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a href="/auth/profile" className="btn btn-sm" target="_blank" rel="noreferrer">
              Profile JSON
            </a>
            <a href="/auth/logout" className="btn btn-sm">
              Log out
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReleaseQueueCard({ item }: { item: ReleaseQueueRecord }) {
  const stages = ["draft", "staging", "production"];
  const targetIdx = item.toEnv === "staging" ? 1 : item.toEnv === "production" ? 2 : 0;
  const sourceIdx = targetIdx - 1;

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between">
        <div>
          <div className="skill-name" style={{ fontSize: 13 }}>
            {item.skill}
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <CommitRef commit={item.candidateCommit.slice(0, 7)} label={item.candidateRef} />
            <span className="muted" style={{ fontSize: 11.5 }}>
              {item.requested} · {item.when}
            </span>
          </div>
        </div>
        <span className="chip chip-paper" style={{ fontSize: 11 }}>
          {item.approvalsDone}/{item.approvalsRequired || 0} approvals
        </span>
      </div>
      <div className="row" style={{ gap: 0 }}>
        {stages.map((s, i) => (
          <Fragment key={s}>
            <div className="col" style={{ alignItems: "center", gap: 4, flex: 1 }}>
              <div
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background:
                    i <= sourceIdx
                      ? "var(--moss)"
                      : i === targetIdx
                        ? "var(--brass)"
                        : "var(--rule-strong)",
                  outline: i === targetIdx ? "3px solid var(--brass-soft)" : "none",
                  outlineOffset: -1,
                }}
              />
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "var(--track-mini)",
                  textTransform: "uppercase",
                  color:
                    i <= sourceIdx
                      ? "var(--moss-deep)"
                      : i === targetIdx
                        ? "var(--brass-deep)"
                        : "var(--subtle)",
                  fontWeight: 500,
                }}
              >
                {s}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: i < targetIdx ? "var(--moss)" : "var(--rule-2)",
                  marginTop: 4,
                  position: "relative",
                  top: 4,
                }}
              />
            )}
          </Fragment>
        ))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {item.targets.map((target) => (
          <span key={target} className="chip chip-paper" style={{ fontSize: 11 }}>
            {target}
          </span>
        ))}
        {item.approvalsBlocked ? (
          <span className="chip chip-brass" style={{ fontSize: 11 }}>
            blocked by {item.approvalsBlocked}
          </span>
        ) : null}
      </div>
    </div>
  );
}
