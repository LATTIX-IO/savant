/* Workbench: resolve the skill from ?skill= and load its files, tools, dependencies and versions.
   Runs before the Workbench script so the canvas, editor and panels all describe the same skill. */
(function () {
  const PROFILES = {
    'contract-clause-reviewer': { in1: ['Contract document', 'PDF or DOCX · Ironclad'], in2: ['Playbook version', 'legal playbook v12'], tools: [['search_clause_library', 'legal-kb'], ['fetch_counterparty_history', 'ironclad-mcp']], dep: null, out: ['Clause review', 'clauses, risk, playbook refs, redlines'], refs: ['playbook-v12.md', 'risk-matrix.md', 'extract_clauses.py'], cases: 180, rubric: 'clause-rubric-v4', desc: 'Review a contract against the legal playbook, flag non-standard clauses and propose redlines.', steps: ['Extract clauses with scripts/extract_clauses.py.', 'Compare each clause with references/playbook-v12.md.', 'Score risk with references/risk-matrix.md.', 'Look up the counterparty history.', 'Return flagged clauses with suggested redlines.'] },
    'pr-summarizer': { in1: ['Pull request diff', 'GitHub webhook'], in2: ['Linked issues', 'Jira keys'], tools: [['get_pr_diff', 'github-mcp'], ['list_linked_issues', 'jira-mcp']], dep: null, out: ['PR summary', 'summary, risk, migration notes'], refs: ['style-guide.md', 'risk-signals.md', 'chunk_diff.py'], cases: 240, rubric: 'pr-rubric-v3', desc: 'Summarise a pull request for reviewers and call out risky changes.', steps: ['Chunk the diff with scripts/chunk_diff.py.', 'Summarise each chunk.', 'Flag risk using references/risk-signals.md.', 'Write the summary in the house style.'] },
    'rfp-response-drafter': { in1: ['RFP questionnaire', 'XLSX or portal export'], in2: ['Answer library', 'approved answers'], tools: [['search_answer_library', 'answers-mcp'], ['fetch_case_studies', 'crm-mcp']], dep: 'customer-email-tone-pass', out: ['Draft response', 'answers, sources, open questions'], refs: ['win-themes.md', 'compliance-boilerplate.md', 'parse_questionnaire.py'], cases: 120, rubric: 'rfp-rubric-v2', desc: 'Draft RFP answers from the approved answer library and case studies.', steps: ['Parse the questionnaire.', 'Match each question to approved answers.', 'Add a relevant case study.', 'Run the tone pass on the final draft.'] },
    'soc2-evidence-drafter': { in1: ['Control ID', 'SOC 2 control'], in2: ['Evidence sources', 'systems in scope'], tools: [['pull_access_logs', 'okta-mcp'], ['fetch_tickets', 'jira-mcp']], dep: null, out: ['Evidence memo', 'control, evidence, gaps'], refs: ['control-catalogue.md', 'evidence-standards.md', 'collect_evidence.py'], cases: 72, rubric: 'evidence-rubric-v1', desc: 'Draft audit evidence for a SOC 2 control from system records.', steps: ['Resolve the control in references/control-catalogue.md.', 'Collect access logs and tickets.', 'Check against references/evidence-standards.md.', 'Write the evidence memo and list gaps.'] },
    'engineering-rfc-reviewer': { in1: ['RFC document', 'Confluence page'], in2: ['Architecture guidelines', 'ADR index'], tools: [['fetch_rfc', 'confluence-mcp'], ['search_adrs', 'git-mcp']], dep: 'pr-summarizer', out: ['Review comments', 'structure, risks, security, questions'], refs: ['review-checklist.md', 'security-considerations.md', 'outline_rfc.py'], cases: 240, rubric: 'rfc-rubric-v2', desc: 'Review an engineering RFC against the architecture guidelines.', steps: ['Outline the RFC.', 'Check related ADRs.', 'Apply references/review-checklist.md.', 'Cover security using references/security-considerations.md.'] },
    'customer-email-tone-pass': { in1: ['Draft email', 'plain text or HTML'], in2: ['Recipient context', 'account and role'], tools: [['lookup_account', 'salesforce-mcp'], ['brand_glossary', 'docs-mcp']], dep: null, out: ['Revised email', 'revision, changes, tone score'], refs: ['voice-and-tone.md', 'legal-recipients.md', 'diff_tone.py'], cases: 150, rubric: 'tone-rubric-v2', desc: 'Adjust a customer email to the brand voice for its recipient.', steps: ['Look up the recipient account.', 'Pick the register from references/voice-and-tone.md.', 'Rewrite and list changes.'] },
    'quarterly-earnings-summary': { in1: ['Earnings release', 'press release or 10-Q'], in2: ['Prior quarter summary', 'last memo'], tools: [['fetch_filing', 'filings-mcp'], ['query_metrics', 'warehouse-mcp']], dep: null, out: ['Summary memo', 'headline, drivers, guidance'], refs: ['metric-definitions.md', 'memo-template.md', 'extract_tables.py'], cases: 60, rubric: 'earnings-rubric-v1', desc: 'Summarise quarterly earnings for leadership.', steps: ['Extract tables from the filing.', 'Compare with the prior quarter.', 'Write the memo from references/memo-template.md.'] }
  };
  const GENERIC = { in1: ['Request', 'user input'], in2: ['Context', 'optional'], tools: [['search_documents', 'docs-mcp']], dep: null, out: ['Result', 'defined in SKILL.md'], refs: ['README.md', 'examples.md', 'helpers.py'], cases: 0, rubric: 'not set', desc: 'Describe what this skill does and when to use it.', steps: ['Describe the first step.', 'Describe the next step.'] };

  document.addEventListener('DOMContentLoaded', () => {
    const S = window.Savant, $ = S.$, $$ = S.$$, P = new URLSearchParams(location.search);
    const isNew = P.get('new') === '1';
    const id = P.get('skill') || 'incident-triage';
    const sk = isNew ? { id: 'new-skill', name: 'New skill', tier: 'T3', repo: 'wh/skills', ver: 'v0.1', env: 'draft', score: null, dataset: '—', sim: true } : (S.skills.find(k => k.id === id) || S.skills.find(k => k.id === 'incident-triage'));
    if (sk.id === 'incident-triage') { window.WBSKILL = { id: sk.id }; return; }
    const pf = PROFILES[sk.id] || GENERIC, e = S.esc, ver = sk.cand || sk.ver, dep = pf.dep && S.skills.find(k => k.id === pf.dep);
    const hasEval = sk.score != null;
    const set = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };

    document.title = `Workbench · ${sk.name} · Savant`;
    set('[data-od-id="breadcrumbs"]', `<a href="library.html">Library</a><span>/</span><a href="library.html#${e(sk.id)}">${e(sk.name)}</a><span>/</span><span>Workbench</span>`);
    set('.wb-head .ttl', `<div class="row wrap"><h1>${e(sk.name)}</h1><span class="tag ${sk.cand ? 'sim' : ''}">${e(ver)} ${sk.cand ? 'candidate' : sk.env}</span><span class="tag">${e(sk.repo)}</span><span class="tag">branch savant/${e(sk.id)}-${e(ver)}</span>${sk.sim ? '<span class="tag sim">Simulated</span>' : ''}</div>`);
    const cta = $('[data-od-id="cta-prepare-evaluation"]'); if (cta) cta.href = `evaluations.html?skill=${encodeURIComponent(sk.id)}#new`;

    // file tree
    const refBtns = $$('.tree [data-ref]');
    pf.refs.forEach((r, i) => { if (refBtns[i]) { refBtns[i].dataset.ref = r; refBtns[i].lastChild.textContent = r; } });
    const evBtns = $$('.tree [data-node]');
    const dsName = sk.dataset && sk.dataset !== '—' ? sk.dataset : 'No dataset yet';
    if (evBtns[0]) evBtns[0].lastChild.textContent = dsName;
    if (evBtns[1]) evBtns[1].lastChild.textContent = pf.rubric;
    if (evBtns[2]) evBtns[2].lastChild.textContent = hasEval ? `baseline ${sk.cand ? sk.ver : sk.ver}` : 'no baseline';

    // canvas nodes
    const node = (n, k, t, s2, mono) => { const el = $('#n-' + n); if (!el) return; el.classList.remove('warn'); el.innerHTML = `<span class="k">${k}</span><span class="t ${mono ? 'mono' : ''}" ${mono ? 'style="font-size:12px"' : ''}>${e(t)}</span><span class="s ${mono ? '' : 'mono'}">${e(s2)}</span>`; };
    node('in1', 'INPUT', pf.in1[0], pf.in1[1]); node('in2', 'INPUT', pf.in2[0], pf.in2[1]);
    node('skill', `SKILL · ${e(ver)}`, sk.name, `${pf.steps.length} steps · ${pf.refs.length - 1} references`);
    node('t1', 'MCP TOOL', pf.tools[0][0], pf.tools[0][1] + ' server', true);
    if (pf.tools[1]) node('t2', 'MCP TOOL', pf.tools[1][0], pf.tools[1][1] + ' server', true); else $('#n-t2')?.remove();
    if (dep) node('d1', 'LOADS SKILL', dep.name, `${dep.ver} · ${dep.env}`); else $('#n-d1')?.remove();
    node('out', 'OUTPUT', pf.out[0], pf.out[1]);
    node('ds', 'DATASET', dsName, pf.cases ? `${pf.cases} cases` : 'Generate from the manifest', true);
    node('rb', 'RUBRIC', pf.rubric, 'rubric judge', true);
    node('bl', 'BASELINE', hasEval ? `${sk.ver} · ${sk.env}` : 'None yet', hasEval ? `Quality ${sk.score.toFixed(1)}` : 'Run a first evaluation');
    const br = $('#n-br'), p2 = $('#n-p2');
    if (br) br.innerHTML = '<span class="k">BRANCH · PLANNED</span><span class="t">If confidence ≥ 0.8</span><span class="s">Otherwise send for review</span>';
    if (p2) p2.innerHTML = '<span class="k">SKILL · PLANNED</span><span class="t">Customer email tone pass</span><span class="s">Notify the requester</span>';

    const src = `---
name: ${sk.id}
description: ${pf.desc}
version: ${ver.replace('v', '')}.0
tier: ${sk.tier.toLowerCase().replace('t', 'tier')}
owner: ${sk.owner || '—'}
telemetry: full
tools:
${pf.tools.map(t => '  - ' + t[0]).join('\n')}
${dep ? `dependencies:\n  - ${dep.id}@^${dep.ver.replace('v', '')}\n` : ''}---

# ${sk.name}

## Procedure
${pf.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}

## Output
${pf.out[1]}
`;
    const refs = {}; pf.refs.forEach(r => refs[r] = r.endsWith('.py') ? `# ${r}\n# helper used by ${sk.id}\n` : `# ${r.replace('.md', '').replace(/-/g, ' ')}\n\nReference material for ${sk.name}.\n`);
    const kv = (rows) => `<dl class="kv">${rows.map(r => `<dt>${r[0]}</dt><dd ${r[2] ? 'class="mono"' : ''}>${e(r[1])}</dd>`).join('')}</dl>`;
    const nodes = {
      in1: { t: pf.in1[0], k: 'Input', body: kv([['Format', pf.in1[1]], ['Required', 'Yes']]) },
      in2: { t: pf.in2[0], k: 'Input', body: kv([['Format', pf.in2[1]], ['Required', 'No']]) },
      t1: { t: pf.tools[0][0], k: 'MCP tool', body: kv([['Server', pf.tools[0][1], 1], ['Timeout', '10s', 1]]) },
      t2: pf.tools[1] ? { t: pf.tools[1][0], k: 'MCP tool', body: kv([['Server', pf.tools[1][1], 1], ['Timeout', '10s', 1]]) } : undefined,
      d1: dep ? { t: dep.name, k: 'Loads skill', body: kv([['Resolved', `${dep.ver} · ${dep.env}`, 1], ['Quality', dep.score != null ? dep.score.toFixed(1) : '—', 1]]) + `<a class="btn sm" href="workbench.html?skill=${encodeURIComponent(dep.id)}">Open ${e(dep.name)}</a>` } : undefined,
      out: { t: pf.out[0], k: 'Output', body: kv([['Fields', pf.out[1]]]) },
      ds: { t: dsName, k: 'Dataset', body: pf.cases ? kv([['Cases', String(pf.cases), 1]]) + `<a class="btn sm" href="evaluations.html">Open in evaluations</a>` : '<p class="small muted">No dataset yet</p><a class="btn sm" href="evaluations.html?skill=' + encodeURIComponent(sk.id) + '#new">Generate dataset</a>' },
      rb: { t: pf.rubric, k: 'Rubric', body: kv([['Judge', 'Savant rubric judge']]) },
      bl: { t: hasEval ? `${sk.ver} · ${sk.env}` : 'No baseline', k: 'Baseline', body: hasEval ? kv([['Quality', sk.score.toFixed(1), 1]]) + `<a class="btn sm" href="insights.html?a=${encodeURIComponent(sk.id)}">Compare versions</a>` : '<p class="small muted">Run a first evaluation to set a baseline.</p>' }
    };
    const runs = S.db.runs().filter(r => r.skill === sk.id), last = runs[0];
    const lastEvalHtml = last ? `<div class="sect"><span class="lbl">Last evaluation</span><div class="row"><span class="st ${last.st === 'regressed' || last.st === 'failed' ? 'p1' : ''}"><i class="mk ${last.st === 'running' ? 'idle' : last.st === 'regressed' || last.st === 'failed' ? 'p1' : 'ok'}"></i>${last.st === 'running' ? 'Running' : last.st[0].toUpperCase() + last.st.slice(1)}</span><span class="num">${last.q ?? `${last.done}/${last.n}`}</span><a class="btn sm" style="margin-left:auto" href="runs.html#${last.id}">Inspect</a></div></div>`
      : `<div class="sect"><span class="lbl">Last evaluation</span><div class="row"><span class="st unk"><i class="mk unk"></i>Not evaluated</span><a class="btn sm" style="margin-left:auto" href="evaluations.html?skill=${encodeURIComponent(sk.id)}#new">Evaluate</a></div></div>`;
    window.WBSKILL = { id: sk.id, name: sk.name, src, refs, nodes, tools: pf.tools.map(t => t[0]), noDep: !dep, noT2: !pf.tools[1], lastEvalHtml, isNew };
  });
})();
