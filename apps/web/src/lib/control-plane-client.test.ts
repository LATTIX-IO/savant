import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTenantScopedControlPlanePath,
  buildControlPlaneQuery,
  ControlPlaneClientError,
  fetchRepositoryDetail,
  fetchSkillList,
} from "./control-plane-client.ts";

test("buildControlPlaneQuery omits empty values and encodes filters", () => {
  assert.equal(
    buildControlPlaneQuery({
      channel: "production",
      query: "contract review",
      status: "",
      team: undefined,
      tier: 2,
    }),
    "?channel=production&query=contract+review&tier=2",
  );
});

test("buildTenantScopedControlPlanePath appends workspaceSlug without dropping existing query params", () => {
  assert.equal(
    buildTenantScopedControlPlanePath("/api/skills?query=legal", { workspaceSlug: "finance-ops" }),
    "/api/skills?query=legal&workspaceSlug=finance-ops",
  );
});

test("fetchSkillList requests the skills API with encoded filters", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/skills?query=legal+ops&tier=2");

      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            count: 0,
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "derived-index",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchSkillList({ query: "legal ops", tier: 2 });
  assert.equal(response.meta.count, 0);
  assert.deepEqual(response.data, []);
});

test("fetchSkillList appends the workspace slug when tenant context is provided", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/skills?query=legal+ops&workspaceSlug=finance-ops");

      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            count: 0,
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "derived-index",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchSkillList(
    { query: "legal ops" },
    { workspaceSlug: "finance-ops" },
  );
  assert.equal(response.meta.count, 0);
});

test("fetchRepositoryDetail throws a typed error when the API responds with an error payload", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "repository_not_found",
            message: "Repository 'missing' was not found.",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 404,
        },
      ),
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  await assert.rejects(
    () => fetchRepositoryDetail("missing"),
    (error: unknown) => {
      assert.ok(error instanceof ControlPlaneClientError);
      assert.equal(error.code, "repository_not_found");
      assert.equal(error.status, 404);
      assert.match(error.message, /missing/);
      return true;
    },
  );
});