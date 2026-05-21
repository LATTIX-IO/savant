// screen-onboarding.jsx — Repository Connection Flow
// 4 steps: Choose path (connect / provision) → Pick provider → Repo details → Validate
// Renders as an overlay so it stays a focused, calm modal experience.

function ScreenOnboarding({ onClose, onComplete }) {
  const [step, setStep] = React.useState(0);
  const [path, setPath] = React.useState("connect");      // 'connect' | 'provision'
  const [provider, setProvider] = React.useState("github");
  const [repoUrl, setRepoUrl] = React.useState("github.com/wexler-hahn/finance-skills");
  const [branch, setBranch] = React.useState("main");
  const [name, setName] = React.useState("Finance Skills");

  const steps = [
    { title: "Choose path",   sub: "Connect existing or provision new" },
    { title: "Pick provider", sub: "Where the repository lives" },
    { title: "Repo details",  sub: "URL, branch, and identity" },
    { title: "Validate",      sub: "Confirm structure and manifests" },
  ];

  const next = () => setStep(s => Math.min(s + 1, steps.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  return (
    <div className="onboarding" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="onboarding-shell">
        {/* Left: stepper */}
        <div className="onb-rail">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>/02 — Connect</div>
            <div className="h-display" style={{ fontSize: 22, marginBottom: 4 }}>Add a repository</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
              Savant treats your Git repository as the source of truth for skill content.
              Approvals, evaluations, and releases live here.
            </div>
          </div>

          <div className="col" style={{ marginTop: 14, gap: 0 }}>
            {steps.map((s, i) => (
              <div key={i} className={`onb-step ${i < step ? "done" : i === step ? "active" : "upcoming"}`}>
                <div className="onb-num">
                  {i < step ? <Ic.Check style={{ width: 11, height: 11 }} /> : (i + 1)}
                </div>
                <div>
                  <div className="onb-t">{s.title}</div>
                  <div className="onb-s">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto" }}>
            <div className="note">
              <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
              <div style={{ fontSize: 11.5 }}>
                Savant only reads from your repository. Skill content stays in your Git environment.
              </div>
            </div>
          </div>
        </div>

        {/* Right: body */}
        <div className="onb-body">
          {step === 0 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>Step 1 of 4</div>
                <div className="h-display" style={{ fontSize: 26 }}>How would you like to start?</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 480 }}>
                  Connect a repository that already contains skills, or provision a new one
                  from a Savant-validated template.
                </div>
              </div>

              <div className="choice-grid">
                <button className={`choice ${path === "connect" ? "selected" : ""}`} onClick={() => setPath("connect")}>
                  <div className="choice-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                    </svg>
                  </div>
                  <div className="choice-title">Connect existing repository</div>
                  <div className="choice-sub">
                    You already have skill files in a Git repository. Savant will read structure,
                    validate manifests, and ingest tracked skills.
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: "auto" }}>
                    <span className="chip chip-paper">read-only</span>
                    <span className="chip chip-paper">webhook sync</span>
                  </div>
                </button>

                <button className={`choice ${path === "provision" ? "selected" : ""}`} onClick={() => setPath("provision")}>
                  <div className="choice-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                      <rect x="3" y="4" width="18" height="14" rx="1.5"/>
                      <path d="M12 9v6M9 12h6"/>
                    </svg>
                  </div>
                  <div className="choice-title">Provision new repository</div>
                  <div className="choice-sub">
                    Savant creates a new repository in your Git environment from a template
                    with manifests, eval scaffolding, and example tier‑1 skills.
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: "auto" }}>
                    <span className="chip chip-paper">tier-1 template</span>
                    <span className="chip chip-paper">eval scaffolding</span>
                  </div>
                </button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>Step 2 of 4</div>
                <div className="h-display" style={{ fontSize: 26 }}>Where does your repository live?</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 480 }}>
                  Savant is provider-agnostic. Pick where your skill repository is hosted.
                </div>
              </div>

              <div className="provider-grid">
                {[
                  { id: "github",    name: "GitHub",        meta: "Cloud or Enterprise" },
                  { id: "gitlab",    name: "GitLab",        meta: "Cloud or self-managed" },
                  { id: "azure",     name: "Azure DevOps",  meta: "Microsoft Entra ID" },
                  { id: "bitbucket", name: "Bitbucket",     meta: "Cloud or Data Center" },
                  { id: "selfhosted",name: "Self-hosted Git", meta: "SSH or HTTPS endpoint" },
                  { id: "more",      name: "Other provider",meta: "Generic Git protocol" },
                ].map(p => (
                  <button
                    key={p.id}
                    className={`provider ${provider === p.id ? "selected" : ""}`}
                    onClick={() => setProvider(p.id)}
                  >
                    <ProviderIcon p={p.id} size={20} />
                    <div className="col" style={{ gap: 1 }}>
                      <div className="provider-name">{p.name}</div>
                      <div className="provider-meta">{p.meta}</div>
                    </div>
                    {provider === p.id ? (
                      <Ic.CheckCircle style={{ marginLeft: "auto", color: "var(--moss)", width: 14, height: 14 }} />
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="note" style={{ marginTop: 14 }}>
                <Ic.Lock className="n-icon" style={{ color: "var(--slate)" }} />
                <div style={{ fontSize: 12 }}>
                  Savant authenticates via an OAuth app or installation token. Credentials are
                  encrypted at rest and never exposed to skill content.
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>Step 3 of 4</div>
                <div className="h-display" style={{ fontSize: 26 }}>
                  {path === "connect" ? "Point Savant at your repository" : "Name the new repository"}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 480 }}>
                  {path === "connect"
                    ? "Use the full URL of an existing repository. Savant will resolve the default branch and look for a skill manifest."
                    : "Savant will create this repository in your environment using the tier-1 starter template."}
                </div>
              </div>

              <div>
                <div className="field">
                  <div className="field-label">Repository URL</div>
                  <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} />
                  <div className="field-help">
                    Example: <span className="mono">github.com/your-org/your-repo</span>
                  </div>
                </div>

                <div className="row" style={{ gap: 14 }}>
                  <div className="field grow">
                    <div className="field-label">Default branch</div>
                    <input value={branch} onChange={e => setBranch(e.target.value)} />
                  </div>
                  <div className="field grow">
                    <div className="field-label">Display name</div>
                    <input value={name} onChange={e => setName(e.target.value)} />
                  </div>
                </div>

                <div className="field">
                  <div className="field-label">Tier policy</div>
                  <select defaultValue="t2">
                    <option value="t1">Tier 1 — Strict (compliance approval required)</option>
                    <option value="t2">Tier 2 — Standard (owner + reviewer approval)</option>
                    <option value="t3">Tier 3 — Lightweight (owner approval only)</option>
                  </select>
                  <div className="field-help">
                    Default tier for skills ingested from this repository. Individual skills can override.
                  </div>
                </div>

                <div className="field">
                  <div className="field-label">Sync mode</div>
                  <div className="row" style={{ gap: 8 }}>
                    <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                      <input type="radio" name="sync" defaultChecked /> Webhook (real-time)
                    </label>
                    <label className="row" style={{ gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
                      <input type="radio" name="sync" /> Polled (every 5 min)
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>Step 4 of 4</div>
                <div className="h-display" style={{ fontSize: 26 }}>Validate repository structure</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 520 }}>
                  Savant ran a dry-run check against {repoUrl} on branch <span className="mono">{branch}</span>.
                </div>
              </div>

              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-hd">
                  <div className="panel-title">Repository check</div>
                  <span className="chip chip-moss"><Ic.Check style={{ width: 10, height: 10 }} />ready to ingest</span>
                </div>
                <div className="panel-bd" style={{ padding: "0 var(--pad-card)" }}>
                  <ValidateRow ok label="Authentication" meta="oauth-app · wexler-hahn-prod" />
                  <ValidateRow ok label="Default branch resolved" meta={branch} />
                  <ValidateRow ok label="Skill manifest found" meta=".savant/manifest.yaml" />
                  <ValidateRow ok label="Skills discovered"      meta="12 skills · 4 tier-1, 6 tier-2, 2 tier-3" />
                  <ValidateRow ok label="Eval scaffolding"       meta="rubric.yaml · 248 cases" />
                  <ValidateRow warn label="Webhook secret rotation"  meta="missing — Savant will use installation token" />
                  <ValidateRow ok label="Branch protection"       meta="enforced on main" />
                </div>
              </div>

              <div className="note">
                <Ic.CheckCircle className="n-icon" style={{ color: "var(--moss)" }} />
                <div style={{ fontSize: 12 }}>
                  On finish, Savant will ingest 12 skills as <span className="mono">draft</span>.
                  No skill is moved to staging or production without explicit approval.
                </div>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="onb-bd-foot">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <div className="row" style={{ gap: 8 }}>
              {step > 0 && <button className="btn btn-ghost" onClick={back}>Back</button>}
              {step < steps.length - 1
                ? <button className="btn btn-primary" onClick={next}>
                    <span>Continue</span>
                    <Ic.ChevR className="b-icon" />
                  </button>
                : <button className="btn btn-brass" onClick={onComplete}>
                    <Ic.Check className="b-icon" />
                    <span>Finish — ingest 12 skills</span>
                  </button>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ValidateRow({ ok, warn, fail, label, meta }) {
  return (
    <div className="validate-row">
      <span className={`v-icon ${warn ? "pending" : fail ? "fail" : ""}`}>
        {warn ? <Ic.Warn style={{ width: 14, height: 14 }} /> :
         fail ? <Ic.XCircle style={{ width: 14, height: 14 }} /> :
                <Ic.CheckCircle style={{ width: 14, height: 14 }} />}
      </span>
      <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{label}</span>
      <span className="v-meta mono">{meta}</span>
    </div>
  );
}

window.ScreenOnboarding = ScreenOnboarding;
