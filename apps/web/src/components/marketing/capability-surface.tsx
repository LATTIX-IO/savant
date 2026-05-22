import { Ic, ProviderIcon } from "@/components/savant/icons";
import {
  PLATFORM_PREVIEW_APPROVALS,
  PLATFORM_PREVIEW_AUDIT,
  PLATFORM_PREVIEW_NAV,
  PLATFORM_PREVIEW_KPIS,
  PLATFORM_PREVIEW_RECENT_CHANGES,
  PLATFORM_PREVIEW_REGRESSIONS,
  PLATFORM_PREVIEW_RELEASE_QUEUE,
  PLATFORM_PREVIEW_REPOSITORIES,
  type PlatformPreviewIconKey,
} from "@/components/marketing/capability-surface.data";

const NAV_ICONS: Record<PlatformPreviewIconKey, typeof Ic.Overview> = {
  overview: Ic.Overview,
  skills: Ic.Skills,
  repo: Ic.Repo,
  eval: Ic.Eval,
  release: Ic.Release,
  policy: Ic.Policy,
  audit: Ic.Audit,
  connectors: Ic.Connectors,
};

const ENV_PILL_CLASS: Record<string, string> = {
  draft: "chip chip-paper",
  staging: "chip chip-brass",
  production: "chip chip-moss",
};

const REGRESSION_SEVERITY_CLASS: Record<string, string> = {
  critical: "chip chip-blood",
  moderate: "chip chip-brass",
  minor: "chip chip-paper",
};

function PreviewCommitRef({ commit, label }: { commit: string; label?: string }) {
  return (
    <span className="ref">
      <Ic.Commit className="ref-icon" />
      <span>{label ?? commit}</span>
    </span>
  );
}

function PreviewEnvPill({ env }: { env: string }) {
  return (
    <span className={ENV_PILL_CLASS[env] ?? "chip chip-paper"}>
      <span className="dot" />
      {env}
    </span>
  );
}

function PreviewDelta({ value }: { value: string }) {
  const delta = Number.parseFloat(value);

  if (Number.isNaN(delta) || delta === 0) {
    return <span className="delta flat">±0.0</span>;
  }

  return delta > 0 ? (
    <span className="delta up">▲ {delta.toFixed(1)}</span>
  ) : (
    <span className="delta down">▼ {Math.abs(delta).toFixed(1)}</span>
  );
}

