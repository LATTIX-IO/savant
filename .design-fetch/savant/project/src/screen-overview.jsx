// screen-overview.jsx — Admin Overview
// Layout: hero rail (provenance motif at top), 4 KPIs, then 2/1 split:
// left = approvals queue + recent changes + regressions
// right = repos + audit timeline

function ScreenOverview({ goto }) {
  const { APPROVALS, RECENT_CHANGES, REGRESSIONS, REPOS, AUDIT } = window.SAVANT;

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
            218 skills under governance. 4 candidates awaiting approval. 1 regression flagged in the last hour.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost">
            <Ic.Refresh className="b-icon" />
            <span>Resync repositories</span>
          </button>
          <button className="btn btn-primary" onClick={() => goto("onboarding")}>
            <Ic.Plus className="b-icon" />
            <span>Connect repository</span>
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="kpi-strip" style={{ marginBottom: 24 }}>
        <div className="kpi">
          <div className="kpi-label">Skills in production</div>
          <div className="kpi-value num">147</div>
          <div className="kpi-trend up">▲ 6 this week</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Eval coverage</div>
          <div className="kpi-value num">94<span style={{ fontSize: 16, color: "var(--muted)" }}>%</span></div>
          <div className="kpi-trend up">▲ 2.1 pts</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">First-pass acceptance</div>
          <div className="kpi-value num">81<span style={{ fontSize: 16, color: "var(--muted)" }}>%</span></div>
          <div className="kpi-trend up">▲ 0.4 pts</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Release turnaround</div>
          <div className="kpi-value num">2.4<span style={{ fontSize: 16, color: "var(--muted)" }}>d</span></div>
          <div className="kpi-trend down">▼ 0.6d</div>
        </div>
      </div>

      <div className="grid-2">
        {/* LEFT COLUMN */}
        <div className="col" style={{ gap: "var(--gutter)" }}>
          {/* Approvals */}
          <div className="panel">
            <div className="panel-hd">
              <div className="row" style={{ gap: 10 }}>
                <div className="panel-title">Awaiting approval</div>
                <span className="chip chip-brass"><span className="dot" />{APPROVALS.length} pending</span>
              </div>
              <div className="panel-actions">
                <button className="btn btn-sm">View all<Ic.ChevR className="b-icon" /></button>
              </div>
            </div>
            <div className="panel-bd tight">
              <table className="tbl">
                <tbody>
                  {APPROVALS.map((a) => (
                    <tr key={a.id} onClick={() => goto("skill", "skl_ccr")}>
                      <td style={{ width: "42%" }}>
                        <div className="tbl-name">
                          <div className="tbl-name-text">
                            <span className="pri">{a.skill}</span>
                            <span className="sec">{a.change}</span>
                          </div>
                        </div>
                      </td>
                      <td><Tier n={parseInt(a.tier.slice(1), 10)} /></td>
                      <td className="mono num" style={{ color: "var(--ink-3)" }}>v{a.version}</td>
                      <td>
                        <span className="chip chip-paper">
                          <Ic.Lock style={{ width: 10, height: 10 }} />
                          {a.blocking}
                        </span>
                      </td>
                      <td className="subtle" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{a.when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent changes */}
          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Recently changed</div>
              <div className="panel-actions">
                <span className="subtle" style={{ fontSize: 11.5 }}>Last 24h</span>
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
                  {RECENT_CHANGES.map((c, i) => (
                    <tr key={i}>
                      <td><span className="skill-name">{c.skill}</span></td>
                      <td><CommitRef commit={c.ref} /></td>
                      <td className="muted">{c.who}</td>
                      <td><EnvPill env={c.env} /></td>
                      <td style={{ textAlign: "right" }}>
                        <Delta v={c.delta === "flat" ? "flat" : parseFloat(c.delta)} />
                      </td>
                      <td className="subtle" style={{ whiteSpace: "nowrap", textAlign: "right" }}>{c.when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Regressions */}
          <div className="panel">
            <div className="panel-hd">
              <div className="row" style={{ gap: 10 }}>
                <div className="panel-title">Regression alerts</div>
                <span className="chip chip-blood"><Ic.Warn style={{ width: 10, height: 10 }} />3 active</span>
              </div>
              <div className="panel-actions">
                <button className="btn btn-sm">Open eval dashboard<Ic.ChevR className="b-icon" /></button>
              </div>
            </div>
            <div className="panel-bd">
              <div className="col" style={{ gap: 10 }}>
                {REGRESSIONS.map((r, i) => (
                  <div key={i} className="row between" style={{
                    padding: "10px 12px", border: "1px solid var(--rule)", borderRadius: 5,
                    background: "var(--linen)"
                  }}>
                    <div className="col" style={{ gap: 2 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="skill-name">{r.skill}</span>
                        <span className="dot-sep">·</span>
                        <span className="muted" style={{ fontSize: 12.5 }}>{r.metric}</span>
                      </div>
                      <div className="row" style={{ gap: 10, fontSize: 11.5 }}>
                        <span className="mono subtle">{r.from}{r.unit || ""}</span>
                        <Ic.Arrow style={{ width: 10, height: 10, color: "var(--faint)" }} />
                        <span className="mono" style={{ color: "var(--oxblood)" }}>{r.to}{r.unit || ""}</span>
                      </div>
                    </div>
                    <span className={`chip ${r.severity === "critical" ? "chip-blood" : r.severity === "moderate" ? "chip-brass" : "chip-paper"}`}>
                      {r.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="col" style={{ gap: "var(--gutter)" }}>
          {/* Repositories */}
          <div className="panel">
            <div className="panel-hd">
              <div className="row" style={{ gap: 10 }}>
                <div className="panel-title">Repositories</div>
                <span className="subtle" style={{ fontSize: 11.5 }}>{REPOS.length} connected</span>
              </div>
              <div className="panel-actions">
                <button className="btn btn-sm" onClick={() => goto("onboarding")}>
                  <Ic.Plus className="b-icon" />Add
                </button>
              </div>
            </div>
            <div className="panel-bd tight">
              <div className="list">
                {REPOS.map((r) => (
                  <div className="list-item" key={r.id}>
                    <ProviderIcon p={r.provider} size={14} />
                    <div className="col" style={{ gap: 2, minWidth: 0 }}>
                      <div className="li-pri mono" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      <div className="li-sec">
                        <Ic.Branch style={{ width: 9, height: 9, display: "inline", verticalAlign: "-1px", marginRight: 3 }} />
                        {r.branch} · {r.skills} skills
                      </div>
                    </div>
                    <div className="row" style={{ marginLeft: "auto", gap: 8 }}>
                      {r.status === "warn" ? <span className="chip chip-brass">stale</span> :
                       r.status === "stale" ? <span className="chip chip-blood">offline</span> :
                       null}
                      <span className="subtle" style={{ fontSize: 11 }}>{r.lastSync}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Audit highlights */}
          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Audit highlights</div>
              <button className="btn btn-sm">Full log<Ic.ExternalLink className="b-icon" /></button>
            </div>
            <div className="panel-bd">
              <div className="tl">
                {AUDIT.map((e, i) => (
                  <div className="tl-item" key={i}>
                    <span className={`tl-node ${e.node}`} />
                    <div>
                      <div className="tl-pri">
                        <b>{e.who}</b> <span className="muted">{e.action.toLowerCase()}</span>{" "}
                        <span>{e.target}</span>
                      </div>
                    </div>
                    <div className="tl-meta">{e.when}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Release queue */}
          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Release queue</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>Next 24h</span>
            </div>
            <div className="panel-bd">
              <div className="col" style={{ gap: 12 }}>
                <ReleaseQueueItem
                  name="Engineering RFC Reviewer"
                  versionRef="v2.0.0"
                  state="staging-to-production"
                />
                <ReleaseQueueItem
                  name="Quarterly Earnings Summary"
                  versionRef="v0.5.3-rc.1"
                  state="draft-to-staging"
                />
                <ReleaseQueueItem
                  name="PR Summarizer"
                  versionRef="v1.8.3-rc.1"
                  state="staging-to-production"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Compact release-queue line item — vertical lifecycle rail
function ReleaseQueueItem({ name, versionRef, state }) {
  const stages = ["draft", "staging", "production"];
  // determine which stage the candidate is moving to
  const targetIdx = state === "draft-to-staging" ? 1 : state === "staging-to-production" ? 2 : 0;
  const sourceIdx = targetIdx - 1;

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between">
        <div>
          <div className="skill-name" style={{ fontSize: 13 }}>{name}</div>
          <CommitRef commit={versionRef} />
        </div>
      </div>
      <div className="row" style={{ gap: 0 }}>
        {stages.map((s, i) => (
          <React.Fragment key={s}>
            <div className="col" style={{ alignItems: "center", gap: 4, flex: 1 }}>
              <div style={{
                width: 9, height: 9, borderRadius: "50%",
                background: i <= sourceIdx ? "var(--moss)" : i === targetIdx ? "var(--brass)" : "var(--rule-strong)",
                outline: i === targetIdx ? "3px solid var(--brass-soft)" : "none",
                outlineOffset: -1,
              }} />
              <div style={{
                fontSize: 10, letterSpacing: "var(--track-mini)", textTransform: "uppercase",
                color: i <= sourceIdx ? "var(--moss-deep)" : i === targetIdx ? "var(--brass-deep)" : "var(--subtle)",
                fontWeight: 500
              }}>{s}</div>
            </div>
            {i < stages.length - 1 && (
              <div style={{
                flex: 1,
                height: 1,
                background: i < targetIdx ? "var(--moss)" : "var(--rule-2)",
                marginTop: 4,
                position: "relative", top: 4,
              }} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

window.ScreenOverview = ScreenOverview;
