/* UX-03 acceptance tests for the prototype's state and evaluation integrity.
   Run: node tests/acceptance.js
   Each "page load" runs assets/savant.js in a fresh VM context that shares one storage map,
   so a second load is equivalent to a browser reload. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'assets/savant.js'), 'utf8');
const Engine = require(path.join(ROOT, 'assets/workflow-engine.js'));

function browser() {
  const mem = {};
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: i => Object.keys(mem)[i], get length() { return Object.keys(mem).length; } };
  return {
    mem,
    setWorkspace(ws) { localStorage.setItem('sv-ws', JSON.stringify(ws)); },
    load() {
      const doc = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} }, body: { dataset: {} } };
      const ctx = { localStorage, document: doc, location: { search: '', hash: '', pathname: '/x.html' }, navigator: {}, addEventListener() {}, setTimeout, clearTimeout, setInterval() {}, console, Date, Math, JSON };
      ctx.window = ctx; vm.createContext(ctx); vm.runInContext(SHELL, ctx);
      return ctx.Savant;
    }
  };
}

const results = [];
function test(group, name, fn) { try { fn(); results.push([group, name, true]); } catch (e) { results.push([group, name, false, e.message]); } }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'expected'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }

/* 1 · Workbench persistence */
test('Workbench', 'saved skill source survives reload', () => {
  const b = browser(); let S = b.load();
  S.db.saveSource('pr-summarizer', '---\nname: pr-summarizer\n---\n# PR summarizer\nedited');
  S = b.load();
  eq(S.db.source('pr-summarizer').src.endsWith('edited'), true, 'saved text');
  eq(S.db.source('pr-summarizer').rev, 1, 'revision');
});
test('Workbench', 'unsaved draft does not replace the saved version', () => {
  const b = browser(); let S = b.load();
  S.db.saveSource('pr-summarizer', 'saved'); S.store.set('wb-draft-pr-summarizer', 'draft only');
  S = b.load();
  eq(S.db.source('pr-summarizer').src, 'saved');
  S.store.del('wb-draft-pr-summarizer'); S = b.load();
  eq(S.store.get('wb-draft-pr-summarizer', null), null, 'draft cleared');
  eq(S.db.source('pr-summarizer').src, 'saved', 'saved kept');
});
test('Workbench', '?new=1 save creates a real skill record that survives reload', () => {
  const b = browser(); let S = b.load();
  ok(S.db.addSkill({ id: 'contract-intake', name: 'Contract intake', repo: 'wh/skills' }), 'created');
  S.db.saveSource('contract-intake', '---\nname: contract-intake\n---');
  S = b.load();
  ok(S.skills.some(k => k.id === 'contract-intake'), 'skill listed after reload');
  ok(S.db.source('contract-intake'), 'source listed after reload');
  eq(S.db.addSkill({ id: 'contract-intake', name: 'dup' }), null, 'duplicate rejected');
});

/* 2 · Repository indexing */
test('Indexing', 'indexing the same repository twice creates no duplicates', () => {
  const b = browser(); let S = b.load();
  S.db.addRepo({ n: 'acme/finance-skills', pv: 'GitHub' });
  const first = S.db.indexRepo('acme/finance-skills'), second = S.db.indexRepo('acme/finance-skills');
  eq(first.added.length, 3, 'first index adds 3');
  eq(second.added.length, 0, 'second index adds none');
  eq(second.updated.length, 3, 'second index reconciles 3');
  eq(S.skills.filter(k => k.repo === 'acme/finance-skills').length, 3, 'inventory count');
  eq(S.db.repos().find(r => r.n === 'acme/finance-skills').skills, 3, 'repository count');
});
test('Indexing', 'indexing after reload is still idempotent', () => {
  const b = browser(); let S = b.load();
  S.db.addRepo({ n: 'acme/ops', pv: 'GitLab' }); S.db.indexRepo('acme/ops');
  S = b.load(); S.db.indexRepo('acme/ops'); S = b.load();
  eq(S.skills.filter(k => k.repo === 'acme/ops').length, 3);
  eq(S.db.repos().filter(r => r.n === 'acme/ops').length, 1, 'repository not duplicated');
});
test('Indexing', 'connecting an existing repository does not duplicate it', () => {
  const b = browser(); const S = b.load();
  S.db.addRepo({ n: 'acme/x', pv: 'GitHub' }); S.db.addRepo({ n: 'acme/x', pv: 'GitHub' });
  eq(S.db.repos().filter(r => r.n === 'acme/x').length, 1);
});

