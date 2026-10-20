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

test("authenticated UAT fails closed with absent secrets and cannot run on the production site", () => {
  assert.throws(() => parseConfiguration({}), /Missing authenticated staging inputs/);
  for (const hostname of ["savantskills.app", "www.savantskills.app", "savantrepo.com"]) {
    assert.throws(() => parseConfiguration({ ...valid, SAVANT_UAT_BASE_URL: "https://" + hostname + "/" }),
      /Production-origin browser acceptance is prohibited/);
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
