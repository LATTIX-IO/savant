// screen-policies.jsx — Policies
// List-detail layout. Policies grouped by type; selecting one shows its rules + scope.

function ScreenPolicies({ goto }) {
  const { POLICIES } = window.SAVANT;
  const [selId, setSelId] = React.useState(POLICIES[0].id);
  const [typeFilter, setTypeFilter] = React.useState("all");

  const sel = POLICIES.find(p => p.id === selId) || POLICIES[0];
  const filtered = typeFilter === "all" ? POLICIES : POLICIES.filter(p => p.type === typeFilter);

  const typeCount = (t) => POLICIES.filter(p => p.type === t).length;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/06</span><span className="sep">—</span><span>Policies</span>
          </div>
          <h1 className="h-display">Governance policies</h1>
          <div className="page-head-sub">
            Codified rules for access, approvals, distribution, and environment promotion. Policies are applied to skills by tier or by tag.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost">Policy templates</button>
          <button className="btn btn-primary"><Ic.Plus className="b-icon" />New policy</button>
        </div>
      </div>

      <div className="split wide" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
        {/* LEFT — list */}
        <div className="col" style={{ gap: 0 }}>
          <div className="filterbar">
            <Facet active={typeFilter === "all"}          onClick={() => setTypeFilter("all")}>All <span className="f-count">{POLICIES.length}</span></Facet>
            <Facet active={typeFilter === "access"}       onClick={() => setTypeFilter("access")}>Access <span className="f-count">{typeCount("access")}</span></Facet>
            <Facet active={typeFilter === "approval"}     onClick={() => setTypeFilter("approval")}>Approval <span className="f-count">{typeCount("approval")}</span></Facet>
            <Facet active={typeFilter === "distribution"} onClick={() => setTypeFilter("distribution")}>Distribution <span className="f-count">{typeCount("distribution")}</span></Facet>
            <Facet active={typeFilter === "environment"}  onClick={() => setTypeFilter("environment")}>Environment <span className="f-count">{typeCount("environment")}</span></Facet>
            <div className="grow" />
            <button className="btn btn-sm"><Ic.Sort className="b-icon" />Sort: last updated</button>
          </div>

          <div className="panel" style={{ borderRadius: "0 0 6px 6px", borderTop: 0 }}>
            <div className="panel-bd" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
              {filtered.map(p => (
                <div
                  key={p.id}
                  onClick={() => setSelId(p.id)}
                  style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid var(--rule)",
                    background: p.id === sel.id ? "var(--moss-soft)" : "transparent",
                    cursor: "default",
                    position: "relative",
                    transition: "background 100ms var(--ease)",
                  }}
                  onMouseEnter={e => { if (p.id !== sel.id) e.currentTarget.style.background = "var(--linen)"; }}
                  onMouseLeave={e => { if (p.id !== sel.id) e.currentTarget.style.background = "transparent"; }}
                >
                  {p.id === sel.id && (
                    <span style={{ position: "absolute", left: 0, top: 16, bottom: 16, width: 2, background: "var(--moss)", borderRadius: 2 }} />
                  )}
                  <div className="row between" style={{ alignItems: "flex-start", marginBottom: 6 }}>
                    <div className="row" style={{ gap: 10, minWidth: 0, alignItems: "center" }}>
                      <PolicyTypeChip type={p.type} />
                      <span className="skill-name" style={{ fontSize: 13.5 }}>{p.name}</span>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      {p.state === "draft" ? <span className="chip chip-brass">draft</span> : <span className="chip chip-moss"><span className="dot" />active</span>}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{p.scope}</div>
                  <div className="row" style={{ gap: 16, fontSize: 11.5 }}>
                    <span><span className="subtle">Affects</span> <span className="num" style={{ color: "var(--ink-2)" }}>{p.affects}</span> skills</span>
                    <span><span className="subtle">Owner</span> <span style={{ color: "var(--ink-2)" }}>{p.appliedBy}</span></span>
                    <span style={{ marginLeft: "auto" }} className="subtle">Updated {p.updated}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — detail */}
        <div className="panel" style={{ position: "sticky", top: 0 }}>
          <div className="panel-hd">
            <div className="row" style={{ gap: 8 }}>
              <PolicyTypeChip type={sel.type} />
              <span className="panel-title" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13 }}>{sel.name}</span>
            </div>
            <button className="btn btn-sm">Edit</button>
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Scope</div>
              <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{sel.scope}</div>
            </div>

            <div className="row" style={{ gap: 24 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 2 }}>State</div>
                {sel.state === "draft" ? <span className="chip chip-brass">draft</span> : <span className="chip chip-moss"><span className="dot" />active</span>}
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 2 }}>Affects</div>
                <div className="mono num" style={{ fontSize: 13 }}>{sel.affects} skills</div>
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 2 }}>Owned by</div>
                <div style={{ fontSize: 13 }}>{sel.appliedBy}</div>
              </div>
            </div>

            <div className="divider" />

            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Rules</div>
              <div className="col" style={{ gap: 8 }}>
                {sel.rules.map((r, i) => (
                  <div key={i} style={{
                    padding: "10px 12px",
                    border: "1px solid var(--rule)",
                    borderRadius: 4,
                    background: "var(--linen)"
                  }}>
                    <div className="eyebrow" style={{ fontSize: 10, marginBottom: 3 }}>{r.rule}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.4 }}>{r.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="divider" />

            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Recent enforcement</div>
              <div className="col" style={{ gap: 6 }}>
                <EnforceLine when="12m ago" action="Blocked" who="renata.m" detail="attempted to distribute Tier 1 skill via vscode-sync" />
                <EnforceLine when="3h ago"  action="Allowed" who="ari.chen"  detail="approved promotion of Engineering RFC Reviewer" />
                <EnforceLine when="6h ago"  action="Allowed" who="jdv"       detail="rollback Incident Triage → v2.9.4 with break-glass" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PolicyTypeChip({ type }) {
  const map = {
    access:       { cls: "chip chip-slate",  label: "access" },
    approval:     { cls: "chip chip-brass",  label: "approval" },
    distribution: { cls: "chip chip-moss",   label: "distribution" },
    environment:  { cls: "chip chip-paper",  label: "environment" },
  };
  const c = map[type] || map.access;
  return <span className={c.cls}>{c.label}</span>;
}

function EnforceLine({ when, action, who, detail }) {
  return (
    <div className="row" style={{ gap: 10, fontSize: 12, padding: "5px 0" }}>
      <span className="mono subtle" style={{ width: 70 }}>{when}</span>
      <span className={`chip ${action === "Blocked" ? "chip-blood" : "chip-moss"}`} style={{ width: 64, justifyContent: "center" }}>
        {action.toLowerCase()}
      </span>
      <span style={{ color: "var(--ink-2)", minWidth: 0 }}>
        <b style={{ fontWeight: 500 }}>{who}</b> · {detail}
      </span>
    </div>
  );
}

window.ScreenPolicies = ScreenPolicies;