/* 3 · Evaluation gates */
const T0 = Date.now() - 10 * 60 * 1000;
test('Gates', 'quality 82.4 against a required 85.0 fails the quality gate', () => {
  const b = browser(); const S = b.load();
  const id = S.db.addRun({ skill: 'pr-summarizer', v: 'v2.3', b: '—', n: 30, t0: T0, result: { q: 82.4, dq: 0, fail: 5 } });
  const r = S.db.run(id), q = r.gateResults.find(g => g.kind === 'quality');
  eq(q.pass, false, 'quality gate'); eq(q.t, 85, 'threshold');
  ok(r.st !== 'passed' && r.st !== 'baseline', `status must not pass, got ${r.st}`);
  eq(r.st, 'gate-failed');
});
test('Gates', 'each gate is computed independently from the metrics', () => {
  const b = browser(); const S = b.load();
  const id = S.db.addRun({ skill: 'incident-triage', v: 'v3.1', b: 'v3.0', n: 30, t0: T0, result: { q: 86.0, dq: -2.5, fail: 4, p95: 7000 } });
  const g = Object.fromEntries(S.db.run(id).gateResults.map(x => [x.kind, x]));
  eq(g.quality.pass, true, 'quality 86 ≥ 85'); eq(g.drop.pass, false, 'drop 2.5 ≤ 2.0'); eq(g.p95.pass, false, 'p95 7000 ≤ 6000');
  eq(g.p95.block, false, 'latency is warn only'); eq(S.db.run(id).st, 'regressed');
});
test('Gates', 'a run passes only when every blocking gate passes', () => {
  const b = browser(); const S = b.load();
  const id = S.db.addRun({ skill: 'incident-triage', v: 'v3.1', b: 'v3.0', n: 30, t0: T0, result: { q: 88.0, dq: 0.4, fail: 2, p95: 7000 } });
  eq(S.db.run(id).st, 'passed', 'warn-only latency does not block');
});
test('Gates', 'builder criteria become the run gates', () => {
  const b = browser(); const S = b.load();
  const id = S.db.addRun({ skill: 'pr-summarizer', v: 'v2.3', b: '—', n: 30, t0: T0, criteria: [['Quality score', '≥', '80', 'Blocks promotion']], result: { q: 82.4, dq: 0, fail: 5 } });
  eq(S.db.run(id).st, 'baseline', 'passes an 80 threshold');
  const id2 = S.db.addRun({ skill: 'pr-summarizer', v: 'v2.3', b: '—', n: 30, t0: T0, criteria: [['Quality score', '≥', '90', 'Warns']], result: { q: 82.4, dq: 0, fail: 5 } });
  eq(S.db.run(id2).st, 'baseline', 'warn-only criterion does not block');
  eq(S.db.run(id2).gateResults[0].pass, false, 'but the gate itself fails');
});
test('Gates', 'sample runs report status consistent with their gates', () => {
  const b = browser(); const S = b.load();
  S.db.runs().filter(r => r.st !== 'running' && !r.err).forEach(r => {
    const blockingFail = r.gateResults.some(g => g.block && !g.pass);
    ok(!(blockingFail && (r.st === 'passed' || r.st === 'baseline')), `${r.id} is ${r.st} with a failed blocking gate`);
    ok(!(!blockingFail && (r.st === 'regressed' || r.st === 'gate-failed')), `${r.id} is ${r.st} with all gates passing`);
  });
  eq(S.db.run('EV-2418').st, 'regressed', 'EV-2418');
});