function ReleaseQueueRoute({ route }: { route: "draft-to-staging" | "staging-to-production" }) {
  const targetIndex = route === "staging-to-production" ? 2 : 1;
  const sourceIndex = targetIndex - 1;
  const labels = ["Draft", "Staging", "Production"];

  return (
    <div className="platform-preview-release-rail" aria-hidden="true">
      {labels.map((label, index) => (
        <span
          key={label}
          className="platform-preview-release-stop"
          data-past={index <= sourceIndex ? "true" : undefined}
          data-active={index === targetIndex ? "true" : undefined}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export function CapabilitySurface() {
  return (
    <div className="cap-surface" data-reveal data-reveal-delay="2">
      <div className="platform-preview">
        <div className="platform-preview-shell">
          <aside className="platform-preview-sidebar">
            <div className="platform-preview-brand">
              <span className="platform-preview-brand-mark">S</span>
              <span>Savant</span>
            </div>

            <div className="platform-preview-sidebar-scroll">
              {PLATFORM_PREVIEW_NAV.map((group) => (
                <div key={group.label} className="platform-preview-nav-group">
                  <div className="platform-preview-nav-group-label">{group.label}</div>
                  <nav className="platform-preview-nav" aria-label={`${group.label} navigation`}>
                    {group.items.map((item) => {
                      const Icon = NAV_ICONS[item.icon];

                      return (
                        <div
                          key={item.label}
                          className="platform-preview-nav-item"
                          data-active={item.active ? "true" : undefined}
                        >
                          <span className="platform-preview-nav-icon">
                            <Icon style={{ width: 13, height: 13 }} />
                          </span>
                          <span>{item.label}</span>
                          {item.count ? <span className="platform-preview-nav-count">{item.count}</span> : null}
                        </div>
                      );
                    })}
                  </nav>
                </div>
              ))}
            </div>

            <div className="platform-preview-sidebar-footer">
              <Ic.Settings style={{ width: 12, height: 12 }} />
              <span>Settings</span>
            </div>
          </aside>

          <div className="platform-preview-main">
            <div className="platform-preview-topbar">
              <div className="platform-preview-topbar-meta">
                <span className="platform-preview-topbar-chip">Workspace</span>
                <span className="platform-preview-topbar-path">Overview</span>
                <span className="platform-preview-topbar-env">Production</span>
              </div>

              <div className="platform-preview-toolbar-actions">
                <div className="platform-preview-search" aria-hidden="true">
                  <Ic.Search style={{ width: 12, height: 12 }} />
                  <span>Search skills, repos, evals, releases...</span>
                </div>
                <span className="platform-preview-login">Log in</span>
              </div>
            </div>

            <div className="page-inner platform-preview-page">
              <div className="page-head platform-preview-page-head">
                <div>
                  <div className="page-head-meta">
                    <span>/00</span>
                    <span className="sep">—</span>
                    <span>Overview</span>
                  </div>
                  <h3 className="h-display">The state of every governed skill, in one place.</h3>
                  <div className="page-head-sub">
                    218 skills under governance. 4 candidates awaiting approval. 1 regression flagged in the last hour.
                  </div>
                </div>

                <div className="platform-preview-page-actions">
                  <span className="btn btn-ghost platform-preview-button">
                    <Ic.Refresh className="b-icon" />
                    <span>Resync repositories</span>
                  </span>
                  <span className="btn btn-primary platform-preview-button">
                    <Ic.Plus className="b-icon" />
                    <span>Connect repository</span>
                  </span>
                </div>
              </div>

              <div className="panel platform-preview-auth-panel">
                <div className="panel-hd">
                  <div>
                    <div className="panel-title">Authentication</div>
                    <div className="platform-preview-auth-copy">
                      Auth0 is wired into this Next.js app using the official server-side session SDK.
                    </div>
                  </div>
                  <span className="chip chip-paper">Auth0 · ready</span>
                </div>
                <div className="panel-bd">
                  <div className="platform-preview-auth-row">
                    <div className="col" style={{ gap: 4 }}>
                      <div className="skill-name platform-preview-auth-title">You&apos;re browsing Savant as a guest.</div>
                      <div className="platform-preview-auth-copy">
                        Use the sign-in and sign-up entry pages below to test Universal Login, callback handling, and logout from the dashboard.
                      </div>
                    </div>
                    <div className="platform-preview-auth-actions">
                      <span className="btn btn-sm platform-preview-button">Sign up</span>
                      <span className="btn btn-sm platform-preview-button">Log in</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="kpi-strip platform-preview-kpis">
                {PLATFORM_PREVIEW_KPIS.map((kpi) => (
                  <div key={kpi.label} className="kpi">
                    <div className="kpi-label">{kpi.label}</div>
                    <div className="kpi-value num">
                      {kpi.value}
                      {kpi.unit ? <span className="platform-preview-kpi-unit">{kpi.unit}</span> : null}
                    </div>
                    <div className={`kpi-trend ${kpi.trend}`}>{kpi.deltaLabel}</div>
                  </div>
                ))}
              </div>

              <div className="grid-2 platform-preview-grid">
                <div className="platform-preview-stack">
                  <div className="panel">
                    <div className="panel-hd">
                      <div className="row" style={{ gap: 10 }}>
                        <div className="panel-title">Awaiting approval</div>
                        <span className="chip chip-brass">
                          <span className="dot" />4 pending
                        </span>
                      </div>
                      <span className="btn btn-sm platform-preview-button">
                        View all
                        <Ic.ChevR className="b-icon" />
                      </span>
                    </div>
                    <div className="panel-bd tight">
                      <table className="tbl">
                        <tbody>
                          {PLATFORM_PREVIEW_APPROVALS.map((approval) => (
                            <tr key={`${approval.skill}-${approval.version}`}>
                              <td style={{ width: "42%" }}>
                                <div className="tbl-name">
                                  <div className="tbl-name-text">
                                    <span className="pri">{approval.skill}</span>
                                    <span className="sec">{approval.change}</span>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span className={`tier tier-${approval.tier}`}>T{approval.tier}</span>
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
                              <td className="subtle platform-preview-table-meta">{approval.when}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-hd">
                      <div className="panel-title">Recently changed</div>
                      <div className="panel-actions">
                        <span className="subtle platform-preview-side-note">Last 24h</span>
                      </div>
                    </div>
                    <div className="panel-bd tight">
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
                          {PLATFORM_PREVIEW_RECENT_CHANGES.map((change) => (
                            <tr key={`${change.skill}-${change.ref}`}>
                              <td>
                                <span className="skill-name">{change.skill}</span>
                              </td>
                              <td>
                                <PreviewCommitRef commit={change.ref} />
                              </td>
                              <td className="muted">{change.who}</td>
                              <td>
                                <PreviewEnvPill env={change.env} />
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <PreviewDelta value={change.delta} />
                              </td>
                              <td className="subtle platform-preview-table-meta">{change.when}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-hd">
                      <div className="row" style={{ gap: 10 }}>
                        <div className="panel-title">Regression alerts</div>
                        <span className="chip chip-blood">
                          <Ic.Warn style={{ width: 10, height: 10 }} />3 active
                        </span>
                      </div>
                      <span className="btn btn-sm platform-preview-button">
                        Open eval dashboard
                        <Ic.ChevR className="b-icon" />
                      </span>
                    </div>
                    <div className="panel-bd">
                      <div className="platform-preview-regressions">
                        {PLATFORM_PREVIEW_REGRESSIONS.map((regression) => (
                          <div key={`${regression.skill}-${regression.metric}`} className="platform-preview-regression-row">
                            <div className="col" style={{ gap: 2 }}>
                              <div className="row" style={{ gap: 8 }}>
                                <span className="skill-name">{regression.skill}</span>
                                <span className="dot-sep">·</span>
                                <span className="muted platform-preview-row-caption">{regression.metric}</span>
                              </div>
                              <div className="row platform-preview-regression-metrics">
                                <span className="mono subtle">{regression.from}</span>
                                <Ic.Arrow style={{ width: 10, height: 10, color: "var(--faint)" }} />
                                <span className="mono platform-preview-regression-to">{regression.to}</span>
                              </div>
                            </div>
                            <span className={REGRESSION_SEVERITY_CLASS[regression.severity]}>{regression.severity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="platform-preview-stack">
                  <div className="panel">
                    <div className="panel-hd">
                      <div className="row" style={{ gap: 10 }}>
                        <div className="panel-title">Repositories</div>
                        <span className="subtle platform-preview-side-note">5 connected</span>
                      </div>
                      <span className="btn btn-sm platform-preview-button">
                        <Ic.Plus className="b-icon" />
                        Add
                      </span>
                    </div>
                    <div className="panel-bd tight">
                      <div className="list">
                        {PLATFORM_PREVIEW_REPOSITORIES.map((repository) => (
                          <div className="list-item" key={repository.name}>
                            <ProviderIcon p={repository.provider} size={14} />
                            <div className="col platform-preview-list-copy">
                              <div className="li-pri mono platform-preview-list-primary">{repository.name}</div>
                              <div className="li-sec">
                                <Ic.Branch style={{ width: 9, height: 9, display: "inline", verticalAlign: "-1px", marginRight: 3 }} />
                                {repository.branch} · {repository.skills} skills
                              </div>
                            </div>
                            <div className="row platform-preview-repo-meta">
                              {repository.status === "attention" ? <span className="chip chip-brass">stale</span> : null}
                              {repository.status === "offline" ? <span className="chip chip-paper">offline</span> : null}
                              <span className="subtle platform-preview-row-caption">{repository.when}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-hd">
                      <div className="panel-title">Audit highlights</div>
                      <span className="btn btn-sm platform-preview-button">
                        Full log
                        <Ic.ExternalLink className="b-icon" />
                      </span>
                    </div>
                    <div className="panel-bd">
                      <div className="tl">
                        {PLATFORM_PREVIEW_AUDIT.map((event) => (
                          <div className="tl-item" key={`${event.target}-${event.when}`}>
                            <span className={`tl-node ${event.node}`} />
                            <div>
                              <div className="tl-pri">
                                <b>{event.who}</b> <span className="muted">{event.action}</span> <span>{event.target}</span>
                              </div>
                            </div>
                            <div className="tl-meta">{event.when}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-hd">
                      <div className="panel-title">Release queue</div>
                      <span className="subtle platform-preview-side-note">Next 24h</span>
                    </div>
                    <div className="panel-bd">
                      <div className="platform-preview-release-list">
                        {PLATFORM_PREVIEW_RELEASE_QUEUE.map((item) => (
                          <div key={`${item.skill}-${item.candidateRef}`} className="platform-preview-release-card">
                            <div className="platform-preview-release-head">
                              <div>
                                <div className="skill-name platform-preview-release-title">{item.skill}</div>
                                <div className="platform-preview-release-meta">
                                  <PreviewCommitRef commit={item.candidateCommit} label={item.candidateRef} />
                                  <span className="muted platform-preview-row-caption">{item.requested}</span>
                                </div>
                              </div>
                              <span className="chip chip-paper">{item.approvals}</span>
                            </div>
                            <ReleaseQueueRoute route={item.route} />
                            <div className="platform-preview-release-footer">
                              <span>{item.route === "staging-to-production" ? "Staging → Production" : "Draft → Staging"}</span>
                              <span>{item.when}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
