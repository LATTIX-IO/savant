// components.jsx — shared display components: provenance rail, sparkline,
// repo/provider chip, env pill, etc.

const ProviderIcon = ({ p, size = 13 }) => {
  const style = { width: size, height: size };
  if (p === "github")    return <Ic.GitHub style={{ ...style, color: "var(--ink)" }} />;
  if (p === "gitlab")    return <Ic.GitLab style={{ ...style, color: "#E24329" }} />;
  if (p === "azure")     return <Ic.Azure  style={{ ...style, color: "#1F6EB5" }} />;
  if (p === "bitbucket") return <Ic.Bitbucket style={{ ...style, color: "#1B65D7" }} />;
  return <Ic.Server style={{ ...style, color: "var(--slate)" }} />;
};

const RepoChip = ({ provider, name }) => (
  <span className="ref" title={`${provider} · ${name}`}>
    <ProviderIcon p={provider} size={10} />
    <span>{name}</span>
  </span>
);

const CommitRef = ({ commit, label }) => (
  <span className="ref">
    <Ic.Commit className="ref-icon" />
    <span>{label || commit}</span>
  </span>
);

const BranchRef = ({ branch }) => (
  <span className="ref">
    <Ic.Branch className="ref-icon" />
    <span>{branch}</span>
  </span>
);

const TagRef = ({ tag }) => (
  <span className="ref">
    <Ic.Tag className="ref-icon" />
    <span>{tag}</span>
  </span>
);

const EnvPill = ({ env }) => {
  const map = {
    production: { cls: "chip chip-moss",  dot: "var(--moss)",   label: "Production" },
    staging:    { cls: "chip chip-brass", dot: "var(--brass)",  label: "Staging" },
    draft:      { cls: "chip chip-slate", dot: "var(--slate)",  label: "Draft" },
    "—":        { cls: "chip chip-paper", dot: "var(--faint)",  label: "—" },
  };
  const c = map[env] || map["draft"];
  return (
    <span className={c.cls}>
      <span className="dot" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
};

const Tier = ({ n }) => (
  <span className={`tier tier-${n}`}>T{n}</span>
);

// Sparkline — clean line + filled area, no axes.
const Sparkline = ({ data, w = 64, h = 22, color = "var(--moss)" }) => {
  if (!data || data.length === 0) return <span className="faint mono" style={{ fontSize: 11 }}>—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const pad = 2;
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = d + ` L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
  return (
    <svg className="minichart" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={area} fill={color} opacity="0.10" />
      <path d={d} stroke={color} strokeWidth="1.25" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="1.6" fill={color} />
    </svg>
  );
};

// Delta indicator with arrow
const Delta = ({ v }) => {
  if (v == null || v === "flat") return <span className="delta flat">±0.0</span>;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (isNaN(n)) return <span className="delta flat">{v}</span>;
    v = n;
  }
  if (v > 0) return <span className="delta up">▲ {v.toFixed(1)}</span>;
  if (v < 0) return <span className="delta down">▼ {Math.abs(v).toFixed(1)}</span>;
  return <span className="delta flat">±0.0</span>;
};

// Provenance rail — the signature motif.
// Repo → Commit/Ref → Eval → Approval → Release. Steps may be ok/warn/fail/now.
const ProvenanceRail = ({ steps }) => {
  return (
    <div className="rail">
      {steps.map((s, i) => (
        <div className={`rail-step ${s.state || ""}`} key={i}>
          <div className="rs-label">
            <span className="rs-node" />
            <span>{s.label}</span>
          </div>
          <div className="rs-value">{s.value}</div>
          {s.meta ? <div className="rs-meta">{s.meta}</div> : null}
        </div>
      ))}
    </div>
  );
};

// Score / rubric bar with baseline marker
const ScoreBar = ({ label, baseline, candidate, dir }) => {
  const cls = dir === "down" ? "bar-fill fail" : (dir === "up" ? "bar-fill" : "bar-fill warn");
  return (
    <div className="bar">
      <div className="bar-label">{label}</div>
      <div className="bar-track">
        <div className={cls} style={{ width: `${candidate * 100}%` }} />
        <div className="bar-baseline" style={{ left: `${baseline * 100}%` }} title={`Baseline ${baseline}`} />
      </div>
      <div className="bar-value">
        {candidate.toFixed(2)}
        <span className="muted" style={{ fontSize: 10.5, marginLeft: 4, fontFamily: "var(--mono)" }}>
          ({dir === "up" ? "+" : "−"}{Math.abs(candidate - baseline).toFixed(2)})
        </span>
      </div>
    </div>
  );
};

// Tiny "facet" filter button
const Facet = ({ active, onClick, children, count }) => (
  <button className={`facet ${active ? "active" : ""}`} onClick={onClick}>
    {children}
    {count != null ? <span className="f-count">{count}</span> : null}
  </button>
);

// Kbd
const Kbd = ({ children }) => (
  <span style={{
    fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--muted)",
    border: "1px solid var(--rule-2)", borderRadius: 3, padding: "1px 5px",
    background: "var(--linen)"
  }}>{children}</span>
);

Object.assign(window, { ProviderIcon, RepoChip, CommitRef, BranchRef, TagRef, EnvPill, Tier, Sparkline, Delta, ProvenanceRail, ScoreBar, Facet, Kbd });