/* 4 · Workflows */
const V2 = () => ({ steps: [
  { id: 't', type: 'trigger', t: 'PagerDuty alert' }, { id: 's1', type: 'skill', skill: 'incident-triage' },
  { id: 'b1', type: 'branch', cond: ['severity', '≥', 'SEV-2'] }, { id: 'a1', type: 'approval', t: 'IC confirms' },
  { id: 'f1', type: 'parallel', t: 'In parallel' }, { id: 's2', type: 'skill', skill: 'customer-email-tone-pass' },
  { id: 's3', type: 'skill', skill: 'pr-summarizer' }, { id: 'j1', type: 'join', t: 'Wait' }, { id: 'out', type: 'output', t: 'Brief' }],
  edges: [['t', 's1'], ['s1', 'b1'], ['b1', 'f1', 'yes'], ['b1', 'a1', 'no'], ['a1', 'f1'], ['f1', 's2'], ['f1', 's3'], ['s2', 'j1'], ['s3', 'j1'], ['j1', 'out']] });
test('Workflows', 'the sample graph validates cleanly', () => eq(Engine.validate(V2()), []));
test('Workflows', 'any graph edit changes the version hash, so stored evaluations go stale', () => {
  const g = V2(), h = Engine.hash(g);
  g.steps.find(s => s.id === 'b1').cond[2] = 'SEV-3'; ok(Engine.hash(g) !== h, 'condition edit');
  const g2 = V2(); g2.steps.find(s => s.id === 's3').onfail = 'retry'; ok(Engine.hash(g2) !== h, 'failure policy edit');
  eq(Engine.hash(V2()), h, 'same graph, same hash');
});
const codes = g => Engine.validate(g).map(i => i.code);
test('Workflows', 'detects cycles', () => { const g = V2(); g.edges.push(['j1', 's1']); ok(codes(g).includes('cycle')); });
test('Workflows', 'detects disconnected steps', () => { const g = V2(); g.steps.push({ id: 'x', type: 'skill', skill: 'pr-summarizer' }); ok(codes(g).includes('unreachable')); });
test('Workflows', 'detects invalid edges', () => { const g = V2(); g.edges.push(['s1', 'ghost']); g.edges.push(['out', 's1']); const c = codes(g); ok(c.includes('edge')); });
test('Workflows', 'detects incomplete branches', () => { const g = V2(); g.edges = g.edges.filter(e => !(e[0] === 'b1' && e[2] === 'no')); ok(codes(g).includes('branch')); });
test('Workflows', 'detects unsatisfiable joins', () => { const g = V2(); g.edges = g.edges.filter(e => e[0] !== 's3'); ok(codes(g).includes('join')); });
test('Workflows', 'configured branch condition decides the path', () => {
  eq(Engine.run(V2(), 'sev2').state.a1, 'skipped', 'SEV-2 skips approval');
  eq(Engine.run(V2(), 'sev1').waitingAt, 'a1', 'SEV-1 waits for approval');
  const g = V2(); g.steps.find(s => s.id === 'b1').cond = ['severity', '≥', 'SEV-3'];
  eq(Engine.run(g, 'sev2').waitingAt, 'a1', 'edited threshold now routes SEV-2 to approval');
});
test('Workflows', 'approval decisions continue or stop the run', () => {
  eq(Engine.run(V2(), 'sev1', { a1: true }).state.out, 'done');
  const r = Engine.run(V2(), 'sev1', { a1: false }); eq(r.failed, true); eq(r.state.out, 'skipped');
});
test('Workflows', 'failure policy is applied: stop, continue, retry', () => {
  eq(Engine.run(V2(), 'flaky').failed, true, 'stop');
  const c = V2(); c.steps.find(s => s.id === 's3').onfail = 'continue'; const rc = Engine.run(c, 'flaky'); eq(rc.failed, false, 'continue'); eq(rc.state.s3, 'failed-continued'); eq(rc.state.out, 'done');
  const r = V2(); r.steps.find(s => s.id === 's3').onfail = 'retry'; const rr = Engine.run(r, 'flaky'); eq(rr.failed, false, 'retry recovers'); eq(rr.state.s3, 'done');
  const bad = V2(); bad.steps.find(s => s.id === 's1').onfail = 'retry'; eq(Engine.run(bad, 'bad').failed, true, 'retry cannot fix a persistent failure');
});

