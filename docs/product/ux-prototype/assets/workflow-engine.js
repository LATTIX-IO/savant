/* Workflow engine for the prototype: validation, condition evaluation and a deterministic executor.
   Pure functions with no DOM access, so the same code runs in the page and in the acceptance tests. */
(function (root) {
  const TYPES = ['trigger', 'skill', 'branch', 'approval', 'parallel', 'join', 'output'];

  function hash(g) {
    const canon = JSON.stringify({ steps: [...g.steps].sort((a, b) => a.id.localeCompare(b.id)).map(s => [s.id, s.type, s.skill || '', s.pin || '', (s.cond || []).join(' '), s.onfail || 'stop', s.s || '']), edges: [...g.edges].map(e => [e[0], e[1], e[2] || '']).sort() });
    let h = 2166136261; for (const c of canon) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  /* Returns a list of problems. An empty list means the graph can run and be published. */
  function validate(g) {
    const issues = [], ids = new Set(g.steps.map(s => s.id)), by = Object.fromEntries(g.steps.map(s => [s.id, s]));
    const add = (code, msg, step) => issues.push({ code, msg, step });
    g.steps.forEach(s => { if (!TYPES.includes(s.type)) add('type', `Unknown step type “${s.type}”`, s.id); });
    const triggers = g.steps.filter(s => s.type === 'trigger'), outputs = g.steps.filter(s => s.type === 'output');
    if (triggers.length !== 1) add('trigger', `A workflow needs exactly one trigger (found ${triggers.length})`);
    if (!outputs.length) add('output', 'A workflow needs at least one output');
    const seen = new Set();
    g.edges.forEach(([a, b, lab]) => {
      if (!ids.has(a) || !ids.has(b)) return add('edge', `Edge ${a} → ${b} points to a missing step`);
      if (a === b) add('edge', `${a} connects to itself`, a);
      const k = a + '>' + b; if (seen.has(k)) add('edge', `Duplicate edge ${a} → ${b}`, a); seen.add(k);
      if (by[b].type === 'trigger') add('edge', 'Nothing can lead into the trigger', b);
      if (by[a].type === 'output') add('edge', 'An output cannot lead anywhere', a);
      if (lab && by[a].type !== 'branch') add('edge', `Only branches can label edges (${a} → ${b} is “${lab}”)`, a);
    });
    const valid = g.edges.filter(([a, b]) => ids.has(a) && ids.has(b));
    const out = id => valid.filter(e => e[0] === id), inn = id => valid.filter(e => e[1] === id);
    // cycles (depth-first search with colouring)
    const colour = {}; let cyc = null;
    const dfs = id => { colour[id] = 1; for (const [, b] of out(id)) { if (colour[b] === 1) { cyc = cyc || [id, b]; } else if (!colour[b]) dfs(b); } colour[id] = 2; };
    g.steps.forEach(s => { if (!colour[s.id]) dfs(s.id); });
    if (cyc) add('cycle', `The graph has a cycle through ${cyc[0]} → ${cyc[1]}`, cyc[1]);
    // reachability
    if (triggers.length === 1) {
      const reach = new Set([triggers[0].id]), q = [triggers[0].id];
      while (q.length) { const id = q.shift(); out(id).forEach(([, b]) => { if (!reach.has(b)) { reach.add(b); q.push(b); } }); }
      g.steps.forEach(s => { if (!reach.has(s.id)) add('unreachable', `${label(s)} cannot be reached from the trigger`, s.id); });
    }
    const toOut = new Set(outputs.map(s => s.id)), q2 = [...toOut];
    while (q2.length) { const id = q2.shift(); inn(id).forEach(([a]) => { if (!toOut.has(a)) { toOut.add(a); q2.push(a); } }); }
    g.steps.forEach(s => { if (!toOut.has(s.id) && s.type !== 'output') add('dead-end', `${label(s)} never reaches an output`, s.id); });
    // per-type rules
    g.steps.forEach(s => {
      const o = out(s.id), i = inn(s.id);
      if (s.type === 'branch') {
        const yes = o.filter(e => e[2] === 'yes').length, no = o.filter(e => e[2] === 'no').length;
        if (yes !== 1 || no !== 1 || o.length !== 2) add('branch', `${label(s)} needs exactly one yes path and one no path`, s.id);
        if (!s.cond || s.cond.length !== 3 || s.cond[2] === '') add('branch', `${label(s)} has no complete condition`, s.id);
      }
      if (s.type === 'parallel' && o.length < 2) add('parallel', `${label(s)} needs at least two branches`, s.id);
      if (s.type === 'join' && i.length < 2) add('join', `${label(s)} waits for fewer than two inputs`, s.id);
      if (!['branch', 'parallel', 'output'].includes(s.type) && o.length > 1) add('fanout', `${label(s)} has ${o.length} next steps; use a parallel step`, s.id);
      if (s.type === 'skill' && !s.skill) add('skill', 'A skill step has no skill selected', s.id);
    });
    // a join must sit downstream of a parallel step so its inputs can all arrive
    g.steps.filter(s => s.type === 'join').forEach(j => {
      const anc = new Set(), q3 = [j.id];
      while (q3.length) { const id = q3.shift(); inn(id).forEach(([a]) => { if (!anc.has(a)) { anc.add(a); q3.push(a); } }); }
      if (![...anc].some(a => by[a] && by[a].type === 'parallel')) add('join', `${label(j)} is not preceded by a parallel step, so it can never be satisfied`, j.id);
    });
    return issues;
  }
  const label = s => s.type === 'skill' ? (s.skill || 'skill step') : s.type === 'branch' ? 'Branch' : (s.t || s.type);

  /* Conditions compare a field of the latest skill output. SEV-n compares by severity number. */
  const SEV = v => { const m = /^SEV-(\d)$/i.exec(String(v)); return m ? +m[1] : null; };
  function evalCond(cond, ctx) {
    const [field, op, raw] = cond, v = ctx[field];
    if (v === undefined) return { ok: false, missing: true };
    let a = v, b = raw;
    if (SEV(a) != null && SEV(b) != null) { a = SEV(a); b = SEV(b); } else if (!isNaN(parseFloat(a)) && !isNaN(parseFloat(b))) { a = parseFloat(a); b = parseFloat(b); }
    const ok = op === '≤' || op === '<=' ? a <= b : op === '≥' || op === '>=' ? a >= b : op === '<' ? a < b : op === '>' ? a > b : String(a) === String(b);
    return { ok };
  }

  const SAMPLES = {
    sev2: { label: 'checkout-api 5xx in one region', outputs: { 'incident-triage': { severity: 'SEV-2', confidence: 0.91, owner: 'payments' } } },
    sev1: { label: 'auth outage in all regions', outputs: { 'incident-triage': { severity: 'SEV-1', confidence: 0.88, owner: 'identity' } } },
    flaky: { label: 'deploy summary times out once', outputs: { 'incident-triage': { severity: 'SEV-2', confidence: 0.86, owner: 'platform' } }, fail: { 'pr-summarizer': 'once' } },
    bad: { label: 'malformed alert payload', fail: { 'incident-triage': 'always' } }
  };
  const DUR = { skill: 1.8, branch: 0.1, approval: 0, parallel: 0, join: 0, trigger: 0, output: 0.2 };

  /* Deterministic execution. decisions maps approval step id → true / false. Stops at an undecided approval. */
  function run(g, sampleKey, decisions = {}) {
    const sample = SAMPLES[sampleKey] || SAMPLES.sev2, by = Object.fromEntries(g.steps.map(s => [s.id, s]));
    const state = {}, log = [], ctx = {}, attempts = {}, dead = new Set();
    g.steps.forEach(s => state[s.id] = 'pending');
    const next = (id, lab) => g.edges.filter(e => e[0] === id && (!lab || e[2] === lab)).map(e => e[1]);
    const skipFrom = (id, from) => { if (from) dead.add(from + '>' + id); if (state[id] !== 'pending') return; const ins = g.edges.filter(e => e[1] === id); if (!ins.every(e => dead.has(e[0] + '>' + id) || state[e[0]] === 'skipped')) return; state[id] = 'skipped'; next(id).forEach(n => skipFrom(n, id)); };
    const halt = () => g.steps.forEach(x => { if (state[x.id] === 'pending') state[x.id] = 'skipped'; });
    const trigger = g.steps.find(s => s.type === 'trigger'); if (!trigger) return { state, log, done: true, failed: true, total: 0, cost: 0 };
    let queue = [trigger.id], total = 0, cost = 0, failed = false, waitingAt = null, guard = 0;
    while (queue.length && guard++ < 500) {
      const id = queue.shift(), s = by[id]; if (!s || state[id] !== 'pending') continue;
      if (s.type === 'join') { const ins = g.edges.filter(e => e[1] === id); if (ins.some(e => !['done', 'skipped', 'failed-continued'].includes(state[e[0]]))) { if (queue.length) { queue.push(id); continue; } } }
      if (s.type === 'approval') {
        if (!(id in decisions)) { state[id] = 'waiting'; waitingAt = id; log.push({ id, text: `${s.t}: waiting for approval`, mk: 'p2', d: '—' }); break; }
        const ok = decisions[id]; state[id] = ok ? 'done' : 'failed'; log.push({ id, text: `${s.t}: ${ok ? 'approved' : 'rejected'}`, mk: ok ? 'ok' : 'p1', d: '—' });
        if (!ok) { failed = true; halt(); break; }
        queue.push(...next(id)); continue;
      }
      if (s.type === 'skill') {
        const mode = (sample.fail || {})[s.skill], policy = s.onfail || 'stop';
        attempts[id] = 1; let ok = !mode;
        if (!ok && policy === 'retry') { attempts[id] = 2; ok = mode === 'once'; log.push({ id, text: `${s.skill}: attempt 1 failed · retrying`, mk: 'p2', d: '1.8s' }); total += 1.8; }
        if (!ok) {
          total += 0.4;
          if (policy === 'continue') { state[id] = 'failed-continued'; log.push({ id, text: `${s.skill}: failed · continuing without its output`, mk: 'p2', d: '0.4s' }); next(id).forEach(n => { if (!queue.includes(n)) queue.push(n); }); continue; }
          state[id] = 'failed'; failed = true; log.push({ id, text: `${s.skill}: failed${attempts[id] > 1 ? ' after retry' : ''} · workflow stopped`, mk: 'p1', d: '0.4s' }); halt(); break;
        }
        Object.assign(ctx, (sample.outputs || {})[s.skill] || { confidence: 0.85 });
        state[id] = 'done'; total += DUR.skill; cost += 0.011; log.push({ id, text: `${s.skill}${attempts[id] > 1 ? ' · succeeded on retry' : ''}`, mk: 'ok', d: DUR.skill + 's' });
        next(id).forEach(n => { if (!queue.includes(n)) queue.push(n); }); continue;
      }
      if (s.type === 'branch') {
        const r = evalCond(s.cond, ctx);
        if (r.missing) { state[id] = 'failed'; failed = true; log.push({ id, text: `Branch: no “${s.cond[0]}” in the previous output`, mk: 'p1', d: '0.1s' }); halt(); break; }
        state[id] = 'done'; total += DUR.branch; const take = r.ok ? 'yes' : 'no';
        log.push({ id, text: `If ${s.cond.join(' ')}: ${take} (${s.cond[0]} = ${ctx[s.cond[0]]})`, mk: 'idle', d: '0.1s' });
        queue.push(...next(id, take)); next(id, take === 'yes' ? 'no' : 'yes').forEach(n => skipFrom(n, id)); continue;
      }
      state[id] = 'done'; total += DUR[s.type] || 0;
      if (s.type === 'output') log.push({ id, text: `${s.t} delivered`, mk: 'ok', d: DUR.output + 's' });
      next(id).forEach(n => { if (!queue.includes(n)) queue.push(n); });
    }
    const done = !waitingAt;
    if (done) g.steps.forEach(x => { if (state[x.id] === 'pending') state[x.id] = 'skipped'; });
    return { state, log, done, failed, waitingAt, total: +total.toFixed(1), cost: +cost.toFixed(3) };
  }

  const api = { validate, evalCond, run, hash, SAMPLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WFEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
