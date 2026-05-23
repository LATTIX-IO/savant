import assert from "node:assert/strict";
import test from "node:test";

import { parseRepositoryLocator } from "./repository-provider.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";
import {
  hasRegisteredRepositoryReadAdapter,
  resolveRepositoryReadAdapter,
} from "./repository-provider-read-adapter.ts";

test("resolveRepositoryReadAdapter delegates registered GitHub preview reads", async () => {
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "https://github.com/acme/finance-skills",
  });

  assert.ok(locator);
  assert.equal(hasRegisteredRepositoryReadAdapter("github"), true);

  const responses = [
    {
      ok: true,
      status: 200,
      json: async () => ({
        id: 42,
        name: "finance-skills",
        full_name: "acme/finance-skills",
        private: false,
        default_branch: "main",
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        truncated: false,
        tree: [
          { path: "registry/skills.yaml", type: "blob" },
          { path: "tier1/standards/finance-review/SKILL.md", type: "blob" },
        ],
      }),
    },
  ];

  const preview = await resolveRepositoryReadAdapter("github").readRepositoryPreview(locator, {
    fetcher: async () => responses.shift() as Response,
  });

  assert.equal(preview.metadata.defaultBranch, "main");
  assert.deepEqual(preview.observedPaths, [
    "registry/skills.yaml",
    "tier1/standards/finance-review/SKILL.md",
  ]);
});

test("resolveRepositoryReadAdapter fails closed for providers without registered read adapters", async () => {
  const locator = parseRepositoryLocator({
    provider: "azure",
    repoUrl: "https://dev.azure.com/acme/platform/_git/finance-skills",
  });

  assert.ok(locator);
  assert.equal(hasRegisteredRepositoryReadAdapter("azure"), false);

  await assert.rejects(
    () => resolveRepositoryReadAdapter("azure").readRepositoryIndexSnapshot(locator, {
      branch: "main",
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryProviderError);
      assert.equal(error.code, "repository_provider_index_unsupported");
      assert.equal(error.status, 409);
      return true;
    },
  );
});