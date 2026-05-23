import assert from "node:assert/strict";
import test from "node:test";

import { getRepositoryProviderReadiness } from "@savant/types";
import type {
  RepoContractValidationPayload,
  RepositoryListItem,
  SkillScaffoldApplyRequest,
} from "@savant/types";

import { parseRepositoryLocator } from "./repository-provider.ts";
import { RepositorySyncError } from "./repository-sync.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";
import type { RouteHandledError } from "./write-route-handlers.ts";
import {
  createRepositoryConnectPostHandler,
  createRepositoryProvisionPostHandler,
  createRepositorySyncPostHandler,
  createSkillScaffoldApplyPostHandler,
} from "./write-route-handlers.ts";

class TestRouteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status: number, details?: string) {
    super(message);
    this.name = "TestRouteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isKnownRouteError(error: unknown): error is RouteHandledError {
  return error instanceof TestRouteError || error instanceof RepositorySyncError;
}

function createTenantContext(): ResolvedTenantContext {
  return {
    identity: {
      subject: "auth0|user_123",
      email: "owner@example.com",
      displayName: "Workspace Owner",
    },
    tenant: {
      organizationId: "org_123",
      workspaceName: "Acme",
      workspaceSlug: "acme",
      isDefault: true,
      isLastUsed: true,
    },
    memberships: [],
    isDevelopmentFallback: false,
  };
}

function createRequest(url = "https://savantrepo.com/api/test?workspaceSlug=acme") {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ ok: true }),
  });
}

function createRepositoryListItem(): RepositoryListItem {
  return {
    id: "repo_123",
    provider: "github",
    providerReadiness: getRepositoryProviderReadiness("github"),
    name: "acme/finance-skills",
    webUrl: "https://github.com/acme/finance-skills",
    branch: "main",
    skills: 3,
    lastSync: "just now",
    status: "ok",
    projection: {
      indexedAt: null,
      lastSuccessfulSyncAt: null,
      lastWebhookAt: null,
    },
  };
}

function createReadyValidation(): RepoContractValidationPayload {
  return {
    ready: true,
    providerReadiness: getRepositoryProviderReadiness("github"),
    validationSource: "bootstrap-template",
    checks: [],
    missingTopLevelDirectories: [],
    missingRegistryFiles: [],
    discoveredSkillPackageRoots: [],
    nextSteps: [],
    summary: {
      observedPathCount: 0,
      discoveredSkillPackageCount: 0,
      missingTopLevelDirectoryCount: 0,
      missingRegistryFileCount: 0,
    },
  };
}

function createGitHubLocator() {
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "https://github.com/acme/finance-skills",
  });

  assert.ok(locator);
  return locator;
}

test("createRepositoryConnectPostHandler returns a created response for a connected repository", async () => {
  const locator = createGitHubLocator();
  let webhookRegistrations = 0;
  const handler = createRepositoryConnectPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({ provider: "github" }),
    resolveRepositoryConnectRequest: async () => ({
      locator,
      metadata: {
        externalId: "123456",
        defaultBranch: "main",
        displayName: "acme/finance-skills",
        visibility: "private",
      },
      validationSource: "provider-live-preview",
      request: {
        provider: "github",
        repoUrl: locator.normalizedUrl,
        defaultBranch: "main",
        displayName: "Finance Skills",
        connectionId: "conn_123",
        syncMode: "poll",
      },
      validationRequest: {
        path: "connect",
        provider: "github",
        repoUrl: locator.normalizedUrl,
        defaultBranch: "main",
        displayName: "Finance Skills",
        syncMode: "poll",
      },
    }),
    validateTenantSkillRepoContract: () => createReadyValidation(),
    connectTenantRepository: async () => ({
      created: true,
      repository: createRepositoryListItem(),
      warnings: [],
    }),
    ensureRepositoryWebhookRegistration: async () => {
      webhookRegistrations += 1;
      return {};
    },
    isKnownError: isKnownRouteError,
  });

  const response = await handler(createRequest("https://savantrepo.com/api/repositories/connect?workspaceSlug=acme"));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.data.repository.id, "repo_123");
  assert.deepEqual(body.data.warnings, []);
  assert.equal(body.meta.sourceOfTruth, "database");
  assert.equal(typeof body.meta.generatedAt, "string");
  assert.equal(webhookRegistrations, 0);
});

