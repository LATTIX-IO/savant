import assert from "node:assert/strict";
import test from "node:test";

import {
  getVisibleSettingsSectionIds,
  isGovernanceFeatureEnabled,
  isSettingsSectionEnabled,
  isWorkspaceFeatureEnabled,
} from "./workspace-features.ts";

test("development environments keep unfinished governance and settings features visible", () => {
  assert.equal(isGovernanceFeatureEnabled("development"), true);
  assert.equal(isWorkspaceFeatureEnabled("settings-auth", "development"), true);
  assert.equal(isSettingsSectionEnabled("notifications", "development"), true);
  assert.deepEqual(getVisibleSettingsSectionIds("development"), [
    "general",
    "auth",
    "ai",
    "members",
    "security",
    "billing",
    "notifications",
  ]);
});

test("production environments hide unfinished governance pages and sensitive settings sections", () => {
  assert.equal(isGovernanceFeatureEnabled("production"), false);
  assert.equal(isWorkspaceFeatureEnabled("governance-pages", "production"), false);
  assert.equal(isSettingsSectionEnabled("auth", "production"), false);
  assert.equal(isSettingsSectionEnabled("security", "production"), false);
  assert.equal(isSettingsSectionEnabled("notifications", "production"), false);
  assert.deepEqual(getVisibleSettingsSectionIds("production"), [
    "general",
    "ai",
    "members",
    "billing",
  ]);
});
