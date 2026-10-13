/* Savant prototype shell: navigation, theme, command search, overlays, charts, sample data.
   All figures are illustrative sample data for the prototype. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  /* Storage is namespaced per workspace so no asset is visible across workspaces.
     Only interface preferences (theme, navigation, density, current workspace) are global. */
  const PREFS = new Set(['theme', 'nav', 'density', 'ws']);
  const WS_ID = (() => { try { const v = JSON.parse(localStorage.getItem('sv-ws')); return v === 'rs' ? 'rs' : 'wh'; } catch (e) { return 'wh'; } })();
  const skey = k => PREFS.has(k) ? 'sv-' + k : `sv-${WS_ID}:${k}`;
  const store = {
    ws: WS_ID,
    get: (k, d) => { try { let v = localStorage.getItem(skey(k)); if (v === null && WS_ID === 'wh' && !PREFS.has(k)) v = localStorage.getItem('sv-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(skey(k), JSON.stringify(v)); } catch (e) {} },
    del: k => { try { localStorage.removeItem(skey(k)); if (WS_ID === 'wh') localStorage.removeItem('sv-' + k); } catch (e) {} }
  };

  /* ─── icons (monoline 16px) ─── */
  const P = {
    overview: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><path d="M9 11.25h4.5M11.25 9v4.5"/>',
    library: '<path d="M2.5 4.5 8 2l5.5 2.5L8 7z"/><path d="m2.5 8 5.5 2.5L13.5 8"/><path d="m2.5 11.5 5.5 2.5 5.5-2.5"/>',
    workbench: '<circle cx="3.5" cy="8" r="1.5"/><circle cx="12.5" cy="4" r="1.5"/><circle cx="12.5" cy="12" r="1.5"/><path d="M5 8h2.5m0 0c1.5 0 1.5-4 3.5-4M7.5 8c1.5 0 1.5 4 3.5 4"/>',
    evals: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="m5.5 8 1.8 1.8L10.8 6"/>',
    runs: '<path d="M2.5 4h5M2.5 8h8M2.5 12h3.5"/><path d="M12 10.5v3l2-1.5z"/>',
    insights: '<path d="M2.5 13.5h11"/><path d="m3.5 10 3-3 2.5 2 4-4.5"/><path d="M10.5 4.5H13v2.5"/>',
    integrations: '<path d="M6 2.5v3M10 2.5v3"/><path d="M4 5.5h8v2.5a4 4 0 0 1-8 0z"/><path d="M8 12v1.5"/>',
    settings: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
    guide: '<circle cx="8" cy="8" r="5.5"/><path d="m6.5 10.5 1-3 3-1-1 3z"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
    chev: '<path d="m6 4 4 4-4 4"/>', chevd: '<path d="m4 6 4 4 4-4"/>',
    plus: '<path d="M8 3v10M3 8h10"/>', x: '<path d="m4 4 8 8M12 4l-8 8"/>',
    more: '<circle cx="4" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="12" cy="8" r=".6"/>',
    sun: '<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
    moon: '<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>',
    sidebar: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/>',
    refresh: '<path d="M13 3.5v3h-3"/><path d="M12.6 6.5A5 5 0 1 0 13 9"/>',
    filter: '<path d="M2.5 3.5h11l-4.2 5v4l-2.6 1v-5z"/>',
    check: '<path d="m3.5 8.5 3 3 6-7"/>', alert: '<path d="M8 2 14 13H2z"/><path d="M8 6.5v3M8 11.2v.1"/>',
    branch: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 3-7 2-7 4"/>',
    play: '<path d="M5 3.5v9l7-4.5z"/>', clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
    file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>', folder: '<path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3A1 1 0 0 0 2 4.5z"/>',
    code: '<path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5"/>', compare: '<path d="M5 2.5v11M11 2.5v11"/><path d="m3 5 2-2.5L7 5M9 11l2 2.5 2-2.5"/>',
    arrow: '<path d="M3 8h10m-4-4 4 4-4 4"/>', download: '<path d="M8 2.5v8m-3-3 3 3 3-3M3 13.5h10"/>',
    key: '<circle cx="5" cy="10.5" r="2.5"/><path d="m6.8 8.7 6-6M11 4.5l1.5 1.5"/>', lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    git: '<circle cx="8" cy="8" r="2"/><path d="M8 2v4M8 10v4"/>', sliders: '<path d="M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>',
    pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>', ext: '<path d="M9 2.5h4.5V7M13.5 2.5 8 8M11 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5.5A.5.5 0 0 1 3 5h3.5"/>',
    list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1"/>', rows: '<rect x="2.5" y="2.5" width="11" height="4.5" rx="1"/><rect x="2.5" y="9" width="11" height="4.5" rx="1"/>',
    copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.2"/><path d="M11 5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5"/>',
    calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
    bell: '<path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3z"/><path d="M6.5 14a1.5 1.5 0 0 0 3 0"/>',
    user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.5-2.5 2.5-4 5-4s4.5 1.5 5 4"/>', shield: '<path d="M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4z"/>'
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 16 16" aria-hidden="true">${P[n] || ''}</svg>`;

  /* ─── deterministic sample generator ─── */
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function walk(seed, n, start, drift, noise, lo = 0, hi = 100) {
    const r = rng(seed); const out = []; let v = start;
    for (let i = 0; i < n; i++) { v += drift + (r() - 0.5) * noise; v = Math.max(lo, Math.min(hi, v)); out.push(+v.toFixed(1)); }
    return out;
  }

  /* ─── sample data (illustrative; fixtures from apps/web/src/lib/savant-data.ts) ─── */
  const skills = [
    { id: 'contract-clause-reviewer', name: 'Contract clause reviewer', tier: 'T1', team: 'Legal ops', owner: 'renata.m', repo: 'wh/legal-skills', ver: 'v4.1', cand: 'v4.2', env: 'production', state: 'candidate-awaiting-approval', score: 91.4, delta: 1.2, lastEval: '2h', runs: 1284, dataset: 'contract-corpus-v9', status: 'ok' },
    { id: 'incident-triage', name: 'Incident triage', tier: 'T1', team: 'SRE', owner: 'min.park', repo: 'platform/agent-skills', ver: 'v3.0', cand: 'v3.1', env: 'production', state: 'candidate-running-evals', score: 82.4, delta: -6.1, lastEval: '38m', runs: 2210, dataset: 'sev-2-corpus-v3', status: 'p1', note: 'Candidate v3.1 regressed 6.1 pts' },
    { id: 'pr-summarizer', name: 'PR summarizer', tier: 'T2', team: 'Platform', owner: 'ari.chen', repo: 'wh/skills', ver: 'v2.3', env: 'production', state: 'production', score: 89.7, delta: 0.4, lastEval: '1d', runs: 4105, dataset: 'pr-corpus-v6', status: 'ok' },
    { id: 'rfp-response-drafter', name: 'RFP response drafter', tier: 'T2', team: 'Sales ops', owner: 'kalia.b', repo: 'wh/skills', ver: 'v1.4', env: 'staging', state: 'staging', score: 84.2, delta: 2.9, lastEval: '5h', runs: 312, dataset: 'rfp-corpus-v2', status: 'ok' },
    { id: 'soc2-evidence-drafter', name: 'SOC 2 evidence drafter', tier: 'T1', team: 'Security', owner: 'sasha.gw', repo: 'wh/legal-skills', ver: 'v1.1', env: 'staging', state: 'staging', score: 86.0, delta: 0.0, lastEval: '21d', runs: 96, dataset: 'soc2-evidence-v1', status: 'p3', note: 'Last evaluation 21 days ago' },
    { id: 'engineering-rfc-reviewer', name: 'Engineering RFC reviewer', tier: 'T2', team: 'Platform', owner: 'jdv', repo: 'platform/agent-skills', ver: 'v2.0', env: 'production', state: 'production', score: 87.1, delta: -0.8, lastEval: '3d', runs: 640, dataset: 'rfc-corpus-v4', status: 'p2', note: 'Edit rate near threshold (31%)' },
    { id: 'customer-email-tone-pass', name: 'Customer email tone pass', tier: 'T3', team: 'Support', owner: 'kalia.b', repo: 'wh/skills', ver: 'v3.2', env: 'production', state: 'production', score: 93.0, delta: 0.2, lastEval: '2d', runs: 8930, dataset: 'email-tone-v2', status: 'ok' },
    { id: 'quarterly-earnings-summary', name: 'Quarterly earnings summary', tier: 'T2', team: 'Finance', owner: 'renata.m', repo: 'research/internal-tools', ver: 'v0.9', env: 'draft', state: 'draft', score: 78.3, delta: 3.4, lastEval: '6d', runs: 41, dataset: 'earnings-v1', status: 'ok' },
    { id: 'vendor-onboarding-memo', name: 'Vendor onboarding memo', tier: 'T3', team: 'Procurement', owner: 'jdv', repo: 'ops/runbooks', ver: 'v0.4', env: 'draft', state: 'draft', score: null, delta: null, lastEval: '—', runs: 0, dataset: '—', status: 'unk', note: 'No evaluation yet' }
  ];
  skills.forEach((s, i) => { s.trend = s.score == null ? [] : walk(17 + i * 31, 30, s.score - (s.delta || 0) - 1.5, 0.05, 2.2, 60, 99).map((v, j, a) => j === a.length - 1 ? s.score : v); s.runTrend = walk(91 + i * 7, 14, 50, 0.6, 30, 5, 100); });

  /* ─── shared prototype data model ───
     One persisted store for repositories, skills and runs so every screen shows the same state.
     Anything created by a simulated operation carries sim: true and is labelled "Simulated". */
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const BASE_REPOS = [
    { n: 'wh/skills', pv: 'GitHub', conn: 'wh', auth: 'active', sync: 'ok', skills: 4, last: '2m', hist: 'oooooooooo' },
    { n: 'wh/legal-skills', pv: 'GitHub', conn: 'wh-legal', auth: 'needs_reauthorization', sync: 'auth_required', skills: 2, last: '3h', hist: 'oooooooooww' },
    { n: 'platform/agent-skills', pv: 'GitLab', conn: 'platform', auth: 'active', sync: 'ok', skills: 2, last: '2m', hist: 'oooooooooo' },
    { n: 'research/internal-tools', pv: 'Azure Repos', conn: 'research', auth: 'active', sync: 'stale', skills: 1, last: '6d', hist: 'ooooooo---' },
    { n: 'ops/runbooks', pv: 'Bitbucket', conn: 'ops', auth: 'active', sync: 'error', skills: 1, last: '1h', hist: 'ooooooooff', errs: ['skills/oncall-handoff/SKILL.md:1  frontmatter missing required field "name"', 'skills/postmortem-drafter/SKILL.md:4  description exceeds 1024 characters (1311)'] }
  ];
  const BASE_RUNS = [
    { id: 'EV-2418', skill: 'incident-triage', v: 'v3.1', b: 'v3.0', st: 'regressed', n: 180, fail: 19, q: 82.4, dq: -6.1, when: '09:42', dur: '11m 04s', cost: 3.71, tok: '1.92M', p95: 6400 },
    { id: 'EV-2417', skill: 'contract-clause-reviewer', v: 'v4.2', b: 'v4.1', st: 'passed', n: 180, fail: 0, q: 92.6, dq: 1.2, when: '07:58', dur: '14m 31s', cost: 4.12, tok: '2.40M', p95: 4100 },
    { id: 'EV-2416', skill: 'rfp-response-drafter', v: 'v1.4', b: 'v1.3', st: 'passed', n: 120, fail: 11, q: 84.2, dq: 2.9, when: 'Yest.', dur: '9m 12s', cost: 2.02, tok: '1.10M', p95: 5200 },
    { id: 'EV-2415', skill: 'pr-summarizer', v: 'v2.3', b: '—', st: 'baseline', n: 240, fail: 9, q: 89.7, dq: 0, when: 'Yest.', dur: '12m 40s', cost: 2.61, tok: '1.31M', p95: 3300 },
    { id: 'EV-2414', skill: 'quarterly-earnings-summary', v: 'v0.9', b: '—', st: 'failed', n: 60, fail: 60, when: '6 Oct', err: 'Model connection returned 401 · key revoked during run' }
  ];
  const NEW_SKILL_NAMES = ['Invoice matcher', 'Policy question answering', 'Meeting notes digest', 'Release notes writer', 'Data request triage', 'Access request reviewer', 'Board minutes drafter', 'Change ticket summary', 'Literature summarizer', 'Experiment log writer', 'Agent trace explainer'];
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hash = t => { let h = 2166136261; for (const c of String(t)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const MS_PER_CASE = 600;

  /* Acceptance gates. Each gate is evaluated independently against the run's measured metrics. */
  const SUITE_GATES = {
    'incident-triage': [['quality', '>=', 85, true], ['drop', '<=', 2.0, true], ['p95', '<=', 6000, false], ['cost', '<=', 0.05, false]],
    'contract-clause-reviewer': [['quality', '>=', 88, true], ['drop', '<=', 1.0, true]],
    'pr-summarizer': [['quality', '>=', 85, true]],
    'rfp-response-drafter': [['improve', '>', 0, true]],
    'soc2-evidence-drafter': [['quality', '>=', 85, true]],
    'engineering-rfc-reviewer': [['quality', '>=', 85, true], ['drop', '<=', 2.0, true]],
    'customer-email-tone-pass': [['quality', '>=', 90, true]],
    'quarterly-earnings-summary': [['quality', '>=', 80, true]]
  };
  const DEFAULT_GATES = [['quality', '>=', 85, true], ['drop', '<=', 2.0, true]];
  const METRIC = {
    quality: { label: 'Quality score', get: r => r.q, fmt: v => v.toFixed(1) },
    drop: { label: 'Drop vs baseline', get: r => r.b === '—' ? null : Math.max(0, -r.dq), fmt: v => v.toFixed(1) },
    improve: { label: 'Change vs baseline', get: r => r.b === '—' ? null : r.dq, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) },
    p95: { label: 'Latency P95 (ms)', get: r => r.p95, fmt: v => String(Math.round(v)) },
    cost: { label: 'Cost per case (USD)', get: r => r.cost != null && r.n ? r.cost / r.n : null, fmt: v => v.toFixed(3) },
    grounding: { label: 'Evidence grounding', get: r => r.q != null ? r.q - 1.5 : null, fmt: v => v.toFixed(1) },
    edits: { label: 'Human edits needed', get: r => r.q != null ? +(Math.max(0, (92 - r.q) / 8)).toFixed(1) : null, fmt: v => v.toFixed(1) }
  };
  const CRIT_KIND = { 'Quality score': 'quality', 'Drop vs baseline': 'drop', 'Latency P95 (ms)': 'p95', 'Estimated cost (USD) per case': 'cost', 'Evidence grounding score': 'grounding', 'Human edits needed': 'edits' };
  const cmp = (v, op, t) => op === '>=' || op === '≥' ? v >= t : op === '<=' || op === '≤' ? v <= t : op === '>' ? v > t : op === '<' ? v < t : v === t;
  function gates(r) {
    if (r.q == null || r.err) return [];
    const spec = r.gates || SUITE_GATES[r.skill] || DEFAULT_GATES;
    return spec.map(([kind, op, t, block]) => { const m = METRIC[kind], v = m.get(r);
      if (v == null) return { kind, label: m.label, op, t, block, value: null, shown: 'n/a', pass: true, na: true };
      return { kind, label: m.label, op, t, block, value: v, shown: m.fmt(v), pass: cmp(v, op, t) }; });
  }
  function statusOf(r, g) {
    if (r.err) return 'failed';
    const failed = g.filter(x => x.block && !x.pass);
    if (failed.some(x => x.kind === 'drop' || x.kind === 'improve')) return 'regressed';
    if (failed.length) return 'gate-failed';
    return r.b === '—' ? 'baseline' : 'passed';
  }
  const finish = r => { const g = gates(r); return { ...r, gateResults: g, st: statusOf(r, g) }; };

  function freshDb(ws) {
    if (ws === 'rs') return { v: 3, ws, repos: [], skills: [], runs: [], sources: {}, seq: 100, sim: [] };
    return { v: 3, ws, repos: BASE_REPOS.map(r => ({ ...r })), skills: [], seq: 2421, sim: [], sources: {},
      runs: [{ id: 'EV-2419', skill: 'incident-triage', v: 'v3.1', b: 'v3.0', n: 180, t0: Date.now() - 132 * MS_PER_CASE, note: 'Rerun after timeout change', result: { q: 87.9, dq: -0.6, fail: 8 } },
        { id: 'EV-2420', skill: 'rfp-response-drafter', v: 'v1.5', b: 'v1.4', n: 120, t0: Date.now() - 41 * MS_PER_CASE, result: { q: 85.6, dq: 1.4, fail: 9 } }] };
  }
  // the Research sandbox has no Wexler & Hahn skills at all
  if (WS_ID !== 'wh') skills.length = 0;
  let D = store.get('db', null);
  if (!D || D.v !== 3 || D.ws !== WS_ID) {
    const old = D && D.v === 2 && WS_ID === 'wh' ? D : null;
    D = freshDb(WS_ID);
    if (old) { D.repos = old.repos; D.runs = old.runs; D.seq = old.seq; D.sim = old.sim || [];
      // migrate: collapse duplicate imports from the earlier non-idempotent indexer
      const seen = new Set(); D.skills = (old.skills || []).filter(k => { const key = (k.repo || '') + '|' + k.name; if (seen.has(key)) return false; seen.add(key); return true; });
      D.repos.forEach(r => { const n = D.skills.filter(k => k.repo === r.n).length; if (r.sim) r.skills = n; }); }
    store.set('db', D);
  }
  const saveDb = () => store.set('db', D);
  const hydrate = s => { s.trend = s.score == null ? [] : walk(s.name.length * 7, 30, s.score - 2, 0.05, 2, 60, 99); s.runTrend = s.runTrend || Array(14).fill(0.01); return s; };
  D.skills.forEach(s => { if (!skills.some(k => k.id === s.id)) skills.push(hydrate({ ...s })); });
  function liveRun(r) {
    if (r.st && r.st !== 'running') return finish(r);
    const done = Math.min(r.n, Math.floor((Date.now() - r.t0) / MS_PER_CASE));
    if (r.canceled) return { ...r, st: 'failed', done, err: r.canceled, gateResults: [] };
    if (done < r.n) return { ...r, st: 'running', done, when: 'now', gateResults: [] };
    const sk = skills.find(k => k.id === r.skill), res = r.result || { q: sk?.score ?? 80, dq: 0, fail: Math.round(r.n * 0.08) };
    return finish({ ...r, done, q: res.q, dq: res.dq, fail: res.fail, when: new Date(r.t0).toTimeString().slice(0, 5), dur: `${Math.round(r.n * 3.7 / 60)}m`, cost: +(r.n * 0.021).toFixed(2), tok: (r.n * 0.0107).toFixed(2) + 'M', p95: res.p95 ?? 4800 });
  }
  const repoSkillNames = n => { const h = hash(n), out = []; for (let i = 0; out.length < 3; i++) { const nm = NEW_SKILL_NAMES[(h + i * 7) % NEW_SKILL_NAMES.length]; if (!out.includes(nm)) out.push(nm); } return out; };
  const db = {
    esc, gates, slug, ws: WS_ID,
    repos: () => D.repos,
    skills: () => skills,
    save: saveDb,
    runs: () => [...D.runs.map(liveRun).reverse(), ...(WS_ID === 'wh' ? BASE_RUNS.map(finish) : [])],
    run: id => db.runs().find(r => r.id === id),
    addRun({ skill, v, b, n = 180, note, criteria, result, t0 }) {
      const sk = skills.find(k => k.id === skill), id = 'EV-' + (++D.seq);
      const q = sk?.score != null ? +(sk.score + ((D.seq % 5) - 2) * 0.7).toFixed(1) : 79 + (D.seq % 7);
      // criteria from the evaluation builder become this run's gates
      const g = criteria && criteria.length ? criteria.map(c => [CRIT_KIND[c[0]] || 'quality', c[1], parseFloat(c[2]), c[3] === 'Blocks promotion']).filter(x => !isNaN(x[2])) : null;
      D.runs.push({ id, skill, v: v || sk?.cand || sk?.ver || 'v0.1', b: b ?? (sk?.cand ? sk.ver : '—'), n, t0: t0 ?? Date.now(), note, sim: true, gates: g, result: result || { q, dq: sk?.score != null ? +(q - sk.score).toFixed(1) : 0, fail: Math.round(n * (1 - q / 100) * 0.8) } });
      D.sim.unshift([hhmm(), `Started ${id} for ${sk ? sk.name : skill}`]); saveDb(); return id;
    },
    updateRun(id, patch) { const r = D.runs.find(x => x.id === id); if (r) { Object.assign(r, patch); saveDb(); } },
    addRepo({ n, pv }) {
      if (D.repos.some(r => r.n === n)) return D.repos.find(r => r.n === n);
      const owner = n.split('/')[0], conn = D.repos.find(r => r.n.split('/')[0] === owner)?.conn || owner;
      const r = { n, pv, conn, auth: 'active', sync: 'indexing', skills: 0, last: 'now', hist: '---------o', sim: true };
      D.repos.push(r); D.sim.unshift([hhmm(), `Connected ${n}`]); saveDb(); return r;
    },
    /* Idempotent: a skill's identity is repository + manifest path, so re-indexing reconciles instead of duplicating. */
    indexRepo(n, names) {
      const r = D.repos.find(x => x.n === n); if (!r) return { added: [], updated: [], all: [] };
      const added = [], updated = [];
      (names || repoSkillNames(n)).forEach(name => {
        const path = `skills/${slug(name)}/SKILL.md`, id = `${slug(n)}--${slug(name)}`;
        const ex = D.skills.find(k => k.id === id || (k.repo === n && k.path === path));
        if (ex) { ex.indexedAt = Date.now(); updated.push(ex); return; }
        const sk = { id, name, path, tier: 'T3', team: 'Unassigned', owner: '—', repo: n, ver: 'v0.1', env: 'draft', state: 'draft', score: null, delta: null, lastEval: '—', runs: 0, dataset: '—', status: 'unk', sim: true, note: 'Imported as a draft · not evaluated', indexedAt: Date.now() };
        D.skills.push(sk); skills.push(hydrate({ ...sk })); added.push(sk);
      });
      const all = D.skills.filter(k => k.repo === n);
      Object.assign(r, { sync: 'ok', skills: all.length, last: 'now' }); D.sim.unshift([hhmm(), `Indexed ${n} · ${added.length} added, ${updated.length} unchanged`]); saveDb();
      return { added, updated, all };
    },
    addSkill(sk) { const full = { tier: 'T3', team: 'Unassigned', owner: '—', ver: 'v0.1', env: 'draft', state: 'draft', score: null, delta: null, lastEval: '—', runs: 0, dataset: '—', status: 'unk', sim: true, ...sk }; if (skills.some(k => k.id === full.id)) return null; D.skills.push(full); skills.push(hydrate({ ...full })); saveDb(); return full; },
    /* Saved skill source is canonical and separate from unsaved drafts. */
    source: id => D.sources[id] || null,
    saveSource(id, src) { const prev = D.sources[id]; D.sources[id] = { src, rev: (prev?.rev || 0) + 1, at: Date.now() }; saveDb(); return D.sources[id]; },
    setRepo(n, patch) { const r = D.repos.find(x => x.n === n); if (r) { Object.assign(r, patch); saveDb(); } },
    connections() {
      const by = {}; D.repos.forEach(r => { (by[r.conn] = by[r.conn] || { conn: r.conn, pv: r.pv, repos: 0, auth: 'active', sim: false }); by[r.conn].repos++; if (r.auth !== 'active') by[r.conn].auth = r.auth; if (r.sim) by[r.conn].sim = true; });
      return Object.values(by);
    },
    reset() { D = freshDb(WS_ID); saveDb(); location.reload(); }
  };

  const pages = [
    { id: 'overview', href: 'overview.html', label: 'Overview', ic: 'overview' },
    { id: 'library', href: 'library.html', label: 'Library', ic: 'library', count: skills.length },
    { id: 'workbench', href: 'workbench.html', label: 'Workbench', ic: 'workbench' },
    { id: 'evaluations', href: 'evaluations.html', label: 'Evaluations', ic: 'evals' },
    { id: 'runs', href: 'runs.html', label: 'Runs', ic: 'runs' },
    { id: 'insights', href: 'insights.html', label: 'Insights', ic: 'insights' },
    { sep: true },
    { id: 'integrations', href: 'integrations.html', label: 'Integrations', ic: 'integrations' },
    { id: 'settings', href: 'settings.html', label: 'Settings', ic: 'settings' }
  ];

  /* ─── theme / density / nav ─── */
  function setTheme(t) { document.documentElement.dataset.theme = t; store.set('theme', t); const b = $('#theme-btn'); if (b) b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon'); }
  function toggleNav() { const c = document.documentElement.dataset.nav === 'collapsed' ? 'open' : 'collapsed'; document.documentElement.dataset.nav = c; store.set('nav', c); }

  /* ─── shell ─── */
  function mount(ev) {
    const app = $('#app'); if (!app) return;
    const cur = document.body.dataset.page;
    const wsList = [{ id: 'wh', name: 'Wexler &amp; Hahn', short: 'WH' }, { id: 'rs', name: 'Research sandbox', short: 'RS' }];
    const ws = wsList.find(w => w.id === WS_ID) || wsList[0];
    // Research sandbox only has pages backed by its own isolated store
    const qp = new URLSearchParams(location.search);
    const blocked = WS_ID === 'rs' && !(['onboarding', 'library', 'runs'].includes(cur) || (cur === 'workbench' && (qp.get('new') === '1' || skills.some(k => k.id === qp.get('skill')))));
    const navHtml = pages.map(p => p.sep ? '<div class="nav-sep" role="separator"></div>' :
      `<a class="nav-item" href="${p.href}" ${p.id === cur ? 'aria-current="page"' : ''} title="${p.label}" data-od-id="nav-${p.id}">${icon(p.ic)}<span>${p.label}</span>${p.count ? `<em class="count">${p.count}</em>` : ''}</a>`).join('');
    app.insertAdjacentHTML('afterbegin', `
      <div class="band" role="presentation" title="Sample data mode"></div>
      <header class="topbar" data-od-id="topbar">
        <a class="brand" href="index.html" aria-label="Savant home"><img class="logo-light" src="assets/savant-mark-light.svg" alt="" width="24" height="24"><img class="logo-dark" src="assets/savant-mark-dark.svg" alt="" width="24" height="24">Savant</a>
        <button class="ws-switch" id="ws-btn" aria-haspopup="menu" data-od-id="workspace-switcher"><span class="ws-dot">${ws.short}</span><span class="ws-name">${ws.name}</span>${icon('chevd')}</button>
        <button class="top-search" id="search-btn" data-od-id="global-search" aria-label="Search">${icon('search')}<span>Search skills, runs, evaluations</span><kbd class="kbd">Ctrl K</kbd></button>
        <div class="top-right">
          ${WS_ID === 'wh' ? `          <nav class="prio" aria-label="Open alerts by priority" data-od-id="priority-counts">
            <a class="p1" href="overview.html#attention" aria-label="2 priority 1 alerts"><i class="mk p1"></i>P1 2</a>
            <a class="p2" href="overview.html#attention" aria-label="3 priority 2 alerts"><i class="mk p2"></i>P2 3</a>
          </nav>` : ''}
          <span class="mode-pill" title="Prototype mode. Every figure on screen is illustrative sample data." data-od-id="mode-pill"><i class="mk sim"></i>Sample data<span class="lbl-long">&nbsp;· prototype</span></span>
          ${WS_ID === 'wh' ? `<button class="icon-btn notif-btn" id="notif-btn" aria-haspopup="dialog" aria-expanded="false" data-od-id="notifications-btn">${icon('bell')}<span class="notif-n" id="notif-n" hidden></span></button>` : ''}
          <button class="icon-btn" id="theme-btn" aria-label="Toggle colour theme"></button>
          <span class="avatar" title="Priya Aronson · Platform admin">PA</span>
        </div>
      </header>
      <nav class="sidenav" aria-label="Primary" data-od-id="sidenav">${navHtml}
        <div class="nav-foot">
          <a class="nav-item" href="onboarding.html" ${cur === 'onboarding' ? 'aria-current="page"' : ''} ${WS_ID === 'wh' ? 'hidden' : ''} title="Setup guide">${icon('guide')}<span>Setup guide</span><em class="count">4/5</em></a>
          <button class="nav-item collapse" id="nav-btn" style="border:0;background:none;width:100%;cursor:pointer;font:inherit" aria-label="Collapse navigation">${icon('sidebar')}<span>Collapse</span></button>
        </div>
      </nav>`);
    setTheme(document.documentElement.dataset.theme || 'light');
    if (blocked) {
      const main = $('.main'); if (main) main.innerHTML = `<div class="page"><div class="empty" style="padding:80px 16px" data-od-id="workspace-empty"><h2>Research sandbox has no ${cur === 'workbench' ? 'skill to open' : 'data here yet'}</h2><p>This workspace only shows its own assets. Finish setup to index skills and run a first evaluation.</p><div class="row"><a class="btn primary" href="onboarding.html">Continue setup</a><a class="btn" href="library.html">Library</a></div></div></div>`;
      ev && ev.stopImmediatePropagation && ev.stopImmediatePropagation();
    }
    $('#notif-btn') && ($('#notif-btn').onclick = e => { e.stopPropagation(); notifPanel ? closeNotif() : openNotif(); });
    notifCount();
    $('#theme-btn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    $('#nav-btn').onclick = toggleNav;
    $('#search-btn').onclick = openPalette;
    $('#ws-btn').onclick = (e) => menu(e.currentTarget, [
      { hd: 'Workspaces' },
      ...wsList.map(w => ({ label: w.name.replace('&amp;', '&'), sub: w.id === ws.id ? 'Current' : w.id === 'rs' ? 'Setup 0/5' : '', icon: w.id === ws.id ? 'check' : null, act: () => { if (w.id === ws.id) return; store.set('ws', w.id); location.href = w.id === 'rs' ? 'onboarding.html' : 'overview.html'; } })),
      { sep: true },
      { label: 'Create workspace', icon: 'plus', act: () => toast('Workspace creation opens the setup guide', 'Open', () => location.href = 'onboarding.html') }
    ]);
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
      if (e.key === 'Escape') { if (notifPanel) { closeNotif(); $('#notif-btn').focus(); } closeMenu(); closePalette(); $$('.drawer.open').forEach(d => closeDrawer(d)); }
    });
    if (!$('.toasts')) document.body.insertAdjacentHTML('beforeend', '<div class="toasts" aria-live="polite"></div><div class="scrim" id="scrim"></div>');
    $('#scrim').onclick = () => $$('.drawer.open').forEach(d => closeDrawer(d));
    $$('[data-ic]').forEach(el => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.ic)); });
    // connectivity: real offline/online events, or ?state=offline / ?state=stale to review the states
    const q = new URLSearchParams(location.search).get('state');
    const conn = (kind) => {
      $('#conn-banner')?.remove(); if (!kind) return;
      const main = $('.main'); if (!main) return;
      const msg = kind === 'offline' ? '<i class="mk p2"></i><span><strong>Connection lost.</strong> Showing data from 09:44. Actions are paused until Savant reconnects.</span><span class="acts"><button class="btn sm" id="conn-retry">Retry now</button></span>'
        : '<i class="mk p3"></i><span><strong>Data may be out of date.</strong> Last refreshed 18 minutes ago because the sync worker is behind.</span><span class="acts"><button class="btn sm" id="conn-retry">Refresh</button></span>';
      main.insertAdjacentHTML('afterbegin', `<div id="conn-banner" class="banner ${kind === 'offline' ? 'p2' : ''}" role="status" style="margin:12px 24px 0;border-radius:var(--r-ctl)">${msg}</div>`);
      document.documentElement.toggleAttribute('data-offline', kind === 'offline');
      $('#conn-retry').onclick = () => { const b = $('#conn-retry'); b.disabled = true; b.textContent = 'Checking…'; setTimeout(() => { if (navigator.onLine === false) { b.disabled = false; b.textContent = 'Retry now'; toast('Still offline'); } else { conn(null); toast('Reconnected · data refreshed'); } }, 1100); };
    };
    addEventListener('offline', () => conn('offline')); addEventListener('online', () => { conn(null); toast('Reconnected · data refreshed'); });
    if (q === 'offline' || q === 'stale') conn(q);
  }

  /* loading skeleton: replaces a tbody with placeholder rows, then runs fn */
  function loading(tbody, cols, rows, fn, ms = 380) {
    if (!tbody) return fn();
    tbody.innerHTML = Array.from({ length: rows }, () => `<tr aria-hidden="true">${Array.from({ length: cols }, (_, i) => `<td><div class="sk" style="width:${i === 0 ? 70 : 30 + (i * 17) % 40}%"></div></td>`).join('')}</tr>`).join('');
    tbody.closest('table')?.setAttribute('aria-busy', 'true');
    setTimeout(() => { tbody.closest('table')?.removeAttribute('aria-busy'); fn(); }, new URLSearchParams(location.search).get('state') === 'loading' ? 4000 : ms);
  }

  /* ─── notifications: policy decisions and gate failures ─── */
  const notifs = [
    { id: 'n1', k: 'gate', p: 'p1', t: 'Gate failed · Incident triage v3.1', d: 'EV-2418 · quality 82.4 below 85 · promotion blocked', when: '09:42', href: 'runs.html' },
    { id: 'n2', k: 'policy', p: 'p1', t: 'Auto-pin on regression blocked a release', d: 'Incident triage v3.1 · −6.9% vs v3.0', when: '09:42', href: 'insights.html#releases' },
    { id: 'n3', k: 'policy', p: 'p1', t: 'Tier 1 read access denied', d: 'contractor-07 tried to load Contract clause reviewer', when: '08:40', href: 'settings.html#audit' },
    { id: 'n4', k: 'gate', p: 'p2', t: 'Gate warning · Incident triage v3.1', d: 'Latency P95 6.4s above 6.0s', when: '09:42', href: 'runs.html' },
    { id: 'n5', k: 'policy', p: 'p2', t: 'Release held for second approver', d: 'RFP response drafter v1.4 · 1 of 2 approvals', when: 'Yest.', href: 'insights.html#releases' },
    { id: 'n6', k: 'policy', p: 'sim', t: 'Shadow policy would deny distribution', d: 'Tier 1 cannot distribute to local agents · VS Code sync agent', when: '10:02', href: 'settings.html#policies' },
    { id: 'n7', k: 'gate', p: 'ok', t: 'Gate passed · Contract clause reviewer v4.2', d: 'EV-2417 · 180 of 180 cases · quality 92.6', when: '07:58', href: 'runs.html#EV-2417' },
    { id: 'n10', k: 'report', p: 'ok', t: 'Your report FR-310 became an evaluation case', d: 'Engineering RFC reviewer · rfc-corpus-v4', when: '09:30', href: 'reports.html#mine' },
    { id: 'n11', k: 'report', p: 'ok', t: 'A fix for your report FR-299 shipped', d: 'PR summarizer v2.3 · your case passes', when: '08:55', href: 'reports.html#mine' },
    { id: 'n9', k: 'report', p: 'p2', t: '3 new field reports on Incident triage', d: 'Severity rated too low on partial-region outages', when: '10:14', href: 'reports.html' },
    { id: 'n8', k: 'gate', p: 'p1', t: 'Run failed · Quarterly earnings summary v0.9', d: 'EV-2414 · model connection revoked during run', when: '6 Oct', href: 'runs.html#EV-2414' }
  ];
  const DEFAULT_READ = ['n7', 'n8', 'n5'];
  const readSet = () => new Set(store.get('notif-read', DEFAULT_READ));
  let notifPanel = null, notifFilter = 'all';
  /* ─── Auto-Improve: shared policy, proposals and decisions (sample data) ─── */
  const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const POLICY0 = {
    T1: { skills: { on: false, minDelta: 1.5, maxNewFail: 0, minRuns: 500, maxSuccessDrop: 0.5, maxEditRise: 1, maxDepth: 2, minReports: 3 }, evals: { on: false, maxDrift: 1.0, minReports: 5, stableRanking: true } },
    T2: { skills: { on: true, minDelta: 1.0, maxNewFail: 0, minRuns: 200, maxSuccessDrop: 1.0, maxEditRise: 2, maxDepth: 3, minReports: 2 }, evals: { on: false, maxDrift: 1.5, minReports: 3, stableRanking: true } },
    T3: { skills: { on: true, minDelta: 0.5, maxNewFail: 1, minRuns: 50, maxSuccessDrop: 2.0, maxEditRise: 3, maxDepth: 3, minReports: 1 }, evals: { on: false, maxDrift: 2.0, minReports: 2, stableRanking: false } }
  };
  const SKILL_P = {
    R1: { t: 'Restore query_pagerduty timeout to 10s', skill: 'incident-triage', tier: 'T1', dq: 4.2, newFail: 0, run: 'EV-2424', status0: 'ready-for-review', ev0: true },
    R2: { t: 'Add partial-region examples to the severity matrix', skill: 'incident-triage', tier: 'T1', dq: 1.6, newFail: 2, run: 'EV-2426', status0: 'generated', ev0: false },
    R3: { t: 'Retry query_pagerduty once with 2s backoff', skill: 'incident-triage', tier: 'T1', dq: 1.3, newFail: 0, run: 'EV-2427', status0: 'generated', ev0: false, parent: 'R1' }
  };
  const EVAL_P = {
    E1: { t: 'Add 9 partial-region cases to sev-2-corpus-v3', suite: 'Incident triage', skill: 'incident-triage', tier: 'T1', kind: 'Add cases', reports: 7,
      why: '7 field reports and 2 production failures describe partial-region outages the dataset does not cover.', drift: -1.4, ranking: true, status0: 'ready-for-review', ev0: true,
      diff: ['  sev-2-corpus-v3: 180 cases', '+ case 181–189: partial-region degradation (from field reports FR-311, FR-318, FR-322 …)'] },
    E2: { t: 'Retire 14 saturated cases from pr-corpus-v6', suite: 'PR summarizer', skill: 'pr-summarizer', tier: 'T2', kind: 'Retire cases', reports: 0,
      why: 'Every version since v2.0 passes these 14 cases. They no longer separate good versions from bad ones.', drift: 0.9, ranking: true, status0: 'ready-for-review', ev0: true,
      diff: ['  pr-corpus-v6: 240 cases', '- 14 cases passed by all versions for 90 days (moved to archive)'] },
    E3: { t: 'Raise the quality gate for Customer email tone pass from 90 to 92', suite: 'Customer email tone pass', skill: 'customer-email-tone-pass', tier: 'T3', kind: 'Recalibrate gate', reports: 3,
      why: '3 field reports flagged tone issues on versions that scored 90–91. The 30-day score distribution sits at 92–94.', drift: 0, ranking: true, status0: 'generated', ev0: false,
      diff: ['  acceptance:', '-   quality_score >= 90', '+   quality_score >= 92'], backtest: 'Would have blocked v3.0, which was rolled back after 2 days. No other release affected.' }
  };
  const initProps = (P, saved) => { const st = saved || { props: {}, log: [] }; st.props = st.props || {}; st.log = st.log || []; Object.keys(P).forEach(id => { if (!st.props[id]) st.props[id] = { status: P[id].status0, evaluated: P[id].ev0, decidedBy: null, at: null }; }); return st; };
  const ai = {
    POLICY0, SKILL_P, EVAL_P,
    policy() { const p = store.get('aip', null) || {}; const out = JSON.parse(JSON.stringify(POLICY0)); Object.keys(p).forEach(t => { Object.assign(out[t].skills, p[t]?.skills || {}); Object.assign(out[t].evals, p[t]?.evals || {}); }); return out; },
    setPolicy(p) { store.set('aip', p); },
    skillState() { const s = initProps(SKILL_P, store.get('wbi', null)); if (!s.layer) s.layer = 'structure'; return s; },
    saveSkill(s) { store.set('wbi', s); },
    evalState() { return initProps(EVAL_P, store.get('aie', null)); },
    saveEval(s) { store.set('aie', s); },
    pending() {
      const ss = ai.skillState(), es = ai.evalState(), out = [];
      Object.keys(SKILL_P).forEach(id => { const st = ss.props[id].status; if (SKILL_P[id].parent && ss.props[SKILL_P[id].parent].status !== 'approved') return; if (['ready-for-review', 'generated', 'testing'].includes(st)) out.push({ kind: 'skill', id, p: SKILL_P[id], st: ss.props[id] }); });
      Object.keys(EVAL_P).forEach(id => { const st = es.props[id].status; if (['ready-for-review', 'generated'].includes(st)) out.push({ kind: 'eval', id, p: EVAL_P[id], st: es.props[id] }); });
      return out;
    },
    async decide(kind, id, decision, opts = {}) {
      const isSkill = kind === 'skill', S0 = isSkill ? ai.skillState() : ai.evalState(), P0 = isSkill ? SKILL_P : EVAL_P, p = P0[id], st = S0.props[id];
      if (!opts.auto) {
        const ok = await confirmDlg(decision === 'approve'
          ? { title: `Approve ${id}?`, body: isSkill ? `Commits “${p.t}” to the candidate branch of ${skills.find(k => k.id === p.skill).name} and queues a full re-evaluation. Production is unchanged until the release is approved.` : `Applies “${p.t}” to the ${p.suite} suite as a new dataset version. Past results stay attached to the previous version, so scores before and after are not directly comparable.`, confirm: 'Approve' }
          : { title: `Reject ${id}?`, body: `“${p.t}” is marked rejected and kept in the audit log. Auto-Improve will not propose it again for the same evidence.`, confirm: 'Reject proposal', danger: true });
        if (!ok) return false;
      }
      st.status = decision === 'approve' ? 'approved' : 'rejected'; st.decidedBy = opts.auto ? 'auto' : 'user'; st.at = nowHM();
      if (isSkill && decision === 'reject') Object.keys(SKILL_P).forEach(k => { if (SKILL_P[k].parent === id && S0.props[k].status !== 'approved') S0.props[k].status = 'superseded'; });
      S0.log.unshift([nowHM(), decision === 'approve' ? 'ok' : 'idle', `${opts.auto ? 'Auto-Improve' : 'priya.a'} ${decision === 'approve' ? 'approved' : 'rejected'} ${id}${opts.from ? ' from ' + opts.from : ''}`]); S0.log = S0.log.slice(0, 12);
      isSkill ? ai.saveSkill(S0) : ai.saveEval(S0);
      if (!opts.auto) toast(`${id} ${decision === 'approve' ? 'approved' : 'rejected'}`);
      document.dispatchEvent(new CustomEvent('ai-change', { detail: { kind, id } }));
      notifCount();
      return true;
    },
    evalsWarning(scope) {
      return new Promise(res => {
        const d = document.createElement('dialog'); d.className = 'dialog'; d.setAttribute('aria-labelledby', 'aiw-t');
        d.innerHTML = `<div class="dh"><div class="row"><h2 id="aiw-t">Auto-Improve for evaluations is in alpha</h2><span class="tag sim" style="margin-left:auto">Alpha</span></div></div>
          <div class="db stack"><div class="banner p2"><i class="mk p2"></i><span>This can make results less trustworthy.</span></div>
          <p class="fg2">Turning this on for <strong>${scope}</strong> lets Auto-Improve change datasets, rubrics and gates on its own. That can:</p>
          <ul class="fg2" style="margin:0;padding-left:18px;display:grid;gap:4px"><li>cause eval drift, so scores stop being comparable across versions</li><li>hide regressions by retiring or softening the cases that would catch them</li><li>let a gate pass a change that would have failed before</li></ul>
          <p class="small muted">Every change creates a new dataset or rubric version and can be reverted. Start with lower tiers.</p>
          <label class="row small"><input type="checkbox" class="chk" id="aiw-ack">I understand this may hide regressions and cause eval drift</label></div>
          <div class="df"><button class="btn" value="no">Keep off</button><button class="btn primary" value="yes" disabled id="aiw-go">Turn on</button></div>`;
        document.body.appendChild(d); d.showModal();
        d.querySelector('#aiw-ack').onchange = e => d.querySelector('#aiw-go').disabled = !e.target.checked;
        d.querySelectorAll('.df button').forEach(b => b.onclick = () => { d.close(); d.remove(); res(b.value === 'yes'); });
        d.addEventListener('cancel', () => { d.remove(); res(false); });
      });
    }
  };

  function notifCount() {
    const r = readSet(), n = notifs.filter(x => !r.has(x.id)).length + ai.pending().filter(x => x.st.status !== 'generated').length, el = $('#notif-n'), b = $('#notif-btn'); if (!el) return;
    el.hidden = !n; el.textContent = n; b.setAttribute('aria-label', `Notifications, ${n} unread or awaiting a decision`);
  }
  function aiItem(x) {
    const ready = x.st.status === 'ready-for-review' && x.st.evaluated, sk = skills.find(k => k.id === x.p.skill);
    const href = x.kind === 'skill' ? 'workbench.html?layer=improve' : 'evaluations.html#auto-improve';
    const meta = x.kind === 'skill' ? (x.st.evaluated ? `Shadow ${x.p.run} · +${x.p.dq.toFixed(1)} quality · ${x.p.newFail} newly failing` : 'Not evaluated yet') : (x.st.evaluated ? `Backtested · score drift ${x.p.drift > 0 ? '+' : ''}${x.p.drift} · ranking ${x.p.ranking ? 'stable' : 'changed'}` : 'Not backtested yet');
    return `<li class="unread np-ai"><a href="${href}"><i class="mk sim"></i><span class="np-b"><span class="np-t">${x.p.t}</span><span class="np-d">${x.kind === 'skill' ? sk.name : x.p.suite + ' suite'} · ${meta}</span><span class="np-m">Auto-Improve · ${x.kind === 'skill' ? 'skill' : 'evaluation'} proposal ${x.id} · ${sk.tier}</span></span><span></span></a>
      <div class="np-acts">${ready ? `<button class="btn sm" data-ai="approve" data-k="${x.kind}" data-id="${x.id}">Approve</button><button class="btn sm tertiary" data-ai="reject" data-k="${x.kind}" data-id="${x.id}">Reject</button>` : `<a class="btn sm" href="${href}">${x.kind === 'skill' ? 'Evaluate in Workbench' : 'Backtest in Evaluations'}</a>`}</div></li>`;
  }
  function drawNotif() {
    const r = readSet(), pend = ai.pending();
    const list = notifs.filter(x => notifFilter === 'all' || x.k === notifFilter || (notifFilter === 'unread' && !r.has(x.id)));
    const showAi = notifFilter === 'all' || notifFilter === 'improve' || notifFilter === 'unread';
    const unread = notifs.filter(x => !r.has(x.id)).length + pend.filter(x => x.st.status !== 'generated').length;
    notifPanel.innerHTML = `<div class="np-h"><h2>Notifications</h2><button class="btn sm tertiary" id="np-all" ${notifs.some(x => !r.has(x.id)) ? '' : 'disabled'}>Mark all read</button></div>
      <div class="seg np-f" role="group" aria-label="Filter notifications">${[['all', 'All'], ['unread', `Unread ${unread}`], ['improve', `Auto-Improve ${pend.length}`], ['gate', 'Gates'], ['policy', 'Policy']].map(([v, l]) => `<button aria-pressed="${notifFilter === v}" data-v="${v}">${l}</button>`).join('')}</div>
      <ul class="np-l" role="list">${showAi ? pend.map(aiItem).join('') : ''}${notifFilter === 'improve' ? '' : list.map(x => `<li class="${r.has(x.id) ? '' : 'unread'}"><a href="${x.href}" data-id="${x.id}"><i class="mk ${x.p}"></i><span class="np-b"><span class="np-t">${x.t}</span><span class="np-d">${x.d}</span><span class="np-m">${x.k === 'gate' ? 'Gate' : x.k === 'report' ? 'Field report' : 'Policy'} · ${x.when}</span></span>${r.has(x.id) ? '' : '<span class="np-dot" aria-label="Unread"></span>'}</a></li>`).join('')}${(showAi ? pend.length : 0) + (notifFilter === 'improve' ? 0 : list.length) ? '' : '<li class="np-e">Nothing here. Proposals, gate failures and policy decisions appear as they happen.</li>'}</ul>
      <div class="np-f2"><a href="settings.html#auto-improve">Auto-Improve policy</a><a href="settings.html#policies">Policies</a><a href="settings.html#audit">Audit log</a></div>`;
    $('#np-all', notifPanel).onclick = () => { store.set('notif-read', notifs.map(x => x.id)); notifCount(); drawNotif(); };
    $$('.np-f button', notifPanel).forEach(b => b.onclick = () => { notifFilter = b.dataset.v; drawNotif(); });
    $$('.np-l a[data-id]', notifPanel).forEach(a => a.onclick = () => { const s2 = readSet(); s2.add(a.dataset.id); store.set('notif-read', [...s2]); });
    $$('[data-ai]', notifPanel).forEach(b => b.onclick = async e => { e.preventDefault(); e.stopPropagation(); const done = await ai.decide(b.dataset.k, b.dataset.id, b.dataset.ai, { from: 'notifications' }); if (done && notifPanel) drawNotif(); });
  }
  function openNotif() {
    closeMenu(); notifPanel = document.createElement('div'); notifPanel.className = 'np'; notifPanel.setAttribute('role', 'dialog'); notifPanel.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(notifPanel); drawNotif();
    const r = $('#notif-btn').getBoundingClientRect(); notifPanel.style.top = (r.bottom + 6) + 'px'; notifPanel.style.right = Math.max(8, innerWidth - r.right - 8) + 'px';
    $('#notif-btn').setAttribute('aria-expanded', 'true'); notifPanel.querySelector('button, a')?.focus();
    setTimeout(() => document.addEventListener('mousedown', outsideNotif), 0);
  }
  function outsideNotif(e) { if (notifPanel && !notifPanel.contains(e.target) && !e.target.closest('#notif-btn') && !e.target.closest('dialog')) closeNotif(); }
  function closeNotif() { notifPanel?.remove(); notifPanel = null; $('#notif-btn')?.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outsideNotif); notifCount(); }

  /* ─── menu ─── */
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  function menu(anchor, items) {
    closeMenu();
    const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
    items.forEach(it => {
      if (it.sep) return m.insertAdjacentHTML('beforeend', '<div class="sep"></div>');
      if (it.hd) { const h = document.createElement('div'); h.className = 'hd'; h.textContent = it.hd; return m.appendChild(h); }
      const b = document.createElement('button'); b.setAttribute('role', 'menuitem');
      b.innerHTML = it.icon ? icon(it.icon) : '<span style="width:16px;flex:none"></span>';
      const lab = document.createElement('span'); lab.textContent = String(it.label).replace(/&amp;/g, '&'); b.appendChild(lab);
      if (it.sub) { const sub = document.createElement('span'); sub.className = 'muted small'; sub.style.marginLeft = 'auto'; sub.textContent = it.sub; b.appendChild(sub); }
      if (it.danger) b.style.color = 'var(--crit-fg)';
      b.onclick = () => { closeMenu(); it.act && it.act(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const left = Math.min(r.left, innerWidth - m.offsetWidth - 8);
    m.style.left = left + 'px'; m.style.top = (r.bottom + 4) + 'px';
    openMenu = m; m.querySelector('button')?.focus();
    setTimeout(() => document.addEventListener('click', function h(e) { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('click', h); } }), 0);
  }

  /* ─── command search ─── */
  let pal = null;
  function closePalette() { if (pal) { pal.remove(); pal = null; } }
  function openPalette() {
    closePalette();
    const entries = [
      ...pages.filter(p => !p.sep).map(p => ({ g: 'Go to', label: p.label, href: p.href, ic: p.ic })),
      ...skills.map(s => ({ g: 'Skills', label: s.name, href: 'library.html#' + s.id, ic: 'library', k: s.ver })),
      ...db.runs().slice(0, 8).map(r => ({ g: 'Runs', label: `${r.id} · ${skills.find(k => k.id === r.skill)?.name || r.skill} ${r.v}`, href: 'runs.html#' + r.id, ic: 'runs', k: r.st })),
      { g: 'Actions', label: 'New evaluation', href: 'evaluations.html#new', ic: 'plus' },
      { g: 'Actions', label: 'Compare versions', href: 'insights.html', ic: 'compare' },
      { g: 'Go to', label: 'Workflows', href: 'workflows.html', ic: 'workbench' },
      { g: 'Go to', label: 'Skill opportunities', href: 'discovery.html', ic: 'library' },
      { g: 'Actions', label: 'Connect repository', href: 'library.html#repositories', ic: 'git' }
    ];
    pal = document.createElement('div'); pal.className = 'palette'; pal.setAttribute('role', 'dialog'); pal.setAttribute('aria-label', 'Search');
    pal.innerHTML = '<input placeholder="Search skills, runs, evaluations, actions" aria-label="Search"><ul role="listbox"></ul>';
    document.body.appendChild(pal);
    const inp = pal.querySelector('input'), ul = pal.querySelector('ul'); let idx = 0, shown = [];
    const render = () => {
      const q = inp.value.trim().toLowerCase();
      shown = entries.filter(e => !q || e.label.toLowerCase().includes(q) || e.g.toLowerCase().includes(q)).slice(0, 14);
      idx = Math.min(idx, Math.max(0, shown.length - 1)); let last = '';
      ul.innerHTML = shown.length ? shown.map((e, i) => { const h = e.g !== last ? `<li class="grp">${e.g}</li>` : ''; last = e.g; return h + `<li role="option" data-i="${i}" aria-selected="${i === idx}">${icon(e.ic)}<span>${esc(e.label)}</span>${e.k ? `<span class="k mono">${esc(e.k)}</span>` : ''}</li>`; }).join('') : '<li class="grp">No matches. Try a skill name or a run ID such as EV-2418.</li>';
    };
    inp.oninput = () => { idx = 0; render(); };
    inp.onkeydown = e => {
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, shown.length - 1); render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); render(); e.preventDefault(); }
      if (e.key === 'Enter' && shown[idx]) location.href = shown[idx].href;
    };
    ul.onclick = e => { const li = e.target.closest('[data-i]'); if (li) location.href = shown[+li.dataset.i].href; };
    render(); inp.focus();
    setTimeout(() => document.addEventListener('mousedown', function h(e) { if (pal && !pal.contains(e.target)) { closePalette(); document.removeEventListener('mousedown', h); } }), 0);
  }

  /* ─── toast / confirm / drawer ─── */
  function toast(msg, actLabel, act, opts = {}) {
    const box = $('.toasts'); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
    if (opts.sim) { const tag = document.createElement('span'); tag.className = 'toast-sim'; tag.textContent = 'Simulated'; t.appendChild(tag); }
    const body = document.createElement('span'); body.textContent = msg; t.appendChild(body);
    if (actLabel) { const btn = document.createElement('button'); btn.textContent = actLabel; t.appendChild(btn); }
    if (actLabel) t.querySelector('button').onclick = () => { act && act(); t.remove(); };
    box.appendChild(t); setTimeout(() => t.remove(), 4800);
  }
  function confirmDlg({ title, body, confirm = 'Confirm', danger = false, cancel = 'Cancel' }) {
    return new Promise(res => {
      const d = document.createElement('dialog'); d.className = 'dialog';
      d.innerHTML = `<div class="dh"><h2>${title}</h2></div><div class="db fg2">${body}</div><div class="df"><button class="btn" value="no">${cancel}</button><button class="btn ${danger ? 'danger' : 'primary'}" value="yes">${confirm}</button></div>`;
      document.body.appendChild(d); d.showModal();
      d.querySelectorAll('button').forEach(b => b.onclick = () => { d.close(); d.remove(); res(b.value === 'yes'); });
      d.addEventListener('cancel', () => { d.remove(); res(false); });
    });
  }
  function openDrawer(d) { d.classList.add('open'); $('#scrim').classList.add('open'); d.setAttribute('aria-hidden', 'false'); setTimeout(() => d.querySelector('button, [tabindex], input')?.focus(), 50); }
  function closeDrawer(d) { if (d.dataset.guard && !window.confirm(d.dataset.guard)) return; d.classList.remove('open'); $('#scrim').classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }

  function tabs(root, onChange) {
    const btns = $$('[role="tab"]', root);
    btns.forEach(b => b.onclick = () => {
      btns.forEach(x => x.setAttribute('aria-selected', x === b));
      const target = b.getAttribute('aria-controls');
      btns.forEach(x => { const p = document.getElementById(x.getAttribute('aria-controls')); if (p) p.hidden = x !== b; });
      onChange && onChange(b.dataset.tab || target);
    });
  }

  /* ─── charts ─── */
  let tipEl = null;
  function tip(html, x, y) { if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); } if (!html) { tipEl.style.display = 'none'; return; } tipEl.innerHTML = html; tipEl.style.display = 'block'; const w = tipEl.offsetWidth; tipEl.style.left = Math.min(x + 12, innerWidth - w - 8) + 'px'; tipEl.style.top = (y + 12) + 'px'; }
  function spark(vals, w = 72, h = 22, stroke = 'var(--fg-2)') {
    if (!vals || !vals.length) return `<svg width="${w}" height="${h}" aria-hidden="true"></svg>`;
    const mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 2 - (v - mn) / r * (h - 4)).toFixed(1)}`).join(' ');
    const last = pts.split(' ').pop().split(',');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.25" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2" fill="${stroke}"/></svg>`;
  }
  function bars(vals, w = 72, h = 22, fill = 'var(--border-strong)') {
    const mx = Math.max(...vals) || 1, bw = w / vals.length;
    return `<svg width="${w}" height="${h}" aria-hidden="true">${vals.map((v, i) => `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - v / mx * h).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${(v / mx * h).toFixed(1)}" rx="1" fill="${fill}"/>`).join('')}</svg>`;
  }
  /* line chart: series [{name, values, kind:'fg'|'base'|'dash'|'accent'|'crit'}], labels[], opts {min,max,h,threshold,thresholdLabel,unit,area} */
  function line(el, series, labels, o = {}) {
    const W = el.clientWidth || 600, H = o.h || 200, pl = 34, pr = 12, pt = 10, pb = 22;
    const all = series.flatMap(s => s.values).filter(v => v != null);
    const mn = o.min ?? Math.floor(Math.min(...all) - 2), mx = o.max ?? Math.ceil(Math.max(...all) + 2);
    const n = labels.length, x = i => pl + i / (n - 1) * (W - pl - pr), y = v => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
    const col = { fg: 'var(--fg)', base: 'var(--border-strong)', dash: 'var(--border-strong)', accent: 'var(--accent)', crit: 'var(--crit)' };
    let g = '<g class="grid">';
    for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 3}" text-anchor="end">${(+v.toFixed(1))}${o.unit || ''}</text>`; }
    g += '</g>';
    const step = Math.ceil(n / 6);
    labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${l}</text>`; });
    if (o.threshold != null) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(o.threshold)}" y2="${y(o.threshold)}" stroke="var(--crit)" stroke-dasharray="3 3"/><text x="${W - pr}" y="${y(o.threshold) - 4}" text-anchor="end" style="fill:var(--crit-fg)">${o.thresholdLabel || ''}</text>`;
    series.forEach(s => {
      const pts = s.values.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');
      if (o.area && s.kind === 'fg') g += `<polygon points="${x(0)},${H - pb} ${pts} ${x(s.values.length - 1)},${H - pb}" fill="color-mix(in oklch, var(--fg) 7%, transparent)"/>`;
      g += `<polyline points="${pts}" fill="none" stroke="${col[s.kind || 'fg']}" stroke-width="${s.kind === 'fg' || s.kind === 'accent' ? 1.75 : 1.25}" ${s.kind === 'dash' ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round"/>`;
      (s.marks || []).forEach(m => g += `<path d="M${x(m.i)} ${y(s.values[m.i]) - 6} l5 8 h-10z" fill="var(--crit)"><title>${m.t}</title></path>`);
    });
    g += `<line class="xh" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--border-strong)" visibility="hidden"/>`;
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${o.label || 'Line chart'}">${g}<rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent" class="hit"/></svg>`;
    const svg = el.querySelector('svg'), xh = svg.querySelector('.xh');
    svg.querySelector('.hit').addEventListener('mousemove', e => {
      const b = svg.getBoundingClientRect(); const px = (e.clientX - b.left) * (W / b.width);
      const i = Math.max(0, Math.min(n - 1, Math.round((px - pl) / (W - pl - pr) * (n - 1))));
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
      tip(`${labels[i]}<br>` + series.map(s => `${s.name}: ${s.values[i] ?? '—'}${o.unit || ''}`).join('<br>'), e.clientX, e.clientY);
    });
    svg.querySelector('.hit').addEventListener('mouseleave', () => { tip(null); xh.setAttribute('visibility', 'hidden'); });
  }
  const days = (n, end = new Date(2026, 9, 12)) => Array.from({ length: n }, (_, i) => { const d = new Date(end); d.setDate(d.getDate() - (n - 1 - i)); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); });

  /* status helpers */
  const ST = {
    ok: ['ok', 'Healthy'], p1: ['p1', 'Regressed'], p2: ['p2', 'Near threshold'], p3: ['p3', 'Stale'], unk: ['unk', 'No data'], sim: ['sim', 'Proposal'], run: ['idle', 'Running']
  };
  const status = (k, text) => { const [c, t] = ST[k] || ST.unk; return `<span class="st ${c === 'p3' ? '' : c === 'idle' ? '' : c}"><i class="mk ${c}"></i>${text || t}</span>`; };
  const score = (v, d) => v == null ? '<span class="st unk"><i class="mk unk"></i>Not evaluated</span>' : `<span class="score"><span class="num">${v.toFixed(1)}</span><span class="bar ${d < -2 ? 'p1' : ''}"><i style="width:${v}%"></i></span><span class="delta ${d < -2 ? 'bad' : ''}">${d > 0 ? '+' : ''}${d.toFixed(1)}</span></span>`;

  const simToast = (msg, actLabel, act) => toast(msg, actLabel, act, { sim: true });
  window.Savant = { db, esc, simToast, ai, $, $$, store, loading, icon, rng, walk, skills, pages, mount, menu, closeMenu, toast, confirm: confirmDlg, openDrawer, closeDrawer, tabs, spark, bars, line, tip, days, status, score };
  document.addEventListener('DOMContentLoaded', mount);
})();