/* 5 · Workspace isolation */
test('Workspaces', 'Research sandbox never sees Wexler & Hahn assets', () => {
  const b = browser(); let S = b.load();
  S.db.addSkill({ id: 'wh-private', name: 'WH private skill' }); S.db.addRun({ skill: 'pr-summarizer', n: 10 });
  b.setWorkspace('rs'); S = b.load();
  eq(S.skills.length, 0, 'no skills'); eq(S.db.repos().length, 0, 'no repositories'); eq(S.db.runs().length, 0, 'no runs');
  S.db.addRepo({ n: 'research/eval-skills', pv: 'GitHub' }); S.db.indexRepo('research/eval-skills', ['Literature summarizer']);
  b.setWorkspace('wh'); S = b.load();
  ok(!S.skills.some(k => k.repo === 'research/eval-skills'), 'sandbox skill hidden from WH');
  ok(S.skills.some(k => k.id === 'wh-private'), 'WH skill still there');
  b.setWorkspace('rs'); S = b.load();
  eq(S.skills.map(k => k.name), ['Literature summarizer'], 'sandbox keeps only its own');
});
test('Workspaces', 'stored keys are namespaced per workspace', () => {
  const b = browser(); b.load(); b.setWorkspace('rs'); b.load();
  ok(Object.keys(b.mem).includes('sv-wh:db') && Object.keys(b.mem).includes('sv-rs:db'), Object.keys(b.mem).join(','));
});

/* 6 · Rendering safety */
test('Rendering', 'escape helper neutralises markup', () => { const S = browser().load(); eq(S.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;'); });
test('Rendering', 'shared toasts and menus render text, not HTML', () => {
  ok(!/t\.innerHTML\s*=\s*`[^`]*\$\{msg\}/.test(SHELL), 'toast must not interpolate msg into innerHTML');
  ok(/body\.textContent = msg/.test(SHELL), 'toast uses textContent');
  ok(/lab\.textContent/.test(SHELL), 'menu labels use textContent');
  ok(!/Math\.random/.test(fs.readFileSync(path.join(ROOT, 'integrations.html'), 'utf8')), 'tokens do not use Math.random');
});

/* CI supply-chain regression: all prototype checkout jobs clear git auth before
   untrusted assets and npm dependencies are executed. */
test('Workflow security', 'checkout tokens cannot persist into prototype tests', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '../../../.github/workflows/ux-prototype.yml'), 'utf8');
  const checkout = 'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1';
  const parts = workflow.split(checkout);
  eq(parts.length, 3, 'exactly two immutable checkout actions');
  parts.slice(1).forEach(part => ok(part.startsWith('\n        with:\n          persist-credentials: false'),
    'checkout must disable credential persistence'));
  ok(!/^\\s*uses:\\s*[a-z0-9_./-]+@(?:v\\d+|main|master)\\b/m.test(workflow),
    'remote GitHub Actions references must be SHA pinned');
});

/* report */
const pass = results.filter(r => r[2]).length;
let group = '';
results.forEach(([g, n, p, m]) => { if (g !== group) { console.log('\n' + g); group = g; } console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '\n        ' + m}`); });
console.log(`\n${pass} of ${results.length} passed`);
if (typeof module !== 'undefined') module.exports = results;
process.exitCode = pass === results.length ? 0 : 1;
