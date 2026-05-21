// app.jsx — App shell, routing, tweaks.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "moss",
  "density": "regular",
  "serifHeadings": true
}/*EDITMODE-END*/;

const ACCENT_PALETTES = {
  moss:    { accent: "#5C6B4F", soft: "#E8EBE0", deep: "#3F4A36" },
  brass:   { accent: "#B8860B", soft: "#F5E9C8", deep: "#8A6309" },
  oxblood: { accent: "#8B3A2F", soft: "#F2DAD2", deep: "#6B2A22" },
  slate:   { accent: "#4A5568", soft: "#E2E5EA", deep: "#2D3748" },
  ink:     { accent: "#1C1B18", soft: "#E5DFD3", deep: "#000000" },
};

function applyTweaksToRoot(t) {
  const root = document.documentElement;
  const p = ACCENT_PALETTES[t.accent] || ACCENT_PALETTES.moss;
  root.style.setProperty("--accent",      p.accent);
  root.style.setProperty("--accent-soft", p.soft);
  root.style.setProperty("--accent-deep", p.deep);

  // density class on body
  document.body.classList.remove("density-compact", "density-regular", "density-roomy");
  document.body.classList.add(`density-${t.density}`);

  // serif headings toggle
  document.body.classList.toggle("serif-off", !t.serifHeadings);
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = React.useState({ name: "overview", skillId: null });
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [focusedSkill, setFocusedSkill] = React.useState("skl_ccr");

  React.useEffect(() => { applyTweaksToRoot(t); }, [t]);

  const goto = (name, arg) => {
    if (name === "onboarding") { setShowOnboarding(true); return; }
    if (name === "skill") { setRoute({ name: "skill", skillId: arg || focusedSkill }); return; }
    setRoute({ name, skillId: null });
    document.querySelector(".page")?.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <Sidebar route={route} goto={goto} />
      <TopBar route={route} goto={goto} />
      <div className="page" key={route.name + (route.skillId || "")}>
        {route.name === "overview" && <ScreenOverview goto={goto} />}
        {route.name === "catalog" && (
          <ScreenCatalog
            goto={goto}
            focusId={focusedSkill}
            setFocusId={setFocusedSkill}
          />
        )}
        {route.name === "skill" && (
          <ScreenSkill skillId={route.skillId || focusedSkill} goto={goto} />
        )}
        {route.name === "repositories" && <ScreenRepositories goto={goto} />}
        {route.name === "evaluations" && <ScreenEvaluations goto={goto} />}
        {route.name === "releases" && <ScreenReleases goto={goto} />}
        {route.name === "policies" && <ScreenPolicies goto={goto} />}
        {route.name === "audit" && <ScreenAudit goto={goto} />}
        {route.name === "connectors" && <ScreenConnectors goto={goto} />}
        {route.name === "settings" && <ScreenSettings goto={goto} />}
      </div>

      {showOnboarding && (
        <ScreenOnboarding
          onClose={() => setShowOnboarding(false)}
          onComplete={() => {
            setShowOnboarding(false);
            goto("overview");
          }}
        />
      )}

      <TweaksPanel>
        <TweakSection label="Accent" />
        <TweakColor
          label="Accent color"
          value={ACCENT_PALETTES[t.accent].accent}
          options={Object.values(ACCENT_PALETTES).map(p => p.accent)}
          onChange={(hex) => {
            const key = Object.keys(ACCENT_PALETTES).find(k => ACCENT_PALETTES[k].accent === hex) || "moss";
            setTweak("accent", key);
          }}
        />
        <TweakSection label="Layout" />
        <TweakRadio
          label="Density"
          value={t.density}
          options={["compact", "regular", "roomy"]}
          onChange={(v) => setTweak("density", v)}
        />
        <TweakSection label="Typography" />
        <TweakToggle
          label="Serif headings"
          value={t.serifHeadings}
          onChange={(v) => setTweak("serifHeadings", v)}
        />
      </TweaksPanel>
    </div>
  );
}

