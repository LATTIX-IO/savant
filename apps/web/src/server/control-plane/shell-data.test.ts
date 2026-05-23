import assert from "node:assert/strict";
import test from "node:test";

import { buildSavantShellDataFromCounts } from "./shell-data.ts";

test("buildSavantShellDataFromCounts maps live shell query counts into nav badges", () => {
  assert.deepEqual(
    buildSavantShellDataFromCounts({
      skillCount: 14,
      repositoryCount: 3,
      releaseCount: 2,
      activePolicyCount: 5,
      connectorCount: 4,
    }),
    {
      counts: {
        skills: 14,
        repositories: 3,
        evaluations: null,
        releases: 2,
        policies: 5,
        connectors: 4,
      },
    },
  );
});