import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
test("reference ledger maps each of the fourteen approved source screens to a live owner or explicit limitation", () => {
  const text = readFileSync(fileURLToPath(new URL("../../../../../../docs/product/ux-prototype/IMPLEMENTATION-FIDELITY.md", import.meta.url)), "utf8");
  for (const page of ["index", "overview", "library", "workbench", "evaluations", "runs",
    "insights", "integrations", "settings", "access", "onboarding", "discovery", "reports", "workflows"]) {
    assert.ok(text.includes(`${page}.html`), page);
  }
  assert.match(text, /fabricated spans/);
  assert.match(text, /owner-authenticated/);
});
