import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isSafeUiV2InternalHref,
  normalizeUiV2Density,
  uiV2MetricValue,
  uiV2StatusLabel,
} from "./contracts.ts";

test("density defaults safely and does not accept arbitrary CSS values", () => {
  assert.equal(normalizeUiV2Density("comfortable"), "comfortable");
  assert.equal(normalizeUiV2Density("compact"), "compact");
  assert.equal(normalizeUiV2Density("roomy"), "compact");
  assert.equal(normalizeUiV2Density("compact; color: red"), "compact");
  assert.equal(normalizeUiV2Density(null), "compact");
});

test("status chips disclose planned, simulated, and unavailable operations even with custom labels", () => {
  assert.equal(uiV2StatusLabel("planned", "Workflow execution"), "Planned · Workflow execution");
  assert.equal(uiV2StatusLabel("simulated", "Evaluation complete"), "Simulated · Evaluation complete");
  assert.equal(uiV2StatusLabel("unavailable", "Step trace"), "Unavailable · Step trace");
  assert.equal(uiV2StatusLabel("failed", "Threshold exceeded"), "Threshold exceeded");
  assert.equal(uiV2StatusLabel("running", "   "), "Running");
});

test("metric rendering cannot turn absent or invalid evidence into zero or a pass", () => {
  for (const value of [undefined, null, Number.NaN, Infinity, -Infinity, "", "  "]) {
    assert.equal(uiV2MetricValue(value), "Not available");
  }
  assert.equal(uiV2MetricValue(0), "0");
  assert.equal(uiV2MetricValue(82.4), "82.4");
});

test("only rooted internal app URLs are accepted as navigation links", () => {
  for (const href of ["/o/workspace/dashboard", "/skills/id?tab=results", "/"]) {
    assert.equal(isSafeUiV2InternalHref(href), true);
  }
  for (const href of ["https://example.org", "javascript:alert(1)", "//other.host", "/\\evil", "/x\nnew", "", null, {}]) {
    assert.equal(isSafeUiV2InternalHref(href), false);
  }
});

test("v2 primitives are pure presentation components, with no storage, network, unsafe HTML or auth bypass", () => {
  const component = readFileSync(fileURLToPath(new URL("./index.tsx", import.meta.url)), "utf8");
  const css = readFileSync(fileURLToPath(new URL("./ui-v2.module.css", import.meta.url)), "utf8");
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|\.innerHTML\s*=|localStorage|sessionStorage|fetch\s*\(|eval\s*\(/);
  assert.doesNotMatch(component, /<a\s+href=|window\.location/);
  assert.match(component, /isSafeUiV2InternalHref/);
  assert.match(component, /type = "button"/);
  assert.ok(component.includes("type={type}"), "button passes the safe default type");
  assert.match(css, /\.surface\s*\{/);
  assert.doesNotMatch(css, /^\s*(?:html|body|:root)\s*\{/m);
});