test("createRepositoryConnectPostHandler maps tenant write access errors to a 403 response", async () => {
  const locator = createGitHubLocator();
  const handler = createRepositoryConnectPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({ provider: "github" }),
    resolveRepositoryConnectRequest: async () => ({
      locator,
      validationSource: "snapshot-override",
      request: {
        provider: "github",
        repoUrl: locator.normalizedUrl,
        defaultBranch: "main",
        displayName: "Finance Skills",
        syncMode: "poll",
      },
      validationRequest: {
        path: "connect",
        provider: "github",
        repoUrl: locator.normalizedUrl,
        defaultBranch: "main",
        displayName: "Finance Skills",
        syncMode: "poll",
      },
    }),
    validateTenantSkillRepoContract: () => createReadyValidation(),
    connectTenantRepository: async () => {
      throw new TestRouteError(
        "tenant_write_access_denied",
        "Only workspace Owners and platform-admins can connect or update repositories in the current secure MVP.",
        403,
      );
    },
    ensureRepositoryWebhookRegistration: async () => ({}),
    isKnownError: isKnownRouteError,
  });

  const response = await handler(createRequest("https://savantrepo.com/api/repositories/connect?workspaceSlug=acme"));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "tenant_write_access_denied",
      message: "Only workspace Owners and platform-admins can connect or update repositories in the current secure MVP.",
    },
  });
});

test("createRepositoryProvisionPostHandler returns a created response for a provisioned repository", async () => {
  const locator = createGitHubLocator();
  const handler = createRepositoryProvisionPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({ provider: "github" }),
    resolveRepositoryProvisionRequest: async () => ({
      locator,
      request: {
        provider: "github",
        repoUrl: locator.normalizedUrl,
        defaultBranch: "main",
        displayName: "Finance Skills",
        connectionId: "conn_123",
        visibility: "private",
      },
      validationRequest: {
        path: "provision",
        provider: "github",
        repoUrl: locator.normalizedUrl,
        defaultBranch: "main",
        displayName: "Finance Skills",
      },
    }),
    validateTenantSkillRepoContract: () => createReadyValidation(),
    provisionTenantRepository: async () => ({
      repository: createRepositoryListItem(),
      commit: {
        sha: "abc123",
        committedAt: "2026-05-22T10:00:00.000Z",
        url: "https://github.com/acme/finance-skills/commit/abc123",
        changedPaths: ["README.md"],
      },
      indexedSkillCount: 3,
      warnings: [],
    }),
    isKnownError: isKnownRouteError,
  });

  const response = await handler(createRequest("https://savantrepo.com/api/repositories/provision?workspaceSlug=acme"));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.data.commit.sha, "abc123");
  assert.equal(body.data.indexedSkillCount, 3);
  assert.equal(body.meta.sourceOfTruth, "mixed");
});

test("createRepositoryProvisionPostHandler maps tenant write access errors to a 403 response", async () => {
  const locator = createGitHubLocator();
  const handler = createRepositoryProvisionPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({ provider: "github" }),
    resolveRepositoryProvisionRequest: async () => ({
      locator,
      request: {
        provider: "github",
        repoUrl: locator.normalizedUrl,
        defaultBranch: "main",
        displayName: "Finance Skills",
      },
      validationRequest: {
        path: "provision",
        provider: "github",
        repoUrl: locator.normalizedUrl,
        defaultBranch: "main",
        displayName: "Finance Skills",
      },
    }),
    validateTenantSkillRepoContract: () => createReadyValidation(),
    provisionTenantRepository: async () => {
      throw new TestRouteError(
        "tenant_write_access_denied",
        "Only workspace Owners and platform-admins can provision repositories in the current secure MVP.",
        403,
      );
    },
    isKnownError: isKnownRouteError,
  });

  const response = await handler(createRequest("https://savantrepo.com/api/repositories/provision?workspaceSlug=acme"));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "tenant_write_access_denied",
      message: "Only workspace Owners and platform-admins can provision repositories in the current secure MVP.",
    },
  });
});

test("createRepositorySyncPostHandler returns the indexed payload after an accepted sync request", async () => {
  const handler = createRepositorySyncPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({ reason: "manual" }),
    requestTenantRepositorySync: async ({ repositoryId, request }) => {
      assert.equal(repositoryId, "repo_123");
      assert.equal(request.reason, "manual");

      return {
        accepted: true,
        repository: createRepositoryListItem(),
        syncMode: "poll",
        requestedAt: "2026-05-22T10:00:00.000Z",
        nextPollAt: null,
        indexedSkillCount: 0,
        warnings: [],
        message: "Repository sync requested.",
      };
    },
    indexTenantRepository: async ({ repositoryId, requestedAt }) => {
      assert.equal(repositoryId, "repo_123");
      assert.equal(requestedAt.toISOString(), "2026-05-22T10:00:00.000Z");

      return {
        accepted: true,
        repository: createRepositoryListItem(),
        syncMode: "poll",
        requestedAt: "2026-05-22T10:00:00.000Z",
        nextPollAt: null,
        indexedSkillCount: 4,
        warnings: ["indexed inline"],
        message: "Repository indexed.",
      };
    },
    isKnownError: isKnownRouteError,
  });

  const response = await handler(
    createRequest("https://savantrepo.com/api/repositories/repo_123/sync?workspaceSlug=acme"),
    { params: Promise.resolve({ id: "repo_123" }) },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.indexedSkillCount, 4);
  assert.deepEqual(body.data.warnings, ["indexed inline"]);
  assert.equal(body.meta.sourceOfTruth, "database");
});

