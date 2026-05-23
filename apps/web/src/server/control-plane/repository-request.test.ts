import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRepositoryConnectRequest,
  RepositoryRequestError,
  resolveRepositoryProvisionRequest,
  resolveRepositoryValidationRequest,
} from "./repository-request.ts";

test("resolveRepositoryValidationRequest rejects the placeholder more provider", async () => {
  await assert.rejects(
    () => resolveRepositoryValidationRequest({
      path: "connect",
      provider: "more",
      repoUrl: "https://github.com/acme/finance-skills",
      defaultBranch: "main",
      displayName: "Finance Skills",
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryRequestError);
      assert.equal(error.code, "invalid_repository_provider");
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test("resolveRepositoryValidationRequest preserves connect requests for concrete providers without read adapters", async () => {
  const resolved = await resolveRepositoryValidationRequest({
    path: "connect",
    provider: "azure",
    repoUrl: "https://dev.azure.com/acme/platform/_git/finance-skills",
    defaultBranch: "main",
    displayName: "Finance Skills",
  });

  assert.equal(resolved.request.provider, "azure");
  assert.equal(resolved.request.defaultBranch, "main");
  assert.equal(resolved.metadata, undefined);
  assert.equal(resolved.request.observedPaths, undefined);
});

test("resolveRepositoryValidationRequest auto-previews GitLab repositories through the registered read adapter", async () => {
  const originalFetch = globalThis.fetch;
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
      json: async () => ([
        { path: "registry/skills.yaml", type: "blob" },
        { path: "tier1/standards/compliance-review/SKILL.md", type: "blob" },
      ]),
    },
  ];

  globalThis.fetch = async () => responses.shift() as Response;

  try {
    const resolved = await resolveRepositoryValidationRequest({
      path: "connect",
      provider: "gitlab",
      repoUrl: "https://gitlab.com/team/platform/finance-skills",
      defaultBranch: "stale-branch",
      displayName: "Finance Skills",
    });

    assert.equal(resolved.request.provider, "gitlab");
    assert.equal(resolved.request.defaultBranch, "main");
    assert.deepEqual(resolved.request.observedPaths, [
      "registry/skills.yaml",
      "tier1/standards/compliance-review/SKILL.md",
    ]);
    assert.equal(resolved.metadata?.displayName, "team/platform/finance-skills");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveRepositoryProvisionRequest keeps optional connection and visibility selections", async () => {
  const resolved = await resolveRepositoryProvisionRequest({
    provider: "github",
    repoUrl: "https://github.com/acme/finance-skills",
    defaultBranch: "main",
    displayName: "Finance Skills",
    connectionId: "conn_123",
    visibility: "internal",
  });

  assert.equal(resolved.request.provider, "github");
  assert.equal(resolved.request.connectionId, "conn_123");
  assert.equal(resolved.request.visibility, "internal");
  assert.equal(resolved.validationRequest.path, "provision");
});

test("resolveRepositoryConnectRequest keeps optional connection selections", async () => {
  const resolved = await resolveRepositoryConnectRequest({
    provider: "github",
    repoUrl: "https://github.com/acme/finance-skills",
    defaultBranch: "main",
    displayName: "Finance Skills",
    connectionId: "conn_123",
    observedPaths: ["registry/skills.yaml"],
  });

  assert.equal(resolved.request.provider, "github");
  assert.equal(resolved.request.connectionId, "conn_123");
  assert.equal(resolved.validationRequest.path, "connect");
});

test("repository requests reject webhook sync mode in the secure MVP", async () => {
  await assert.rejects(
    () => resolveRepositoryProvisionRequest({
      provider: "github",
      repoUrl: "https://github.com/acme/finance-skills",
      defaultBranch: "main",
      displayName: "Finance Skills",
      syncMode: "webhook",
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryRequestError);
      assert.equal(error.code, "repository_sync_mode_disabled");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("resolveRepositoryProvisionRequest rejects unsupported visibility values", async () => {
  await assert.rejects(
    () => resolveRepositoryProvisionRequest({
      provider: "github",
      repoUrl: "https://github.com/acme/finance-skills",
      defaultBranch: "main",
      displayName: "Finance Skills",
      visibility: "secret",
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryRequestError);
      assert.equal(error.code, "invalid_repository_visibility");
      assert.equal(error.status, 400);
      return true;
    },
  );
});