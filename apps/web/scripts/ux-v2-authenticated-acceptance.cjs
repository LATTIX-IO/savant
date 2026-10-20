/* eslint-disable @typescript-eslint/no-require-imports -- self-contained Node CommonJS operational test, using an operator-injected Playwright installation */
"use strict";

// Real authenticated Savant UI v2 browser acceptance. No mock sessions and no
// write-side effects. Must be run against an isolated, explicitly authorized
// staging origin with an existing genuine Auth0 browser storage-state file.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REQUIRED = [
  "SAVANT_UAT_BASE_URL",
  "SAVANT_UAT_STORAGE_STATE",
  "SAVANT_UAT_WORKSPACE_A",
  "SAVANT_UAT_WORKSPACE_B",
  "SAVANT_UAT_WORKSPACE_DENIED",
  "SAVANT_UAT_SKILL_UUID",
];
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
  if (PRODUCTION_HOSTS.has(hostname) || hostname.endsWith(".savantskills.app") ||
      hostname.endsWith(".savantrepo.com")) {
    throw new Error("Production-origin browser acceptance is prohibited.");
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
    origin: url.origin, hostname, statePath,
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
  await page.getByRole("heading", { name: "Operational overview" }).waitFor({ state: "visible" });
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
  await page.getByRole("heading", { name: "Operational overview" }).waitFor({ state: "visible" });

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
        if (variant.width === 1280 && variant.theme === "light") {
          await verifyTenantBoundaries(page, config);
        }
        assert.equal(errors, 0, "Unexpected client JavaScript exceptions.");
        completed++;
        process.stdout.write("PASS " + label + " authenticated overview/library/workbench\n");
      } finally { await context.close(); }
    }
    process.stdout.write("PASS " + completed + "/" + CASES.length +
      " authenticated viewport/theme journeys; local-only screenshots: " + output + "\n");
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
