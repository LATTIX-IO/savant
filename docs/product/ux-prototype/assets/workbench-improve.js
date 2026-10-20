/* Workbench: evaluation results and Auto-Improve improvement layers.
   Review decisions (approve, reject, modify, request more testing) map to recommendation_reviews.
   The recursive loop and Auto-Improve are planned capabilities, shown as previews.
   All figures are sample data. */
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const S = Savant, $ = S.$, $$ = S.$$, WB = window.WB;
    if (!WB) return;
    if (window.WBSKILL && window.WBSKILL.id !== 'incident-triage') {
      // other skills: show results only; no Auto-Improve proposals exist for them yet
      $('#view').insertAdjacentHTML('afterend', `<div class="seg" role="group" aria-label="Canvas layer" id="layer"><button data-v="structure" aria-pressed="true">Structure</button><button data-v="results" aria-pressed="false">Results</button></div>`);
      const sk = S.skills.find(k => k.id === window.WBSKILL.id);
      if (sk) $('#n-skill')?.insertAdjacentHTML('beforeend', `<span class="rs ${sk.status === 'p1' ? 'p1' : ''}">${sk.score != null ? `${sk.score.toFixed(1)} · ${sk.delta > 0 ? '+' : ''}${(sk.delta || 0).toFixed(1)}` : 'Not evaluated'}</span><span class="rs tele">${(sk.runs || 0).toLocaleString()} runs 7d</span>`);
      $$('#layer button').forEach(b => b.onclick = () => { $$('#layer button').forEach(x => x.setAttribute('aria-pressed', x === b)); $('#cw').classList.toggle('layer-results', b.dataset.v === 'results'); requestAnimationFrame(WB.drawEdges); });
      return;
    }
    const now = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

    /* ─── data ─── */
    const BASE = { q: 88.5, v: 'v3.0' }, CAND = { q: 82.4, v: 'v3.1' };
    const TELE = { runs: 2210, success: 88.4, successBase: 89.1, edit: 14, editBase: 13 };
    const P = {
      R1: { t: 'Restore query_pagerduty timeout to 10s', target: 't2', depth: 1, parent: null, x: 570, y: 420, kind: 'prop-side',
        origin: 'Failure cluster · tool timeout · 3 cases in EV-2418', file: 'SKILL.md · tools',
        diff: ['  tools:', '    query_pagerduty:', '-     timeout: 8s', '+     timeout: 10s'],
        shadow: { run: 'EV-2424', q: 86.6, dq: 4.2, fixed: '3 of 3 timeout cases', newFail: 0 },
        tele: [['query_pagerduty timeouts, 7d', '41 of 2,210 runs · 1.9%'], ['Tool p95 latency', '6.9s against an 8s timeout'], ['Field reports', '4 reports: triage stalled waiting on PagerDuty']],
        status0: 'ready-for-review', effect: () => { const n = $('#n-t2'); n.classList.remove('warn'); n.querySelector('.k').innerHTML = 'MCP TOOL'; n.querySelector('.s').textContent = 'Timeout 10s · p95 6.9s'; } },
      R2: { t: 'Add partial-region examples to the severity matrix', target: 'skill', depth: 1, parent: null, x: 290, y: 420, kind: 'prop',
        origin: 'Failure cluster · severity under-classification · 6 cases', file: 'references/severity-matrix.md',
        diff: ['  | SEV-2 | A segment or region is degraded |', '+ | SEV-2 | One region down, others healthy: checkout 5xx 4% in eu-west |', '+ | SEV-1 | Two or more regions degraded for a core action |'],
        shadow: { run: 'EV-2426', q: 84.0, dq: 1.6, fixed: '4 of 6 cluster cases', newFail: 2 },
        tele: [['Severity changed by on-call after triage, 7d', '9.8% of runs'], ['Edit ratio', '14% · baseline 13%'], ['Field reports', '7 reports: severity too low on partial-region outages']],
        status0: 'generated' },
      R3: { t: 'Retry query_pagerduty once with 2s backoff', target: 'R1', depth: 2, parent: 'R1', x: 830, y: 440, kind: 'prop-h',
        origin: 'Recursive improvement · 1 residual timeout under load in the EV-2424 shadow run', file: 'SKILL.md · tools',
        diff: ['    query_pagerduty:', '      timeout: 10s', '+     retry: { attempts: 1, backoff: 2s }'],
        shadow: { run: 'EV-2427', q: 87.9, dq: 1.3, fixed: '1 of 1 residual timeout', newFail: 0 },
        tele: [['Production timeouts after a retry would apply', 'est. 0.4% of runs'], ['Added latency on retry', '+2.0s on 1.9% of runs']],
        status0: 'generated' }
    };
    const order = ['R1', 'R3', 'R2'];
    const st = S.ai.skillState();
    order.forEach(id => { if (st.props[id].modified === undefined) st.props[id].modified = null; });
    const save = () => S.ai.saveSkill(st);
    const TIER = 'T1';
    const crit = () => S.ai.policy()[TIER].skills;
    const autoOn = () => crit().on;
    const log = (mk, text) => { st.log.unshift([now(), mk, text]); st.log = st.log.slice(0, 12); save(); };
    let view = 'loop';

    /* ─── canvas: result lines on nodes ─── */
    const RS = {
      in1: [['', '180 of 180 payloads parsed']],
      in2: [['p2', 'Missing in 12 cases']],
      skill: [['p1', '▲ 82.4 · −6.1 vs v3.0 · 19 failed'], ['tele', `${TELE.runs.toLocaleString()} runs 7d · ${TELE.success}% success`]],
      t1: [['p2', '◆ No runbook match · 4 cases']],
      t2: [['p1', '▲ 3 timeouts · p95 6.9s']],
      d1: [['', 'Loaded in 41 cases · no failures']],
      out: [['', 'Severity match 89% · runbook 94%']]
    };
    Object.entries(RS).forEach(([id, lines]) => { const n = $('#n-' + id); if (n) n.insertAdjacentHTML('beforeend', lines.map(([c, t]) => `<span class="rs ${c}">${t}</span>`).join('')); });

    /* ─── canvas: proposal cards ─── */
    $('#canvas').insertAdjacentHTML('beforeend', `<div class="proplayer"><span class="lane" style="left:24px;top:388px">Auto-Improve proposals · not verified until evaluated</span>${order.map(id => `<button class="node prop" id="n-${id}" data-n="${id}" style="left:${P[id].x}px;top:${P[id].y}px"></button>`).join('')}</div>`);
    order.forEach(id => WB.edges.push([id, P[id].target, P[id].kind]));
    const STATUS = {
      generated: ['sim', 'Generated · not evaluated'], evaluating: ['sim', 'Evaluating in shadow'], 'ready-for-review': ['sim', 'Ready for review'],
      approved: ['ok', 'Approved'], rejected: ['idle', 'Rejected'], superseded: ['idle', 'Superseded'], testing: ['sim', 'More testing requested'], waiting: ['unk', 'Waits for R1']
    };
    const eff = id => { const s = st.props[id].status; return id === 'R3' && s === 'generated' && st.props.R1.status !== 'approved' ? 'waiting' : s; };
    function card(id) {
      const p = P[id], s = st.props[id], e = eff(id), [mk, label] = STATUS[e], el = $('#n-' + id);
      el.className = `node prop ${e === 'approved' ? 'approved' : e === 'rejected' ? 'rejected' : e === 'superseded' ? 'superseded' : e === 'waiting' ? 'waiting' : ''} ${el.classList.contains('sel') ? 'sel' : ''}`;
      el.innerHTML = `<span class="k">${p.depth > 1 ? 'RECURSIVE · ITERATION ' + p.depth : 'AUTO-IMPROVE · ' + id}</span><span class="t">${p.t}</span>
        <span class="ps"><i class="mk ${mk}"></i>${label}${s.evaluated && e !== 'rejected' ? ` · <span class="num">+${p.shadow.dq.toFixed(1)}</span>` : ''}${s.decidedBy === 'auto' ? ' · auto' : ''}</span>${e === 'evaluating' ? `<span class="pbar"><i style="width:${s.prog || 0}%"></i></span>` : ''}`;
      el.setAttribute('aria-label', `${id}: ${p.t}. ${label}`);
    }
    const cards = () => { order.forEach(card); applyEffects(); WB.drawEdges(); countBadge(); };
    function applyEffects() {
      if (st.props.R1.status === 'approved') { P.R1.effect(); const r = $('#n-t2 .rs'); if (r) { r.className = 'rs'; r.textContent = st.props.R3.status === 'approved' ? 'Re-evaluation EV-2428 queued' : 'Re-evaluation EV-2425 queued'; } }
    }

    /* ─── layer switch in the canvas toolbar ─── */
    $('#view').insertAdjacentHTML('afterend', `<div class="seg" role="group" aria-label="Canvas layer" id="layer" data-od-id="canvas-layer">
      <button data-v="structure">Structure</button><button data-v="results">Results</button><button data-v="improve">Improve <span class="tag sim" id="imp-n" style="height:16px;padding:0 5px"></span></button></div>`);
    function countBadge() { const n = order.filter(id => ['generated', 'ready-for-review', 'testing'].includes(eff(id))).length; $('#imp-n').textContent = n; $('#imp-n').hidden = !n; }
    function setLayer(l) {
      st.layer = l; save();
      $$('#layer button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === l));
      $('#cw').classList.toggle('layer-results', l === 'results');
      $('#cw').classList.toggle('layer-improve', l === 'improve');
      requestAnimationFrame(WB.drawEdges);
      if (l === 'improve') { view = 'loop'; WB.select('skill'); } else if ($('.node.prop.sel')) WB.select('skill');
      else if (WB.selected() === 'skill') WB.select('skill');
    }
    $$('#layer button').forEach(b => b.onclick = () => setLayer(b.dataset.v));

    /* ─── panel ─── */
    const gate = id => {
      const p = P[id], c = crit(), out = [];
      out.push([p.shadow.dq >= c.minDelta, `Quality +${p.shadow.dq.toFixed(1)} in shadow (minimum +${c.minDelta.toFixed(1)})`]);
      out.push([p.shadow.newFail <= c.maxNewFail, `${p.shadow.newFail} newly failing case${p.shadow.newFail === 1 ? '' : 's'} (maximum ${c.maxNewFail})`]);
      out.push([TELE.runs >= c.minRuns, `${TELE.runs.toLocaleString()} production runs in 7 days (minimum ${c.minRuns})`]);
      out.push([TELE.successBase - TELE.success <= c.maxSuccessDrop, `Success ${TELE.success}% vs ${TELE.successBase}% baseline (max drop ${c.maxSuccessDrop} pt)`]);
      out.push([TELE.edit - TELE.editBase <= c.maxEditRise, `Edit ratio ${TELE.edit}% vs ${TELE.editBase}% (max rise ${c.maxEditRise} pts)`]);
      out.push([p.depth <= c.maxDepth, `Iteration ${p.depth} of ${c.maxDepth} allowed`]);
      const rep = { R1: 4, R2: 7, R3: 1 }[id]; out.push([rep >= c.minReports || p.depth > 1, p.depth > 1 ? 'Recursive iteration: field reports inherited from ' + p.parent : `${rep} field reports support it (minimum ${c.minReports})`]);
      return out;
    };
    const passes = id => gate(id).every(g => g[0]);
    function iterRows() {
      const rows = [[`Baseline ${BASE.v}`, BASE.q, ''], [`Candidate ${CAND.v}`, CAND.q, 'p1']];
      let q = CAND.q;
      ['R1', 'R3', 'R2'].forEach(id => { const s = st.props[id]; if (s.evaluated && !['rejected', 'superseded'].includes(s.status)) { q = +(q + P[id].shadow.dq * (id === 'R3' ? 1 : 1)).toFixed(1); rows.push([`+ ${id}${s.status === 'approved' ? '' : ' (shadow)'}`, Math.min(q, 99), s.status === 'approved' ? 'ok' : 'sim']); } });
      return rows.map(([l, v, c]) => `<div class="it"><span class="lab">${l}</span><span class="bar ${c === 'p1' ? 'p1' : ''}"><i class="${c === 'sim' ? 'sim' : ''}" style="width:${(v - 70) / 30 * 100}%"></i></span><span class="num ${c === 'p1' ? 'st p1' : ''}">${v.toFixed(1)}</span></div>`).join('');
    }
    function loopPanel() {
      const c = crit(), pend = order.filter(id => ['generated', 'ready-for-review', 'testing'].includes(eff(id)));
      $('#config').innerHTML = `
        <div class="sect"><div class="row"><span class="muted small">Incident triage · ${CAND.v} candidate</span></div><h2>Improvement loop</h2></div>
        <div class="sect"><div class="row"><span class="lbl">Quality by iteration</span><span class="small muted" style="margin-left:auto">gate 85</span></div><div class="lp-iter">${iterRows()}</div></div>
        <div class="sect"><div class="row"><span class="lbl">Proposals</span><span class="small muted" style="margin-left:auto">${pend.length} awaiting a decision</span></div>
          <ul class="lp-props">${order.map(id => { const e = eff(id), [mk, label] = STATUS[e]; return `<li class="${P[id].parent ? 'child' : ''}"><button data-p="${id}"><span class="pt">${P[id].parent ? '↳ ' : ''}${P[id].t}</span><span class="num small">${st.props[id].evaluated ? '+' + P[id].shadow.dq.toFixed(1) : '—'}</span><span class="pm st ${mk === 'sim' ? 'sim' : mk === 'unk' ? 'unk' : ''}"><i class="mk ${mk}"></i>${label}${st.props[id].decidedBy === 'auto' ? ' by Auto-Improve' : ''}</span></button></li>`; }).join('')}</ul></div>
        <div class="sect" data-od-id="auto-improve">
          <div class="row"><span class="lbl" style="font-size:13px;color:var(--fg)">Auto-Improve</span><span class="cap plan">Planned</span><span class="st ${c.on ? '' : 'unk'}" style="margin-left:auto"><i class="mk ${c.on ? 'ok' : 'unk'}"></i>${c.on ? 'On' : 'Off'} for Tier 1</span></div>
          <dl class="kv"><dt>Minimum quality gain</dt><dd class="num">+${c.minDelta}</dd><dt>Newly failing cases</dt><dd class="num">≤ ${c.maxNewFail}</dd><dt>Production runs, 7d</dt><dd class="num">≥ ${c.minRuns}</dd><dt>Success-rate drop</dt><dd class="num">≤ ${c.maxSuccessDrop} pt</dd><dt>Edit-ratio rise</dt><dd class="num">≤ ${c.maxEditRise} pts</dd><dt>Recursive iterations</dt><dd class="num">≤ ${c.maxDepth}</dd></dl>
          <div class="row"><a class="btn sm" href="settings.html#auto-improve">Edit Tier 1 policy</a>${c.on ? '<button class="btn sm" id="auto-run">Run Auto-Improve now</button>' : ''}</div>
          <div class="banner" style="font-size:12px"><i class="mk unk"></i><span>Tier 1: Auto-Improve commits to the candidate branch only. Promotion to production still needs 2 approvers.</span></div>
        </div>
        ${st.log.length ? `<div class="sect"><span class="lbl">Loop activity</span><ul class="lp-log">${st.log.map(l => `<li><span class="t">${l[0]}</span><i class="mk ${l[1]}"></i><span>${l[2]}</span></li>`).join('')}</ul></div>` : ''}`;
      $$('#config [data-p]').forEach(b => b.onclick = () => WB.select(b.dataset.p));
      $('#auto-run') && ($('#auto-run').onclick = () => runAuto());
    }
    const diffHtml = (lines) => `<pre class="pd-diff">${lines.map(l => `<div class="${l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}">${S.esc(l)}</div>`).join('')}</pre>`;
    function propPanel(id) {
      const p = P[id], s = st.props[id], e = eff(id), [mk, label] = STATUS[e];
      const decided = ['approved', 'rejected', 'superseded'].includes(s.status);
      const canEval = !s.evaluated && e !== 'waiting' && !decided && s.status !== 'evaluating';
      const lines = s.modified || p.diff;
      $('#config').innerHTML = `
        <div class="sect"><button class="pd-back" id="pd-back">${S.icon('chev').replace('<svg', '<svg style="transform:rotate(180deg)"')}Improvement loop</button>
          <span class="muted small">${p.depth > 1 ? `Recursive iteration ${p.depth} · follows ${p.parent}` : `Auto-Improve proposal ${id}`}</span><h2>${p.t}</h2>
          <div class="row wrap"><span class="st ${mk === 'sim' ? 'sim' : mk === 'unk' ? 'unk' : ''}"><i class="mk ${mk}"></i>${label}${s.decidedBy ? ` · ${s.decidedBy === 'auto' ? 'Auto-Improve' : 'priya.a'} ${s.at}` : ''}</span><button class="btn sm tertiary" id="pd-target" style="margin-left:auto">Show ${p.target === 'skill' ? 'skill' : p.target === 'R1' ? 'R1' : 'query_pagerduty'}</button></div></div>
        <div class="sect"><span class="lbl">Why Auto-Improve proposed it</span><p class="small fg2">${p.origin}</p>
          <div class="row"><span class="lbl">Change · <span class="mono">${p.file}</span></span>${s.modified ? '<span class="tag" style="margin-left:auto">Modified</span>' : ''}</div>
          <div id="pd-diffbox">${diffHtml(lines)}</div></div>
        <div class="sect"><span class="lbl">Evaluation evidence</span>
          ${s.evaluated ? `<table class="tbl compact ev-tbl"><tbody><tr><td class="muted">Shadow run</td><td class="r mono"><a href="runs.html">${p.shadow.run}</a></td></tr><tr><td class="muted">Quality</td><td class="r num">${(CAND.q + (id === 'R3' ? P.R1.shadow.dq : 0)).toFixed(1)} → ${p.shadow.q.toFixed(1)} <span class="delta">+${p.shadow.dq.toFixed(1)}</span></td></tr><tr><td class="muted">Targeted failures fixed</td><td class="r">${p.shadow.fixed}</td></tr><tr><td class="muted">Newly failing</td><td class="r num ${p.shadow.newFail ? 'st p2' : ''}">${p.shadow.newFail ? '<i class="mk p2"></i>' : ''}${p.shadow.newFail}</td></tr></tbody></table>`
            : s.status === 'evaluating' ? `<div class="row small"><span class="st sim"><i class="mk sim"></i>Shadow evaluation running</span><span class="num muted" style="margin-left:auto">${Math.round((s.prog || 0) * 1.8)} / 180</span></div><div class="bar"><i style="width:${s.prog || 0}%"></i></div>`
            : e === 'waiting' ? '<p class="small muted">This iteration builds on R1. It can be evaluated once R1 is approved.</p>' : '<p class="small muted">Not evaluated. The expected effect has not been measured.</p>'}</div>
        <div class="sect"><span class="lbl">Production telemetry</span><table class="tbl compact ev-tbl"><tbody>${p.tele.map(t => `<tr><td class="muted">${t[0]}</td><td class="r">${t[1]}</td></tr>`).join('')}</tbody></table></div>
        ${s.evaluated && !decided ? `<div class="sect"><div class="row"><span class="lbl">Auto-Improve criteria</span><span class="cap plan" style="margin-left:auto">Planned</span></div>${gate(id).map(g => `<span class="guard"><i class="mk ${g[0] ? 'ok' : 'p2'}"></i><span class="${g[0] ? 'fg2' : 'st p2'}">${g[1]}</span></span>`).join('')}</div>` : ''}
        <div class="sect" id="pd-acts">${decided ? (s.status === 'approved' ? `<div class="row"><span class="small fg2">Committed to savant/incident-triage-v3.1</span><button class="btn sm" id="pd-revert" style="margin-left:auto">Revert</button></div>` : '<span class="small muted">No further action.</span>')
          : `<div class="row wrap">${canEval ? `<button class="btn primary" id="pd-eval">${S.icon('play')}Evaluate in shadow</button>` : `<button class="btn primary" id="pd-approve" ${s.evaluated && s.status !== 'evaluating' ? '' : 'disabled title="Needs a shadow evaluation first"'}>${s.modified ? 'Approve with changes' : 'Approve'}</button>`}
              <button class="btn" id="pd-modify" ${s.status === 'evaluating' ? 'disabled' : ''}>Modify</button><button class="btn" id="pd-test" ${s.evaluated && s.status !== 'testing' ? '' : 'disabled'}>Request more testing</button><button class="btn tertiary" id="pd-reject" style="color:var(--crit-fg)">Reject</button></div>`}</div>`;
      $('#pd-back').onclick = () => { view = 'loop'; WB.select('skill'); };
      $('#pd-target').onclick = () => WB.select(p.target);
      $('#pd-eval') && ($('#pd-eval').onclick = () => evaluate(id));
      $('#pd-approve') && ($('#pd-approve').onclick = () => approve(id, false));
      $('#pd-test') && ($('#pd-test').onclick = () => { s.status = 'testing'; log('sim', `More testing requested for ${id} · re-run on 60 stratified cases`); save(); cards(); propPanel(id); S.toast(`${id}: more testing requested`); });
      $('#pd-reject') && ($('#pd-reject').onclick = async () => {
        const kids = order.filter(k => P[k].parent === id && !['approved', 'rejected'].includes(st.props[k].status));
        if (!await S.confirm({ title: `Reject ${id}?`, body: `“${p.t}” is marked rejected and kept in the audit log. Auto-Improve will not regenerate it for this failure cluster.${kids.length ? ` ${kids.join(', ')} depends on it and will be superseded.` : ''}`, confirm: 'Reject proposal', danger: true })) return;
        s.status = 'rejected'; s.decidedBy = 'user'; s.at = now(); kids.forEach(k => st.props[k].status = 'superseded'); log('idle', `priya.a rejected ${id}`); save(); cards(); propPanel(id); S.toast(`${id} rejected`);
      });
      $('#pd-modify') && ($('#pd-modify').onclick = () => {
        $('#pd-diffbox').innerHTML = `<textarea class="textarea mono" id="pd-edit" rows="${lines.length + 1}" style="width:100%;font-size:12px" aria-label="Edit proposed change">${lines.join('\n')}</textarea><div class="row" style="margin-top:6px"><button class="btn sm" id="pd-keep">Keep edit</button><button class="btn sm tertiary" id="pd-cancel">Cancel</button><span class="small muted" style="margin-left:auto">Edits invalidate the shadow result</span></div>`;
        $('#pd-cancel').onclick = () => propPanel(id);
        $('#pd-keep').onclick = () => { const v = $('#pd-edit').value.split('\n').filter(l => l.trim()); if (JSON.stringify(v) === JSON.stringify(lines)) return propPanel(id); s.modified = v; s.evaluated = false; s.status = 'generated'; log('sim', `priya.a modified ${id} · shadow evaluation required again`); save(); cards(); propPanel(id); };
      });
      $('#pd-revert') && ($('#pd-revert').onclick = async () => {
        if (!await S.confirm({ title: `Revert ${id}?`, body: `Removes the change from the candidate branch and queues a re-evaluation.${id === 'R1' && st.props.R3.status === 'approved' ? ' R3 builds on it and is reverted too.' : ''}`, confirm: 'Revert change', danger: true })) return;
        s.status = 'ready-for-review'; s.decidedBy = null; if (id === 'R1' && st.props.R3.status === 'approved') { st.props.R3.status = 'ready-for-review'; st.props.R3.decidedBy = null; }
        log('p2', `priya.a reverted ${id}`); save(); location.reload();
      });
    }
    async function approve(id, auto) {
      const p = P[id], s = st.props[id];
      if (!auto && !await S.confirm({ title: `Approve ${id}?`, body: `Commits “${p.t}” to branch savant/incident-triage-v3.1 and queues a full re-evaluation. Production is unchanged until the release is approved.`, confirm: s.modified ? 'Approve with changes' : 'Approve' })) return;
      s.status = 'approved'; s.decidedBy = auto ? 'auto' : 'user'; s.at = now();
      log('ok', `${auto ? 'Auto-Improve approved' : 'priya.a approved'} ${id} · +${p.shadow.dq.toFixed(1)} quality, ${p.shadow.newFail} newly failing`);
      save(); cards(); if (!auto) S.toast(`${id} approved · committed to the candidate branch`);
      refresh(id);
    }
    function evaluate(id) {
      return new Promise(res => {
        const s = st.props[id]; s.status = 'evaluating'; s.prog = 0; save(); cards(); refresh(id);
        const t = setInterval(() => { s.prog = Math.min(100, s.prog + 12); card(id); if (view === id) propPanel(id);
          if (s.prog >= 100) { clearInterval(t); s.status = 'ready-for-review'; s.evaluated = true; delete s.prog; log('sim', `Shadow evaluation ${P[id].shadow.run} complete for ${id} · +${P[id].shadow.dq.toFixed(1)}`); save(); cards(); refresh(id); res(); } }, 240);
      });
    }
    const refresh = id => { if (view === id) propPanel(id); else if (view === 'loop' && $('#cw').classList.contains('layer-improve')) loopPanel(); };

    /* ─── Auto-Improve (planned preview) ─── */
    let running = false;
    async function runAuto() {
      if (running) return; running = true;
      for (const id of order) {
        if (!autoOn()) break;
        const s = st.props[id];
        if (['approved', 'rejected', 'superseded'].includes(s.status) || eff(id) === 'waiting') continue;
        if (P[id].depth > crit().maxDepth) { log('p2', `Held ${id} · iteration ${P[id].depth} exceeds the Tier 1 limit of ${crit().maxDepth}`); continue; }
        if (!s.evaluated) await evaluate(id);
        if (passes(id)) await approve(id, true);
        else { const f = gate(id).filter(g => !g[0]).map(g => g[1].toLowerCase()); if (s.status !== 'testing') { log('p2', `Held ${id} for review · ${f.join('; ')}`); s.status = 'ready-for-review'; } save(); cards(); }
      }
      // R3 becomes eligible once R1 is approved: one more pass for recursive iterations
      if (autoOn() && st.props.R1.status === 'approved' && ['generated'].includes(st.props.R3.status)) { running = false; return runAuto(); }
      if (autoOn()) { const open = order.filter(id => ['generated', 'ready-for-review', 'testing'].includes(eff(id))); log(open.length ? 'unk' : 'ok', open.length ? `Loop paused · ${open.length} proposal${open.length > 1 ? 's' : ''} need a person` : 'Loop converged · no failure cluster above 2 cases'); S.toast(open.length ? `Auto-Improve finished · ${open.length} held for review` : 'Auto-Improve finished · loop converged'); }
      running = false; save(); if (view === 'loop') loopPanel();
    }

    /* ─── hook into Workbench selection ─── */
    WB.extend = id => {
      if (P[id]) { view = id; propPanel(id); return true; }
      if (id === 'skill' && $('#cw').classList.contains('layer-improve')) { view = 'loop'; loopPanel(); return true; }
      view = null; return false;
    };
    document.addEventListener('ai-change', e => { if (e.detail.kind !== 'skill') return; const f = S.ai.skillState(); st.props = f.props; st.log = f.log; cards(); refresh(view); });
    cards(); setLayer(st.layer || 'structure');
    if (new URLSearchParams(location.search).get('layer') === 'improve') setLayer('improve');
  });
})();
