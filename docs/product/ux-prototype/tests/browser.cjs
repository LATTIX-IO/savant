/* Browser journeys for the UX prototype, with screenshot baselines.
   Library → Workbench → Evaluations → Runs → Insights → Workflows at 390, 768, 1280 and 1440px,
   light theme at every width and dark theme at 1280px.

   Run (CI does this):
     PLAYWRIGHT_MODULE=<path to playwright> PROTOTYPE_URL=http://127.0.0.1:4173 node tests/browser.cjs
   Screenshots are written to tests/screenshots/<theme>-<width>/<page>.png */
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.env.PROTOTYPE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const OUT = path.join(__dirname, 'screenshots');

const JOURNEY = [
  { page: 'library.html', name: 'library', checks: [
    ['Library lists the inventory', d => document.querySelectorAll('#skills tbody tr').length >= 9],
    ['Skills tab count matches the table', d => document.querySelector('#n-skills')?.textContent === String(document.querySelectorAll('#skills tbody tr').length)]] },
  { page: 'workbench.html?skill=pr-summarizer', name: 'workbench', checks: [
    ['Workbench opens the linked skill', d => document.querySelector('.wb-head h1')?.textContent === 'PR summarizer'],
    ['Canvas shows that skill’s tools', d => (document.querySelector('#n-t1')?.textContent || '').includes('get_pr_diff')]] },
  { page: 'evaluations.html', name: 'evaluations', checks: [
    ['Suites and recent results render', d => document.querySelectorAll('#suites tbody tr').length > 0 && document.querySelectorAll('#recent tr').length > 0]] },
  { page: 'runs.html#EV-2418', name: 'runs', checks: [
    ['Deep link opens EV-2418', d => document.querySelector('#insp h1')?.textContent === 'EV-2418'],
    ['Quality gate reports Failed', d => [...document.querySelectorAll('.gate')].some(g => /Quality score/.test(g.textContent) && /Failed/.test(g.textContent))],
    ['Run selector is reachable', w => w > 1000 ? !!document.querySelector('.rlist')?.offsetParent : !!document.querySelector('#rsel')?.offsetParent]] },
  { page: 'insights.html', name: 'insights', checks: [
    ['Comparison verdict renders', d => (document.querySelector('#verdict')?.textContent || '').length > 10]] },
  { page: 'workflows.html', name: 'workflows', checks: [
    ['Workflow graph renders and validates', d => document.querySelectorAll('.gn').length >= 4 && !/validation issue/.test(document.querySelector('#ver-st')?.textContent || '')]] }
];
// pages whose canvases scroll inside their own region by design
const OWN_SCROLL = new Set(['workbench', 'workflows']);

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const runs = [[390, 'light'], [768, 'light'], [1280, 'light'], [1440, 'light'], [1280, 'dark']];
  for (const [width, theme] of runs) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(t => { try { if (!sessionStorage.getItem('sv-seeded')) { localStorage.clear(); localStorage.setItem('sv-ws', '"wh"'); localStorage.setItem('sv-theme', JSON.stringify(t)); sessionStorage.setItem('sv-seeded', '1'); } } catch (e) {} }, theme);
    const dir = path.join(OUT, `${theme}-${width}`); fs.mkdirSync(dir, { recursive: true });
    for (const step of JOURNEY) {
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/favicon|fonts\.g/.test(m.text())) errors.push(m.text()); });
      await page.goto(`${BASE}/${step.page}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const label = `${theme} ${width}px · ${step.name}`;
      for (const [name, fn] of step.checks) {
        let ok = false; try { ok = await page.evaluate(`(${fn.toString()})(${width})`); } catch (e) { ok = false; }
        results.push([label, name, ok]);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      results.push([label, 'No horizontal page overflow', overflow <= 1 || OWN_SCROLL.has(step.name)]);
      results.push([label, 'No script errors', errors.length === 0, errors.join(' | ')]);
      await page.screenshot({ path: path.join(dir, `${step.name}.png`), fullPage: !OWN_SCROLL.has(step.name) });
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  let last = '', failed = 0;
  results.forEach(([label, name, ok, why]) => { if (label !== last) { console.log('\n' + label); last = label; } if (!ok) failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && why ? '\n        ' + why : ''}`); });
  console.log(`\n${results.length - failed} of ${results.length} passed · screenshots in ${path.relative(process.cwd(), OUT)}`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
