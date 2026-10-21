/* eslint-disable @typescript-eslint/no-require-imports -- self-contained Node CommonJS operational test, using an operator-injected Playwright installation */
"use strict";

// Real authenticated Savant UI v2 browser acceptance. No mock sessions and no
// write-side effects. Isolated staging remains the default. An owner-only
// synthetic-data production pilot is possible with an exact local opt-in.
// Neither path stores Auth0 browser credentials in source control.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writePrivateBrowserCapture } = require("./ux-v2-browser-capture.cjs");

const REQUIRED = [
  "SAVANT_UAT_BASE_URL",
  "SAVANT_UAT_STORAGE_STATE",
  "SAVANT_UAT_WORKSPACE_A",
  "SAVANT_UAT_WORKSPACE_B",
  "SAVANT_UAT_WORKSPACE_DENIED",
  "SAVANT_UAT_SKILL_UUID",
];
const OWNER_PRODUCTION_ACK = "OWNER-READONLY-PRODUCTION-SYNTHETIC-UX";
const PRODUCTION_HOSTS = new Set([
  "savantskills.app", "www.savantskills.app", "savantrepo.com",
  "www.savantrepo.com", "savant-web-jmsbooths-projects.vercel.app",
]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESOURCE_ID = /^[A-Za-z0-9-]{1,128}$/;
const CASES = [
  { width: 390, theme: "light" }, { width: 390, theme: "dark" },
  { width: 768, theme: "light" }, { width: 768, theme: "dark" },
  { width: 1280, theme: "light" }, { width: 1280, theme: "dark" },
  { width: 1440, theme: "light" }, { width: 1440, theme: "dark" },
];

function parseConfiguration(env) {
  const missing = REQUIRED.filter(key => !env[key] || !String(env[key]).trim());
  if (missing.length) throw new Error("Missing authenticated staging inputs: " + missing.join(", "));
  let url;
  try { url = new URL(env.SAVANT_UAT_BASE_URL); }
  catch { throw new Error("SAVANT_UAT_BASE_URL must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/" || url.port) {
    throw new Error("Staging URL must be an HTTPS origin without credentials, path, port or query.");
  }
  const hostname = url.hostname.toLowerCase();
  const productionReadOnly = PRODUCTION_HOSTS.has(hostname);
  // Full staging is deferred for the sole-owner, no-customer pilot, but the
  // production read-only exception must never admit arbitrary subdomains or
  // accidentally accept a production origin in the normal staging mode.
  if (productionReadOnly && (
      env.SAVANT_UAT_OWNER_PRODUCTION_ACK !== OWNER_PRODUCTION_ACK ||
      env.SAVANT_UAT_SYNTHETIC_TENANTS !== "true")) {
    throw new Error("Production-origin browser acceptance requires an explicit owner read-only synthetic-tenant acknowledgment.");
  }
  if (!productionReadOnly && (hostname.endsWith(".savantskills.app") ||
      hostname.endsWith(".savantrepo.com"))) {
    throw new Error("Unrecognized production-domain subdomains are not authorized for browser acceptance.");
  }
  const workspaces = [
    env.SAVANT_UAT_WORKSPACE_A, env.SAVANT_UAT_WORKSPACE_B,
    env.SAVANT_UAT_WORKSPACE_DENIED,
  ];
  if (workspaces.some(v => !SLUG.test(v)) || new Set(workspaces).size !== 3) {
    throw new Error("Use three distinct canonical workspace slugs.");
  }
  if (!RESOURCE_ID.test(env.SAVANT_UAT_SKILL_UUID)) {
    throw new Error("SAVANT_UAT_SKILL_UUID must be one safe, known workspace-A skill ID.");
  }
  if (!path.isAbsolute(env.SAVANT_UAT_STORAGE_STATE)) {
    throw new Error("Authenticated browser state must be an absolute path outside the repository.");
  }
  const statePath = fs.realpathSync(env.SAVANT_UAT_STORAGE_STATE);
  const root = path.resolve(__dirname, "../../..");
  if (statePath === root || statePath.startsWith(root + path.sep)) {
    throw new Error("Authenticated browser state must not be stored inside the repository.");
  }
  if (!fs.statSync(statePath).isFile()) throw new Error("Browser state must be a file.");
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { throw new Error("Browser storageState must be valid JSON."); }
  if (!Array.isArray(state.cookies) || !state.cookies.some(cookie => {
    const domain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
    return domain === hostname || hostname.endsWith("." + domain);
  })) {
    throw new Error("Browser state has no cookies scoped to the authorized staging origin.");
  }
  return Object.freeze({
    origin: url.origin, hostname, statePath, productionReadOnly,
    workspaceA: workspaces[0], workspaceB: workspaces[1],
    workspaceDenied: workspaces[2], skillId: env.SAVANT_UAT_SKILL_UUID,
  });
}

function tenantPath(config, workspace, suffix) {
  return "/o/" + encodeURIComponent(workspace) + suffix;
}

async function waitForV2(page) {
  await page.locator('[data-savant-ui="v2"]').waitFor({ state: "visible", timeout: 20000 });
}

async function setTheme(page, expected) {
  const current = await page.locator("html").getAttribute("data-theme");
  if (current !== expected) {
    await page.locator("header button[aria-pressed]").click();
    await page.waitForFunction(theme =>
      document.documentElement.getAttribute("data-theme") === theme, expected,
      { timeout: 8000 });
  }
}

async function assertNoOuterOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.document <= dimensions.width + 1,
    "Unexpected outer viewport overflow.");
}

