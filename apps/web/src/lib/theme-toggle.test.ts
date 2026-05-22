import assert from "node:assert/strict";
import test from "node:test";

import { buildBinaryThemeToggleState } from "./theme-toggle.ts";

test("buildBinaryThemeToggleState flips dark mode back to light with the right copy", () => {
  assert.deepEqual(buildBinaryThemeToggleState("dark"), {
    isDark: true,
    nextTheme: "light",
    title: "Switch to light mode",
  });
});

test("buildBinaryThemeToggleState flips light mode into dark with the right copy", () => {
  assert.deepEqual(buildBinaryThemeToggleState("light"), {
    isDark: false,
    nextTheme: "dark",
    title: "Switch to dark mode",
  });
});