function Sidebar({ route, goto }) {
  const { ORG, SKILLS, REPOS, EVAL_RUNS, RELEASES, POLICIES, AUDIT_FULL, CONNECTORS } = window.SAVANT;
  const workspaceItems = [
    { id: "overview",     label: "Overview",     icon: Ic.Overview,    count: null },
    { id: "catalog",      label: "Skills",       icon: Ic.Skills,      count: SKILLS.length },
    { id: "repositories", label: "Repositories", icon: Ic.Repo,        count: REPOS.length },
    { id: "evaluations",  label: "Evaluations",  icon: Ic.Eval,        count: EVAL_RUNS.filter(r => r.status === "running").length || EVAL_RUNS.length },
    { id: "releases",     label: "Releases",     icon: Ic.Release,     count: RELEASES.length },
  ];
  const govItems = [
    { id: "policies",     label: "Policies",     icon: Ic.Policy,     count: POLICIES.filter(p => p.state === "active").length },
    { id: "audit",        label: "Audit",        icon: Ic.Audit,      count: null },
    { id: "connectors",   label: "Connectors",   icon: Ic.Connectors, count: CONNECTORS.length },
  ];

  const isActive = (id) => {
    if (id === "catalog" && (route.name === "catalog" || route.name === "skill")) return true;
    return route.name === id;
  };

  const renderItem = (it) => {
    const Icon = it.icon;
    return (
      <div
        key={it.id}
        className={`nav-item ${isActive(it.id) ? "active" : ""}`}
        onClick={() => goto(it.id)}
      >
        <Icon className="nav-icon" />
        <span>{it.label}</span>
        {it.count != null ? <span className="nav-count num">{it.count}</span> : null}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="brand" onClick={() => goto("overview")}>
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="var(--ink)" strokeWidth="1.5" />
            <path d="M7 12h10M7 8h10M7 16h6" stroke="var(--moss)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="brand-name">Savant</div>
      </div>

      <nav className="nav">
        <div className="nav-group">
          <div className="nav-group-label">Workspace</div>
          {workspaceItems.map(renderItem)}
        </div>

        <div className="nav-group">
          <div className="nav-group-label">Governance</div>
          {govItems.map(renderItem)}
        </div>
      </nav>

      {/* Settings — pinned above user profile */}
      <div className="nav-pinned">
        <div
          className={`nav-item ${isActive("settings") ? "active" : ""}`}
          onClick={() => goto("settings")}
        >
          <Ic.Settings className="nav-icon" />
          <span>Settings</span>
        </div>
      </div>

      <div className="sidebar-foot">
        <div className="avatar">{ORG.user.initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="foot-user-name">{ORG.user.name}</div>
          <div className="foot-user-role">{ORG.user.role}</div>
        </div>
        <button className="icon-btn" style={{ marginLeft: "auto" }}>
          <Ic.ChevR style={{ width: 12, height: 12 }} />
        </button>
      </div>
    </aside>
  );
}

function TopBar({ route, goto }) {
  const { ORG } = window.SAVANT;

  const crumbs = (() => {
    const titles = {
      overview: "Overview",
      catalog: "Skills",
      repositories: "Repositories",
      evaluations: "Evaluations",
      releases: "Releases",
      policies: "Policies",
      audit: "Audit",
      connectors: "Connectors",
      settings: "Settings",
    };
    if (route.name === "skill") {
      const skill = window.SAVANT.SKILLS.find(s => s.id === route.skillId);
      return [
        ["Workspace", null],
        ["Skills", () => goto("catalog")],
        [skill?.name || "Skill", "current"],
      ];
    }
    const group = ["policies", "audit", "connectors"].includes(route.name) ? "Governance"
                : route.name === "settings" ? "System"
                : "Workspace";
    return [[group, null], [titles[route.name] || "Overview", "current"]];
  })();

  return (
    <header className="topbar">
      {/* Org switcher */}
      <button className="btn btn-sm" style={{ background: "var(--ivory)", border: "1px solid var(--rule-2)" }}>
        <span style={{
          width: 16, height: 16, background: "var(--ink)", color: "var(--linen)",
          display: "grid", placeItems: "center", borderRadius: 3, fontSize: 9, fontWeight: 600
        }}>{ORG.short}</span>
        <span>{ORG.name}</span>
        <Ic.ChevD className="b-icon" />
      </button>

      <div className="crumbs">
        {crumbs.map(([label, fn], i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {typeof fn === "function" ? (
              <span style={{ cursor: "default" }} className="link" onClick={fn}>{label}</span>
            ) : (
              <span className={fn === "current" ? "current" : ""}>{label}</span>
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="env-pill" title="Environment">
        <span className="dot" />
        <span>{ORG.env}</span>
      </div>

      <div className="topbar-search">
        <Ic.Search className="s-icon" />
        <input placeholder="Search skills, repos, evals, releases…" />
        <span className="kbd">⌘ K</span>
      </div>

      <button className="icon-btn" title="Notifications">
        <Ic.Bell style={{ width: 14, height: 14 }} />
        <span className="badge-dot" />
      </button>

      <button className="icon-btn" title="Settings">
        <Ic.Settings style={{ width: 14, height: 14 }} />
      </button>
    </header>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
