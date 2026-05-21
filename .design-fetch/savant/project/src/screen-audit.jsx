// screen-audit.jsx — Audit log
// Left rail: category filters + range. Main: timeline grouped by day.

function ScreenAudit({ goto }) {
  const { AUDIT_FULL } = window.SAVANT;
  const [cat, setCat] = React.useState("all");
  const [range, setRange] = React.useState("7d");
  const [query, setQuery] = React.useState("");

  const filtered = AUDIT_FULL.filter(e => {
    if (cat !== "all" && e.category !== cat) return false;
    if (query && !(e.who + e.action + e.target).toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  // Group by day-bucket: "Today" if hours/minutes ago, else "Earlier"
  const groups = {};
  filtered.forEach(e => {
    const isToday = e.when.includes("m ago") || e.when.includes("h ago") || e.when === "Now" || e.when === "5h ago" || e.when === "6h ago" || e.when === "9h ago";
    const key = isToday ? "Today" : e.when.includes("1d") ? "Yesterday" : "Earlier";
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  const cats = [
    { id: "all",        label: "All events" },
    { id: "approval",   label: "Approvals" },
    { id: "release",    label: "Releases" },
    { id: "evaluation", label: "Evaluations" },
    { id: "access",     label: "Access" },
    { id: "version",    label: "Versions" },
    { id: "policy",     label: "Policies" },
    { id: "repo",       label: "Repositories" },
    { id: "review",     label: "Reviews" },
  ];
  const catCount = (id) => id === "all" ? AUDIT_FULL.length : AUDIT_FULL.filter(e => e.category === id).length;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/07</span><span className="sep">—</span><span>Audit</span>
          </div>
          <h1 className="h-display">Audit log</h1>
          <div className="page-head-sub">
            Immutable record of every governance event — approvals, releases, access changes, and policy edits. Exportable for compliance review.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost"><Ic.ExternalLink className="b-icon" />Export CSV</button>
          <button className="btn btn-primary"><Ic.ExternalLink className="b-icon" />Stream to SIEM</button>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
        {/* LEFT — filters */}
        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Category</div></div>
            <div className="panel-bd" style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
              {cats.map(c => (
                <div
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className="row between"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 4,
                    background: cat === c.id ? "rgba(28,27,24,.06)" : "transparent",
                    fontSize: 12.5,
                    fontWeight: cat === c.id ? 500 : 450,
                    color: cat === c.id ? "var(--ink)" : "var(--ink-3)",
                    cursor: "default",
                    transition: "background 100ms var(--ease)",
                  }}
                >
                  <span>{c.label}</span>
                  <span className="num subtle" style={{ fontSize: 11 }}>{catCount(c.id)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Range</div></div>
            <div className="panel-bd" style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
              {[["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["all", "All time"]].map(([id, label]) => (
                <div
                  key={id}
                  onClick={() => setRange(id)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 4,
                    background: range === id ? "rgba(28,27,24,.06)" : "transparent",
                    fontSize: 12.5,
                    fontWeight: range === id ? 500 : 450,
                    color: range === id ? "var(--ink)" : "var(--ink-3)",
                    cursor: "default",
                  }}
                >{label}</div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Actor</div></div>
            <div className="panel-bd" style={{ padding: "8px 10px" }}>
              <input
                placeholder="user@…"
                style={{ width: "100%", height: 28, padding: "0 10px", border: "1px solid var(--rule-2)", borderRadius: 4, fontSize: 12, outline: "none", background: "var(--panel)" }}
              />
            </div>
          </div>

          <div className="note">
            <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
            <span style={{ fontSize: 11.5 }}>Audit events are immutable and retained for 7 years.</span>
          </div>
        </div>

        {/* RIGHT — timeline */}
        <div className="panel">
          <div className="panel-hd">
            <div className="row" style={{ gap: 10 }}>
              <div className="panel-title">Events</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>{filtered.length} matching</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <div style={{ position: "relative" }}>
                <Ic.Search style={{ width: 11, height: 11, color: "var(--subtle)", position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)" }} />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search in events…"
                  style={{ height: 26, padding: "0 10px 0 24px", fontSize: 12, border: "1px solid var(--rule-2)", borderRadius: 4, background: "var(--panel)", width: 200, outline: "none" }}
                />
              </div>
            </div>
          </div>
          <div className="panel-bd" style={{ padding: 0 }}>
            {Object.keys(groups).map((g, gi) => (
              <div key={g}>
                <div style={{
                  padding: "10px 20px",
                  background: "var(--linen)",
                  borderBottom: "1px solid var(--rule)",
                  borderTop: gi === 0 ? "none" : "1px solid var(--rule)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <span className="eyebrow" style={{ fontSize: 10 }}>{g}</span>
                  <span className="subtle num mono" style={{ fontSize: 10.5 }}>{groups[g].length} events</span>
                </div>
                <div className="audit-events">
                  {groups[g].map((e, i) => (
                    <div key={i} className="audit-event">
                      <div className="audit-time">
                        <span className="mono num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{e.time}</span>
                        <span className="subtle" style={{ fontSize: 11 }}>{e.when}</span>
                      </div>
                      <div className={`audit-node tl-node ${e.node}`} />
                      <div>
                        <div style={{ fontSize: 13, color: "var(--ink)" }}>
                          <b style={{ fontWeight: 500 }}>{e.who}</b> <span className="muted">{e.action.toLowerCase()}</span> {e.target}
                        </div>
                      </div>
                      <span className="chip chip-paper" style={{ marginLeft: "auto" }}>{e.category}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.ScreenAudit = ScreenAudit;
