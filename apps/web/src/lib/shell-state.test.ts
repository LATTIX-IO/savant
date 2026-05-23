import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSavantShellBreadcrumbs,
  buildSavantShellData,
  EMPTY_SAVANT_SHELL_DATA,
} from "./shell-state.ts";

test("buildSavantShellBreadcrumbs uses the provided live skill title for skill detail routes", () => {
  assert.deepEqual(
    buildSavantShellBreadcrumbs("/skills/skl_contract-review", {
      skillTitle: "Contract Review Assistant",
    }),
    [
      ["Workspace", null],
      ["Skills", "/skills"],
      ["Contract Review Assistant", "current"],
    ],
  );
});

test("buildSavantShellBreadcrumbs falls back to the evaluation UUID without fixture lookups", () => {
  assert.deepEqual(
    buildSavantShellBreadcrumbs("/evaluations/9c6b87c8-91d1-49b5-a3d0-a55f4a00a6cf"),
    [
      ["Workspace", null],
      ["Evaluations", "/evaluations"],
      ["9c6b87c8-91d1-49b5-a3d0-a55f4a00a6cf", "current"],
    ],
  );
});

test("buildSavantShellData merges live counts without inventing unavailable badges", () => {
  assert.deepEqual(
    buildSavantShellData({
      skills: 12,
      repositories: 3,
      releases: 2,
      connectors: 4,
    }),
    {
      counts: {
        ...EMPTY_SAVANT_SHELL_DATA.counts,
        skills: 12,
        repositories: 3,
        releases: 2,
        connectors: 4,
      },
    },
  );
});