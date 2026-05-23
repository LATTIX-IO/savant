import assert from "node:assert/strict";
import test from "node:test";

import { parseRepositoryLocator } from "./repository-provider.ts";
import {
  readGitHubRepositoryIndexSnapshot,
  readGitHubRepositoryPreview,
  RepositoryProviderPreviewError,
} from "./repository-provider-github.ts";

test("readGitHubRepositoryPreview resolves repository metadata and observed paths from GitHub API responses", async () => {
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "https://github.com/acme/finance-skills",
  });

  assert.ok(locator);

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
          { path: "docs/README.md", type: "blob" },
          { path: "registry", type: "tree" },
          { path: "registry/skills.yaml", type: "blob" },
          { path: "tier1/standards/compliance-review/SKILL.md", type: "blob" },
        ],
      }),
    },
  ];

  const preview = await readGitHubRepositoryPreview(locator, {
    fetcher: async () => responses.shift() as Response,
  });

  assert.deepEqual(preview.metadata, {
    externalId: "42",
    defaultBranch: "main",
    displayName: "acme/finance-skills",
    visibility: "public",
  });
  assert.deepEqual(preview.observedPaths, [
    "docs/README.md",
    "registry",
    "registry/skills.yaml",
    "tier1/standards/compliance-review/SKILL.md",
  ]);
});

test("readGitHubRepositoryPreview maps GitHub access failures to typed preview errors", async () => {
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "https://github.com/acme/private-skills",
  });

  assert.ok(locator);

  await assert.rejects(
    () => readGitHubRepositoryPreview(locator, {
      fetcher: async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      }) as Response,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryProviderPreviewError);
      assert.equal(error.code, "github_repository_unavailable");
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test("readGitHubRepositoryPreview fails closed when GitHub truncates the repository tree", async () => {
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "https://github.com/acme/large-skills",
  });

  assert.ok(locator);

  const responses = [
    {
      ok: true,
      status: 200,
      json: async () => ({
        id: 84,
        name: "large-skills",
        full_name: "acme/large-skills",
        private: false,
        default_branch: "main",
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        truncated: true,
        tree: [],
      }),
    },
  ];

  await assert.rejects(
    () => readGitHubRepositoryPreview(locator, {
      fetcher: async () => responses.shift() as Response,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryProviderPreviewError);
      assert.equal(error.code, "github_tree_truncated");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("readGitHubRepositoryIndexSnapshot resolves the current commit and decodes indexable files", async () => {
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "https://github.com/acme/finance-skills",
  });

  assert.ok(locator);

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
        object: {
          sha: "abc123def456",
          type: "commit",
        },
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        truncated: false,
        tree: [
          { path: "registry/skills.yaml", type: "blob" },
          { path: "registry/dependencies.yaml", type: "blob" },
          { path: "registry/owners.yaml", type: "blob" },
          { path: "registry/routing-policies.yaml", type: "blob" },
          { path: "tier2/methodology/legal/contract-review-assistant/SKILL.md", type: "blob" },
          { path: "tier2/methodology/legal/contract-review-assistant/metadata.yaml", type: "blob" },
          { path: "tier2/methodology/legal/contract-review-assistant/agents", type: "tree" },
          { path: "tier2/methodology/legal/contract-review-assistant/eval", type: "tree" },
        ],
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        type: "file",
        path: "registry/skills.yaml",
        sha: "sha-skills",
        encoding: "base64",
        content: Buffer.from("version: 1\nskills: []\n", "utf8").toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        type: "file",
        path: "registry/dependencies.yaml",
        sha: "sha-deps",
        encoding: "base64",
        content: Buffer.from("version: 1\ndependencies: []\n", "utf8").toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        type: "file",
        path: "registry/owners.yaml",
        sha: "sha-owners",
        encoding: "base64",
        content: Buffer.from("version: 1\nowners: []\n", "utf8").toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        type: "file",
        path: "registry/routing-policies.yaml",
        sha: "sha-routing",
        encoding: "base64",
        content: Buffer.from("version: 1\npolicies: []\n", "utf8").toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        type: "file",
        path: "tier2/methodology/legal/contract-review-assistant/metadata.yaml",
        sha: "sha-meta",
        encoding: "base64",
        content: Buffer.from(
          [
            'skill_id: "legal/contract-review-assistant"',
            'display_name: "Contract Review Assistant"',
            'tier: tier2',
            'owner: "legal-ops"',
            'version: "1.2.0"',
            'status: "draft"',
            'summary: "Review contract language and highlight risk."',
          ].join("\n") + "\n",
          "utf8",
        ).toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        type: "file",
        path: "tier2/methodology/legal/contract-review-assistant/SKILL.md",
        sha: "sha-skill",
        encoding: "base64",
        content: Buffer.from("# Contract Review Assistant\n\nReview contracts.\n", "utf8").toString("base64"),
      }),
    },
  ];

  const snapshot = await readGitHubRepositoryIndexSnapshot(locator, {
    fetcher: async () => responses.shift() as Response,
  });

  assert.equal(snapshot.commitSha, "abc123def456");
  assert.equal(snapshot.defaultBranch, "main");
  assert.equal(snapshot.files["registry/skills.yaml"], "version: 1\nskills: []\n");
  assert.match(
    snapshot.files["tier2/methodology/legal/contract-review-assistant/metadata.yaml"] ?? "",
    /Contract Review Assistant/,
  );
  assert.ok(snapshot.observedPaths.includes("registry/skills.yaml"));
});