async function performMainJourney(page, config, label, output) {
  const root = tenantPath(config, config.workspaceA, "");
  await page.goto(config.origin + root + "/dashboard", { waitUntil: "domcontentloaded" });
  await waitForV2(page);
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor({ state: "visible" });
  await assertNoOuterOverflow(page);
  await page.screenshot({ path: path.join(output, label + "-overview.png") });

  // Follow the actual same-origin UI link, not a synthetic DOM mock.
  await page.locator('aside[aria-label="Application navigation"] a[href="' +
    root + '/skills"]').click();
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor({ state: "visible" });
  await page.locator('a[href="' + root + '/skills/' +
    encodeURIComponent(config.skillId) + '"]').first().waitFor({ state: "visible" });
  await page.locator("#sv2-repos-tab").click();
  await page.locator("#sv2-library-list").waitFor({ state: "visible" });
  await page.locator("#sv2-skills-tab").click();
  await assertNoOuterOverflow(page);
  await page.screenshot({ path: path.join(output, label + "-library.png") });

  await page.locator('a[href="' + root + '/skills/' +
    encodeURIComponent(config.skillId) + '"]').first().click();
  await waitForV2(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "SKILL.md Markdown source" });
  await editor.waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await editor.isEnabled(), true, "Verified source must load.");
  assert.equal(await editor.getAttribute("readonly"), null,
    "Fixture requires a managed Git proposal-capable skill, not legacy direct-write.");
  const original = await editor.inputValue();
  await editor.fill(original + "\n\n# Acceptance draft (not submitted)");
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Create change proposal" }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("button", { name: "Create change proposal" }).isEnabled(), true);
  // Do not submit: this is a read-only browser acceptance, not a Git mutation.
  await assertNoOuterOverflow(page);
  await page.screenshot({ path: path.join(output, label + "-workbench.png") });
  // Discard the synthetic unsent draft before exercising browser history so a
  // genuine beforeunload guard cannot interrupt navigation or mutate Git.
  await page.getByRole("button", { name: "Discard draft" }).click();

  // Same-tenant deep links and client-side browser history must remain stable.
  // No writes: the draft above is reviewed but never submitted.
  const active = page.locator('aside[aria-label="Application navigation"] [aria-current="page"]');
  assert.equal(await active.count(), 1, "Workbench must have exactly one active workspace.");
  assert.match((await active.textContent()) || "", /Workbench/);

  await page.goBack({ waitUntil: "domcontentloaded" });
  await waitForV2(page);
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor({ state: "visible" });
  await page.goForward({ waitUntil: "domcontentloaded" });
  await waitForV2(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("textbox", { name: "SKILL.md Markdown source" })
    .waitFor({ state: "visible" });
  await assertNoOuterOverflow(page);
}


/**
 * UX-07: read-only authenticated navigation of the remaining workspaces.
 * No backend stubs, synthetic routes, fixture claims, client token issuance,
 * suite writes, provider calls or release approval clicks.
 */