test("createRepositorySyncPostHandler maps tenant write access errors to a 403 response", async () => {
  const handler = createRepositorySyncPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({ reason: "manual" }),
    requestTenantRepositorySync: async () => {
      throw new TestRouteError(
        "tenant_write_access_denied",
        "Only workspace Owners and platform-admins can request repository syncs in the current secure MVP.",
        403,
      );
    },
    indexTenantRepository: async () => {
      throw new Error("should not index");
    },
    isKnownError: isKnownRouteError,
  });

  const response = await handler(
    createRequest("https://savantrepo.com/api/repositories/repo_123/sync?workspaceSlug=acme"),
    { params: Promise.resolve({ id: "repo_123" }) },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "tenant_write_access_denied",
      message: "Only workspace Owners and platform-admins can request repository syncs in the current secure MVP.",
    },
  });
});

test("createRepositorySyncPostHandler rejects invalid sync reasons before calling the service", async () => {
  let syncCalls = 0;
  const handler = createRepositorySyncPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({ reason: "webhook" }),
    requestTenantRepositorySync: async () => {
      syncCalls += 1;
      throw new Error("should not be called");
    },
    indexTenantRepository: async () => {
      throw new Error("should not index");
    },
    isKnownError: isKnownRouteError,
  });

  const response = await handler(
    createRequest("https://savantrepo.com/api/repositories/repo_123/sync?workspaceSlug=acme"),
    { params: Promise.resolve({ id: "repo_123" }) },
  );

  assert.equal(syncCalls, 0);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "repository_sync_reason_invalid",
      message: "Repository sync reason must be 'manual' or 'initial_connect'.",
    },
  });
});

test("createSkillScaffoldApplyPostHandler forwards connection selections and returns a created response", async () => {
  let capturedRequest: SkillScaffoldApplyRequest | null = null;
  const handler = createSkillScaffoldApplyPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({
      repositoryId: "repo_123",
      connectionId: "conn_123",
      displayName: "Contract Review Assistant",
      tier: "tier2",
      owner: "legal",
      summary: "Reviews contract language for legal teams.",
      dependencies: ["policy-core"],
    }),
    applySkillScaffoldToRepository: async ({ request }) => {
      capturedRequest = request;

      return {
        repository: createRepositoryListItem(),
        skillUuid: "skill_uuid_123",
        skillId: "contract-review-assistant",
        packagePath: "tier2/legal/contract-review-assistant",
        commit: {
          sha: "def456",
          committedAt: "2026-05-22T11:00:00.000Z",
          url: "https://github.com/acme/finance-skills/commit/def456",
          changedPaths: ["registry/skills.yaml"],
        },
        indexedSkillCount: 4,
        warnings: [],
      };
    },
    isKnownError: isKnownRouteError,
  });

  const response = await handler(createRequest("https://savantrepo.com/api/skills/scaffold/apply?workspaceSlug=acme"));
  const body = await response.json();

  assert.ok(capturedRequest);
  const appliedRequest = capturedRequest as SkillScaffoldApplyRequest;
  assert.equal(appliedRequest.connectionId, "conn_123");
  assert.deepEqual(appliedRequest.dependencies, ["policy-core"]);
  assert.equal(response.status, 201);
  assert.equal(body.data.commit.sha, "def456");
  assert.equal(body.meta.sourceOfTruth, "mixed");
});

test("createSkillScaffoldApplyPostHandler maps tenant write access errors to a 403 response", async () => {
  const handler = createSkillScaffoldApplyPostHandler({
    authorizeTenantRequest: async () => createTenantContext(),
    readJsonObject: async () => ({
      repositoryId: "repo_123",
      displayName: "Contract Review Assistant",
      tier: "tier2",
      owner: "legal",
      summary: "Reviews contract language for legal teams.",
    }),
    applySkillScaffoldToRepository: async () => {
      throw new TestRouteError(
        "tenant_write_access_denied",
        "Only workspace Owners and platform-admins can apply scaffold commits in the current secure MVP.",
        403,
      );
    },
    isKnownError: isKnownRouteError,
  });

  const response = await handler(createRequest("https://savantrepo.com/api/skills/scaffold/apply?workspaceSlug=acme"));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "tenant_write_access_denied",
      message: "Only workspace Owners and platform-admins can apply scaffold commits in the current secure MVP.",
    },
  });
});
