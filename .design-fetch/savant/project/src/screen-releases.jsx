// screen-releases.jsx — Release dashboard
// Hero: active candidates with full lifecycle rails (draft → staging → production)
// Each card: readiness checklist + approvals + downstream targets + actions.
// Below: recent release history.

function ScreenReleases({ goto }) {
  const { RELEASES, RELEASE_HISTORY } = window.SAVANT;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/05</span><span className="sep">—</span><span>Releases</span>
          </div>
          <h1 className="h-display">Release dashboard</h1>
          <div className="page-head-sub">
            Promote candidates through draft, staging, and production. Rollback is always one click away.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost">Release policy</button>
          <button className="btn btn-primary"><Ic.Plus className="b-icon" />New release</button>
        </div>
      </div>

      <div className="kpi-strip" style={{ marginBottom: 24 }}>
        <div className="kpi">
          <div className="kpi-label">Active candidates</div>
          <div className="kpi-value num">{RELEASES.length}</div>
          <div className="kpi-trend">1 awaiting compliance</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Release turnaround</div>
          <div className="kpi-value num">2.4<span style={{ fontSize: 16, color: "var(--muted)" }}>d</span></div>
          <div className="kpi-trend up">▼ 0.6d vs 30d</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rollbacks · 30d</div>
          <div className="kpi-value num">1</div>
          <div className="kpi-trend">Incident Triage · 9d ago</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Pinned in production</div>
          <div className="kpi-value num">147</div>
          <div className="kpi-trend up">▲ 6 this week</div>
        </div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>In motion · {RELEASES.length}</div>
      <div className="col" style={{ gap: 14, marginBottom: 32 }}>
        {RELEASES.map(r => <ReleaseCard key={r.id} r={r} goto={goto} />)}
      </div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>Recent history</div>
      <div className="panel">
        <div className="panel-bd tight">
          <table className="tbl">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Version</th>
                <th>Environment</th>
                <th>Released by</th>
                <th>Outcome</th>
                <th style={{ textAlign: "right" }}>When</th>
              </tr>
            </thead>
            <tbody>
              {RELEASE_HISTORY.map((h, i) => (
                <tr key={i}>
                  <td><span className="skill-name">{h.skill}</span></td>
                  <td><span className="mono num" style={{ color: "var(--ink)" }}>{h.ref}</span></td>
                  <td><EnvPill env={h.env} /></td>
                  <td className="muted">{h.who}</td>
                  <td>
                    {h.outcome === "released" ? <span className="chip chip-moss"><Ic.Check style={{ width: 10, height: 10 }} />released</span>
                    : <span className="chip chip-blood"><Ic.ArrowDown style={{ width: 10, height: 10 }} />rolled back</span>}
                  </td>
                  <td className="subtle" style={{ textAlign: "right" }}>{h.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReleaseCard({ r, goto }) {
  const stages = ["draft", "staging", "production"];
  const fromIdx = stages.indexOf(r.fromEnv);
  const toIdx   = stages.indexOf(r.toEnv);

  const blocked = r.approvalsBlocked !== null;
  const ready   = r.readinessPct === 1.0;

  return (
    <div className="panel">
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
        gap: 0
      }}>
        {/* LEFT — identity + lifecycle rail + readiness */}
        <div style={{ padding: 18, borderRight: "1px solid var(--rule)" }}>
          <div className="row between" style={{ marginBottom: 14, alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                <span className="skill-name" style={{ fontSize: 15 }}>{r.skill}</span>
                <CommitRef commit={r.candidateCommit} label={r.candidateRef} />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Submitted by {r.requested} · {r.when}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => goto("skill")}>Inspect</button>
              {ready
                ? <button className="btn btn-brass btn-sm"><Ic.Arrow className="b-icon" />Promote to {r.toEnv}</button>
                : blocked
                  ? <button className="btn btn-sm" style={{ background: "var(--linen)", borderColor: "var(--rule-2)" }} disabled>
                      <Ic.Clock className="b-icon" />Awaiting {r.approvalsBlocked}
                    </button>
                  : null
              }
            </div>
          </div>

          {/* Lifecycle rail */}
          <div className="lcr">
            {stages.map((s, i) => {
              const done   = i < fromIdx + 1;
              const target = i === toIdx;
              const cls = done ? "lcr-done" : target ? "lcr-target" : "lcr-future";
              return (
                <React.Fragment key={s}>
                  <div className={`lcr-stage ${cls}`}>
                    <div className="lcr-node">
                      {done ? <Ic.Check style={{ width: 9, height: 9 }} />
                      : target ? <span style={{ width: 4, height: 4, background: "currentColor", borderRadius: 1 }} />
                      : null}
                    </div>
                    <div className="lcr-label">{s}</div>
                    <div className="lcr-meta">
                      {i === 0 && (r.fromEnv === "draft" ? "ingested 1h ago" : "")}
                      {i === 1 && (i === toIdx ? "promotion target" : (i <= fromIdx ? "burn-in complete" : "pending"))}
                      {i === 2 && (i === toIdx ? "promotion target" : (i <= fromIdx ? "pinned " + r.candidateRef : "—"))}
                    </div>
                  </div>
                  {i < stages.length - 1 && (
                    <div className={`lcr-conn ${i < toIdx ? "lcr-conn-active" : ""}`}>
                      {i === toIdx - 1 && <span className="lcr-arrow">→</span>}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Readiness checklist */}
          <div style={{ marginTop: 14 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <div className="eyebrow" style={{ fontSize: 10 }}>Readiness</div>
              <span className="mono num subtle" style={{ fontSize: 11.5 }}>{Math.round(r.readinessPct * 100)}%</span>
            </div>
            <div className="col" style={{ gap: 0 }}>
              {r.readiness.map((c, i) => (
                <div key={i} className="row" style={{ padding: "6px 0", borderBottom: i < r.readiness.length - 1 ? "1px solid var(--rule)" : "none", gap: 10 }}>
                  <span style={{ color: c.ok === true ? "var(--moss)" : c.ok === false ? "var(--oxblood)" : "var(--brass)", width: 14, height: 14, display: "grid", placeItems: "center" }}>
                    {c.ok === true ? <Ic.CheckCircle style={{ width: 14, height: 14 }} />
                    : c.ok === false ? <Ic.XCircle style={{ width: 14, height: 14 }} />
                    : <Ic.Clock style={{ width: 14, height: 14 }} />}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{c.label}</span>
                  <span className="subtle" style={{ fontSize: 11.5, marginLeft: "auto" }}>{c.meta}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — approvals + targets */}
        <div style={{ padding: 18, background: "var(--linen)" }}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>Approvals</div>
            <span className="mono num" style={{ fontSize: 12, color: r.approvalsDone === r.approvalsRequired ? "var(--moss)" : "var(--brass)" }}>
              {r.approvalsDone} / {r.approvalsRequired}
            </span>
          </div>

          <div className="col" style={{ gap: 8, marginBottom: 18 }}>
            <ApprovalLine name="Skill owner" status="done" />
            {r.approvalsRequired >= 2 && <ApprovalLine name="Reviewer / Security" status={r.approvalsDone >= 2 ? "done" : "pending"} />}
            {r.approvalsRequired >= 3 && <ApprovalLine name="Compliance" status={r.approvalsDone >= 3 ? "done" : "pending"} />}
          </div>

          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Distribution targets</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {r.targets.map(t => (
              <span key={t} className="chip chip-paper" style={{ background: "var(--panel)" }}>
                <Ic.Connectors style={{ width: 10, height: 10 }} />
                {t}
              </span>
            ))}
          </div>

          <div style={{ marginTop: 18, padding: "10px 12px", border: "1px solid var(--rule)", borderRadius: 5, background: "var(--panel)" }}>
            <div className="row" style={{ gap: 8 }}>
              <Ic.Lock style={{ width: 12, height: 12, color: "var(--muted)" }} />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Signed bundle</span>
              <span className="mono num subtle" style={{ fontSize: 11, marginLeft: "auto" }}>built · {r.candidateCommit.slice(0, 6)}…{r.candidateCommit.slice(-3)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalLine({ name, status }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      {status === "done"
        ? <Ic.CheckCircle style={{ width: 14, height: 14, color: "var(--moss)" }} />
        : <Ic.Clock style={{ width: 14, height: 14, color: "var(--brass)" }} />}
      <span style={{ fontSize: 12.5 }}>{name}</span>
      <span className="subtle" style={{ fontSize: 11.5, marginLeft: "auto" }}>
        {status === "done" ? "approved" : "pending"}
      </span>
    </div>
  );
}

window.ScreenReleases = ScreenReleases;
