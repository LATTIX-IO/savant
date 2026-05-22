import assert from "node:assert/strict";
import test from "node:test";

import {
  isThemePreference,
  resolveThemePreference,
} from "./theme-preference.ts";

test("isThemePreference only accepts supported values", () => {
  assert.equal(isThemePreference("system"), true);
  assert.equal(isThemePreference("light"), true);
  assert.equal(isThemePreference("dark"), true);
  assert.equal(isThemePreference("auto"), false);
  assert.equal(isThemePreference(null), false);
});

test("resolveThemePreference honors explicit selections and system fallback", () => {
  assert.equal(resolveThemePreference("light", true), "light");
  assert.equal(resolveThemePreference("dark", false), "dark");
  assert.equal(resolveThemePreference("system", true), "dark");
  assert.equal(resolveThemePreference("system", false), "light");
});