async function verifyAdditionalWorkspaces(page, config, label, output) {
  const root = tenantPath(config, config.workspaceA, "");
  const routes = [
    ["/evaluations", "Evaluations"],
    ["/runs", "Runs"],
    ["/intelligence", "Insights"],
    ["/router", "Integrations"],
    ["/settings", "Settings"],
  ];
  for (const [suffix, title] of routes) {
    await page.goto(config.origin + root + suffix, { waitUntil: "domcontentloaded" });
    await waitForV2(page);
    await page.getByRole("heading", { name: title, exact: true })
      .first().waitFor({state:"visible",timeout:20000});
    await assertNoOuterOverflow(page);
    const nav = page.locator('aside[aria-label="Application navigation"] [aria-current="page"]');
    assert.equal(await nav.count(),1,
      title + " must have one active navigation destination.");
    assert.match((await nav.textContent()) || "",new RegExp(title));
    if (suffix === "/evaluations") {
      await page.getByRole("tablist", { name: "Evaluation areas" }).waitFor({state:"visible"});
      await page.getByRole("tab", { name: "Datasets" }).click();
      await page.getByRole("tab", { name: "Suites" }).click();
      await page.locator('[aria-label="Definition, execution and results lifecycle"]')
        .waitFor({state:"visible"});
    }
    if (suffix === "/runs") {
      await page.getByRole("navigation", { name: "Observed suite runs" })
        .waitFor({state:"visible"});
      await page.getByRole("region", { name: "Run inspector" }).waitFor({state:"visible"});
    }
    if (suffix === "/intelligence") {
      const tabs=page.getByRole("tablist", { name: "Insights sections" });
      await tabs.waitFor({state:"visible"});
      await page.getByRole("tab", { name: "Releases", exact:true }).click();
      await page.getByRole("tab", { name: "Portfolio", exact:true }).click();
      await page.getByRole("tab", { name: "Compare versions" }).click();
    }
    if (suffix === "/router") {
      await page.getByRole("tablist", { name: "Integration categories" }).waitFor({state:"visible"});
      for (const tab of ["Model providers","Agent clients","Distribution","Setup guide","Source control"]) {
        await page.getByRole("tab", { name:tab,exact:true }).click();
      }
    }
    if (suffix === "/settings") {
      await page.getByRole("navigation", { name:"Settings sections" }).waitFor({state:"visible"});
      for (const tab of ["Members","Access and roles","Policies","Audit log","Billing","General"]) {
        await page.getByRole("navigation", { name:"Settings sections" })
          .getByRole("button", {name:tab,exact:true}).click();
      }
    }
    await assertNoOuterOverflow(page);
    await page.screenshot({path:path.join(output,label+"-"+title.toLowerCase()+".png")});
  }
  // A genuine native command palette must open via the keyboard and close via Escape.
  await page.keyboard.press("Control+k");
  const palette=page.getByRole("dialog", { name: "Search Savant" });
  await palette.waitFor({state:"visible",timeout:15000});
  await page.keyboard.press("Escape");
  await palette.waitFor({state:"hidden"});
}

async function verifyTenantBoundaries(page, config) {
  const aSkill = tenantPath(config, config.workspaceA,
    "/skills/" + encodeURIComponent(config.skillId));
  const bHome = tenantPath(config, config.workspaceB, "/dashboard");
  await page.goto(config.origin + aSkill, { waitUntil: "domcontentloaded" });
  await waitForV2(page);
  await page.locator('summary[aria-label^="Workspace:"]').click();
  await page.locator('a[href="' + bHome + '"]').click();
  await page.waitForURL("**" + bHome);
  await waitForV2(page);
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor({ state: "visible" });

  await page.goto(config.origin + tenantPath(config, config.workspaceB,
    "/skills/" + encodeURIComponent(config.skillId)), { waitUntil: "domcontentloaded" });
  await waitForV2(page);
  await page.getByRole("alert").first().waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await page.getByRole("textbox",
    { name: "SKILL.md Markdown source" }).count(), 0,
    "Workspace B must not read workspace A's source.");

  await page.goto(config.origin + tenantPath(config, config.workspaceDenied, "/dashboard"),
    { waitUntil: "domcontentloaded" });
  assert.equal(await page.locator('[data-savant-ui="v2"]').count(), 0,
    "An unauthorized workspace must never render the protected v2 shell.");
}

async function run(env = process.env) {
  const config = parseConfiguration(env);
  const playwright = require(env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "savant-auth-ux-"));
  let completed = 0;
  try {
    for (const variant of CASES) {
      const context = await browser.newContext({
        storageState: config.statePath,
        viewport: { width: variant.width, height: 900 },
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        let errors = 0;
        page.on("pageerror", () => { errors++; });
        await page.goto(config.origin + tenantPath(config, config.workspaceA, "/dashboard"),
          { waitUntil: "domcontentloaded" });
        await waitForV2(page);
        await setTheme(page, variant.theme);
        const label = variant.theme + "-" + variant.width;
        await performMainJourney(page, config, label, output);
        await verifyAdditionalWorkspaces(page, config, label, output);
        if (variant.width === 1280 && variant.theme === "light") {
          await verifyTenantBoundaries(page, config);
        }
        assert.equal(errors, 0, "Unexpected client JavaScript exceptions.");
        completed++;
        process.stdout.write("PASS " + label + " authenticated eight-workspace read-only journey\n");
      } finally { await context.close(); }
    }
    assert.equal(completed, CASES.length, "All authenticated viewport/theme journeys required.");
    const evidence=writePrivateBrowserCapture({output,config,cases:CASES});
    process.stdout.write("PASS " + completed + "/" + CASES.length +
      " authenticated " + (config.productionReadOnly ? "owner production read-only" : "staging") +
      " viewport/theme journeys; local-only screenshots: " + output +
      "; private browser-only evidence: " + evidence.path + "\n");
  } finally { await browser.close(); }
}

if (require.main === module) {
  run().catch(() => {
    // Do not print raw browser errors, credentials, URLs with query secrets or skill contents.
    process.stderr.write("FAIL authenticated staging acceptance. Inspect local session, " +
      "environment gates and private screenshots; no result was promoted.\n");
    process.exitCode = 1;
  });
}
module.exports = { parseConfiguration, tenantPath, CASES };
