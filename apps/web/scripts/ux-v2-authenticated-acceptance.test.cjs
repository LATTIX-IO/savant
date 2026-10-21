/* eslint-disable @typescript-eslint/no-require-imports -- self-contained Node CommonJS operational test, using an operator-injected Playwright installation */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseConfiguration, tenantPath, CASES } = require("./ux-v2-authenticated-acceptance.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "savant-ux-config-"));
const stateFile = path.join(dir, "auth.json");
fs.writeFileSync(stateFile, JSON.stringify({
  cookies: [{ name: "test", value: "fake", domain: "savant-stage.example.org", path: "/", expires: -1 }],
  origins: [],
}));
const valid = {
  SAVANT_UAT_BASE_URL: "https://savant-stage.example.org/",
  SAVANT_UAT_STORAGE_STATE: stateFile,
  SAVANT_UAT_WORKSPACE_A: "tenant-a",
  SAVANT_UAT_WORKSPACE_B: "tenant-b",
  SAVANT_UAT_WORKSPACE_DENIED: "tenant-denied",
  SAVANT_UAT_SKILL_UUID: "00000000-0000-4000-8000-000000000001",
};
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("authenticated UAT fails closed without a real browser session and defaults to staging-only", () => {
  assert.throws(() => parseConfiguration({}), /Missing authenticated staging inputs/);
  for (const hostname of ["savantskills.app", "www.savantskills.app", "savantrepo.com"]) {
    assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_BASE_URL: "https://" + hostname + "/" }),
      /requires an explicit owner read-only synthetic-tenant acknowledgment/);
  }
  assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_BASE_URL: "http://savant-stage.example.org/" }), /HTTPS origin/);
  assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_BASE_URL: "https://savant-stage.example.org/scope" }), /HTTPS origin/);
});

test("UAT uses three distinct, safe tenant slugs and one safe server-owned skill identity", () => {
  assert.equal(parseConfiguration(valid).workspaceB, "tenant-b");
  assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_WORKSPACE_B: "tenant-a" }), /three distinct/);
  assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_WORKSPACE_DENIED: "https://evil" }), /three distinct/);
  assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_SKILL_UUID: "../../foo" }), /one safe/);
  assert.equal(tenantPath(parseConfiguration(valid), "tenant-a", "/dashboard"), "/o/tenant-a/dashboard");
});

test("browser state must exist, be stored outside Git, and belong to the staging origin", () => {
  assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_STORAGE_STATE: "relative-auth.json" }), /absolute path/);
  const wrong = path.join(dir, "wrong.json");
  fs.writeFileSync(wrong, '{"cookies":[{"domain":"other.example.org"}],"origins":[]}');
  assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_STORAGE_STATE: wrong }), /no cookies scoped/);
});

test("cross-viewport UAT declares both themes at every supported responsive width", () => {
  assert.deepEqual(CASES.map(v => v.width), [390, 390, 768, 768, 1280, 1280, 1440, 1440]);
  assert.equal(CASES.filter(v => v.theme === "dark").length, 4);
});

test("owner production read-only UAT needs exact two-part opt-in and a known production domain", () => {
  const ack = "OWNER-READONLY-PRODUCTION-SYNTHETIC-UX";
  // The positive production test must use a production-origin cookie fixture,
  // not the intentionally staging-scoped cookie used by default negative tests.
  const prodState = path.join(dir, "production-auth.json");
  fs.writeFileSync(prodState, JSON.stringify({cookies: [
    "savantskills.app", "www.savantskills.app", "savantrepo.com",
    "savant-web-jmsbooths-projects.vercel.app",
  ].map(domain => ({name:"test",value:"fake",domain,path:"/",expires:-1})), origins: []}));
  const production = { ...valid, SAVANT_UAT_BASE_URL: "https://savantskills.app/",
    SAVANT_UAT_STORAGE_STATE: prodState };
  assert.throws(() => parseConfiguration({ ...production,
    SAVANT_UAT_OWNER_PRODUCTION_ACK: ack }),
    /requires an explicit owner read-only synthetic-tenant acknowledgment/);
  assert.throws(() => parseConfiguration({ ...production,
    SAVANT_UAT_SYNTHETIC_TENANTS: "true" }),
    /requires an explicit owner read-only synthetic-tenant acknowledgment/);
  assert.throws(() => parseConfiguration({ ...production,
    SAVANT_UAT_OWNER_PRODUCTION_ACK: "OWNER-WRITE-PRODUCTION-SYNTHETIC-UX",
    SAVANT_UAT_SYNTHETIC_TENANTS: "true" }),
    /requires an explicit owner read-only synthetic-tenant acknowledgment/);
  assert.throws(() => parseConfiguration({ ...production,
    SAVANT_UAT_OWNER_PRODUCTION_ACK: ack,
    SAVANT_UAT_SYNTHETIC_TENANTS: "TRUE" }),
    /requires an explicit owner read-only synthetic-tenant acknowledgment/);
  for (const hostname of ["savantskills.app", "www.savantskills.app",
    "savantrepo.com", "savant-web-jmsbooths-projects.vercel.app"]) {
    const cfg = { ...production, SAVANT_UAT_BASE_URL: "https://" + hostname + "/",
      SAVANT_UAT_OWNER_PRODUCTION_ACK: ack,
      SAVANT_UAT_SYNTHETIC_TENANTS: "true" };
    assert.equal(parseConfiguration(cfg).productionReadOnly, true);
  }
  for (const hostname of ["staging.savantskills.app", "example.savantrepo.com"]) {
    assert.throws(() => parseConfiguration({ ...production,
      SAVANT_UAT_BASE_URL: "https://" + hostname + "/",
      SAVANT_UAT_OWNER_PRODUCTION_ACK: ack,
      SAVANT_UAT_SYNTHETIC_TENANTS: "true" }), /Unrecognized production-domain subdomains/);
  }
  assert.equal(parseConfiguration(valid).productionReadOnly, false);
});

test("owner-only UAT script is explicitly read-only and stores screenshots locally", () => {
  const source = fs.readFileSync(path.join(__dirname,
    "ux-v2-authenticated-acceptance.cjs"), "utf8");
  assert.match(source, /Acceptance draft \(not submitted\)/);
  assert.match(source, /Do not submit: this is a read-only browser acceptance/);
  assert.match(source, /os\.tmpdir\(\)/);
  assert.doesNotMatch(source, /createProposal\(|\.post\(|\.put\(|\.delete\(/);
});

test("UX-07 authenticated journey covers every main and administrative workspace without writes", () => {
  const source=fs.readFileSync(path.join(__dirname,"ux-v2-authenticated-acceptance.cjs"),"utf8");
  for (const target of ["/dashboard","/skills","/evaluations","/runs","/intelligence",
    "/router","/settings"]) assert.ok(source.includes(target),target);
  for (const section of ["Evaluation areas","Observed suite runs","Insights sections",
    "Integration categories","Settings sections","Search Savant"]) {
    assert.ok(source.includes(section),section);
  }
  assert.match(source,/verifyAdditionalWorkspaces\(page, config, label, output\)/);
  assert.match(source,/page\.keyboard\.press\("Control\+k"\)/);
  assert.match(source,/page\.keyboard\.press\("Escape"\)/);
  assert.doesNotMatch(source,/\.post\(|\.put\(|\.delete\(|createProposal\(|rotateAIConnection\(/);
});
