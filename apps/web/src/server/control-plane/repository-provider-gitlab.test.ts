import assert from "node:assert/strict";
import test from "node:test";

import { parseRepositoryLocator } from "./repository-provider.ts";
import {
  readGitLabRepositoryIndexSnapshot,
  readGitLabRepositoryPreview,
} from "./repository-provider-gitlab.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";

test("readGitLabRepositoryPreview resolves repository metadata and paginated observed paths from GitLab API responses", async () => {
  const locator = parseRepositoryLocator({
    provider: "gitlab",
    repoUrl: "https://gitlab.com/team/platform/finance-skills",
  });

  assert.ok(locator);

  const responses = [
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 77,
        name: "finance-skills",
        path_with_namespace: "team/platform/finance-skills",
        default_branch: "main",
        visibility: "public",
      }),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers([["x-next-page", "2"]]),
      json: async () => ([
        { path: "registry", type: "tree" },
        { path: "registry/skills.yaml", type: "blob" },
      ]),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ([
        { path: "tier1/standards/compliance-review/SKILL.md", type: "blob" },
      ]),
    },
  ];

  const preview = await readGitLabRepositoryPreview(locator, {
    fetcher: async () => responses.shift() as Response,
  });

  assert.deepEqual(preview.metadata, {
    externalId: "77",
    defaultBranch: "main",
    displayName: "team/platform/finance-skills",
    visibility: "public",
  });
  assert.deepEqual(preview.observedPaths, [
    "registry",
    "registry/skills.yaml",
    "tier1/standards/compliance-review/SKILL.md",
  ]);
});

test("readGitLabRepositoryPreview maps GitLab access failures to typed provider errors", async () => {
  const locator = parseRepositoryLocator({
    provider: "gitlab",
    repoUrl: "https://gitlab.com/team/platform/private-skills",
  });

  assert.ok(locator);

  await assert.rejects(
    () => readGitLabRepositoryPreview(locator, {
      fetcher: async () => ({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({}),
      }) as Response,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryProviderError);
      assert.equal(error.code, "gitlab_repository_unavailable");
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test("readGitLabRepositoryIndexSnapshot resolves the current commit and decodes indexable files", async () => {
  const locator = parseRepositoryLocator({
    provider: "gitlab",
    repoUrl: "https://gitlab.com/team/platform/finance-skills",
  });

  assert.ok(locator);

  const responses = [
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 77,
        name: "finance-skills",
        path_with_namespace: "team/platform/finance-skills",
        default_branch: "main",
        visibility: "public",
      }),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        name: "main",
        commit: {
          id: "abc123def456",
        },
      }),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ([
        { path: "registry/skills.yaml", type: "blob" },
        { path: "registry/dependencies.yaml", type: "blob" },
        { path: "registry/owners.yaml", type: "blob" },
        { path: "registry/routing-policies.yaml", type: "blob" },
        { path: "tier2/methodology/legal/contract-review-assistant/SKILL.md", type: "blob" },
        { path: "tier2/methodology/legal/contract-review-assistant/metadata.yaml", type: "blob" },
        { path: "tier2/methodology/legal/contract-review-assistant/agents", type: "tree" },
        { path: "tier2/methodology/legal/contract-review-assistant/eval", type: "tree" },
      ]),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        file_path: "registry/skills.yaml",
        blob_id: "sha-skills",
        encoding: "base64",
        content: Buffer.from("version: 1\nskills: []\n", "utf8").toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        file_path: "registry/dependencies.yaml",
        blob_id: "sha-deps",
        encoding: "base64",
        content: Buffer.from("version: 1\ndependencies: []\n", "utf8").toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        file_path: "registry/owners.yaml",
        blob_id: "sha-owners",
        encoding: "base64",
        content: Buffer.from("version: 1\nowners: []\n", "utf8").toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        file_path: "registry/routing-policies.yaml",
        blob_id: "sha-routing",
        encoding: "base64",
        content: Buffer.from("version: 1\npolicies: []\n", "utf8").toString("base64"),
      }),
    },
    {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        file_path: "tier2/methodology/legal/contract-review-assistant/metadata.yaml",
        blob_id: "sha-meta",
        encoding: "base64",
        content: Buffer.from(
          [
            'skill_id: "legal/contract-review-assistant"',
            'display_name: "Contract Review Assistant"',
            "tier: tier2",
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
      headers: new Headers(),
      json: async () => ({
        file_path: "tier2/methodology/legal/contract-review-assistant/SKILL.md",
        blob_id: "sha-skill",
        encoding: "base64",
        content: Buffer.from("# Contract Review Assistant\n\nReview contracts.\n", "utf8").toString("base64"),
      }),
    },
  ];

  const snapshot = await readGitLabRepositoryIndexSnapshot(locator, {
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
