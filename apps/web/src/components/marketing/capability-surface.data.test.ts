import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_PREVIEW_APPROVALS,
  PLATFORM_PREVIEW_KPIS,
  PLATFORM_PREVIEW_NAV,
  PLATFORM_PREVIEW_RELEASE_QUEUE,
  PLATFORM_PREVIEW_REPOSITORIES,
} from "./capability-surface.data.ts";

test("platform preview data exposes one active navigation item and all overview KPIs", () => {
  const navItems = PLATFORM_PREVIEW_NAV.flatMap((group) => group.items);

  assert.equal(navItems.filter((item) => item.active).length, 1);
  assert.equal(navItems.find((item) => item.active)?.label, "Overview");
  assert.equal(PLATFORM_PREVIEW_KPIS.length, 4);
});

test("platform preview data covers approvals, repositories, and release queue states", () => {
  assert.equal(PLATFORM_PREVIEW_APPROVALS.length >= 4, true);
  assert.equal(PLATFORM_PREVIEW_REPOSITORIES.some((repository) => repository.status === "offline"), true);
  assert.equal(
    PLATFORM_PREVIEW_RELEASE_QUEUE.some((item) => item.route === "staging-to-production"),
    true,
  );
});