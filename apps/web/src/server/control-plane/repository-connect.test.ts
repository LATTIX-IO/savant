import assert from "node:assert/strict";
import test from "node:test";

import type {
  RepoConnectRequest,
  RepoContractValidationPayload,
} from "@savant/types";
import { getRepositoryProviderReadiness } from "@savant/types";

import {
  connectTenantRepository,
  RepositoryConnectError,
  type RepositoryConnectionBindingResolver,
  type RepositoryConnectPersistence,
  type RepositoryConnectPersistenceInput,
} from "./repository-connect.ts";
import { parseRepositoryLocator } from "./repository-provider.ts";
import type {
  RepositoryProviderMetadata,
} from "./repository-provider.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";
import type { TenantWriteAccessStore } from "./tenant-write-access.ts";

function createTenantContext(): ResolvedTenantContext {
  return {
    identity: {
      subject: "auth0|user_123",
      email: "owner@example.com",
      displayName: "Owner Example",
    },
    tenant: {
      organizationId: "org_123",
      workspaceName: "Finance Ops",
      workspaceSlug: "finance-ops",
      isDefault: true,
      isLastUsed: true,
    },
    memberships: [
      {
        organizationId: "org_123",
        workspaceName: "Finance Ops",
        workspaceSlug: "finance-ops",
        isDefault: true,
        isLastUsed: true,
      },
    ],
    isDevelopmentFallback: false,
  };
}

function createReadyValidation(
  overrides?: Partial<RepoContractValidationPayload>,
): RepoContractValidationPayload {
  return {
    ready: true,
    providerReadiness: getRepositoryProviderReadiness("github"),
    validationSource: "provider-live-preview",
    checks: [],
    missingTopLevelDirectories: [],
    missingRegistryFiles: [],
    discoveredSkillPackageRoots: ["tier2/methodology/legal/contract-review-assistant"],
    nextSteps: ["Repository contract is satisfied; proceed to indexing or ingest."],
    summary: {
      observedPathCount: 15,
      discoveredSkillPackageCount: 1,
      missingTopLevelDirectoryCount: 0,
      missingRegistryFileCount: 0,
    },
    ...overrides,
  };
}

function createGitHubRequest(): RepoConnectRequest {
  return {
    provider: "github",
    repoUrl: "https://github.com/acme/finance-skills",
    defaultBranch: "main",
    displayName: "Finance Skills",
    syncMode: "poll",
    observedPaths: [
      "registry/skills.yaml",
      "tier2/methodology/legal/contract-review-assistant/SKILL.md",
    ],
  };
}

function createGitHubMetadata(): RepositoryProviderMetadata {
  return {
    externalId: "123456",
    defaultBranch: "main",
    displayName: "acme/finance-skills",
    visibility: "public",
  };
}

function createWriteAccessStore(): TenantWriteAccessStore {
  return {
    resolveAccess: async () => ({
      userId: "user_123",
      isFirstMember: true,
      groups: [],
    }),
  };
}

function createNullConnectionBindingResolver(): RepositoryConnectionBindingResolver {
  return async () => null;
}

test("connectTenantRepository persists a validated repository and maps it into a repository list item", async () => {
  const persistenceCalls: RepositoryConnectPersistenceInput[] = [];
  const persistence: RepositoryConnectPersistence = {
    persistConnection: async (input) => {
      persistenceCalls.push(input);

      return {
        created: true,
        repository: {
          id: "repo_123",
          providerType: "github",
          ownerName: "acme",
          repoName: "finance-skills",
          canonicalCloneUrl: "https://github.com/acme/finance-skills",
          defaultBranch: "main",
          repositoryStatus: "connected",
          updatedAt: "2026-05-22T10:00:00.000Z",
        },
        syncState: {
          syncMode: "poll",
          status: "idle",
          lastIndexedAt: null,
          lastSuccessfulSyncAt: null,
          lastWebhookAt: null,
        },
      };
    },
  };
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "github.com/acme/finance-skills",
  });

  assert.ok(locator);
  const result = await connectTenantRepository(
    {
      context: createTenantContext(),
      request: createGitHubRequest(),
      validation: createReadyValidation(),
      locator,
      metadata: createGitHubMetadata(),
      now: new Date("2026-05-22T10:00:00.000Z"),
    },
    {
      persistence,
      resolveConnectionBinding: createNullConnectionBindingResolver(),
      writeAccessStore: createWriteAccessStore(),
    },
  );

  assert.equal(persistenceCalls.length, 1);
  assert.deepEqual(persistenceCalls[0], {
    organizationId: "org_123",
    actorSubject: "auth0|user_123",
    connectionId: null,
    provider: "github",
    ownerName: "acme",
    repoName: "finance-skills",
    canonicalCloneUrl: "https://github.com/acme/finance-skills",
    externalRepoId: "123456",
    defaultBranch: "main",
    visibility: "public",
    syncMode: "poll",
    validation: createReadyValidation(),
  });

  assert.equal(result.created, true);
  assert.equal(result.repository.id, "repo_123");
  assert.equal(result.repository.provider, "github");
  assert.equal(result.repository.name, "acme/finance-skills");
  assert.equal(result.repository.webUrl, "https://github.com/acme/finance-skills");
  assert.equal(result.repository.branch, "main");
  assert.equal(result.repository.skills, 0);
  assert.match(result.repository.lastSync, /^(just now|soon)$/);
  assert.equal(result.repository.status, "ok");
  assert.deepEqual(result.repository.providerReadiness, getRepositoryProviderReadiness("github"));
  assert.deepEqual(result.repository.projection, {
    indexedAt: null,
    lastSuccessfulSyncAt: null,
    lastWebhookAt: null,
  });
});

test("connectTenantRepository rejects unsupported webhook sync for providers without webhook support", async () => {
  let called = false;
  const persistence: RepositoryConnectPersistence = {
    persistConnection: async () => {
      called = true;
      throw new Error("should not be called");
    },
  };
  const locator = parseRepositoryLocator({
    provider: "selfhosted",
    repoUrl: "https://git.example.com/acme/finance-skills",
  });

  assert.ok(locator);

  await assert.rejects(
    () => connectTenantRepository(
      {
        context: createTenantContext(),
        request: {
          provider: "selfhosted",
          repoUrl: "https://git.example.com/acme/finance-skills",
          defaultBranch: "main",
          displayName: "Finance Skills",
          syncMode: "webhook",
          observedPaths: ["registry/skills.yaml"],
        },
        validation: createReadyValidation(),
        locator,
      },
      {
        persistence,
        writeAccessStore: createWriteAccessStore(),
        resolveConnectionBinding: createNullConnectionBindingResolver(),
      },
    ),
    (error) => {
      assert.ok(error instanceof RepositoryConnectError);
      assert.equal(error.code, "repository_sync_mode_unsupported");
      assert.equal(error.status, 409);
      return true;
    },
  );

  assert.equal(called, false);
});

test("connectTenantRepository fails closed when contract validation is not ready", async () => {
  let called = false;
  const persistence: RepositoryConnectPersistence = {
    persistConnection: async () => {
      called = true;
      throw new Error("should not be called");
    },
  };
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "https://github.com/acme/finance-skills",
  });

  assert.ok(locator);

  await assert.rejects(
    () => connectTenantRepository(
      {
        context: createTenantContext(),
        request: createGitHubRequest(),
        validation: createReadyValidation({
          ready: false,
          nextSteps: ["Add missing registry files before connecting this repository."],
          summary: {
            observedPathCount: 5,
            discoveredSkillPackageCount: 0,
            missingTopLevelDirectoryCount: 1,
            missingRegistryFileCount: 2,
          },
        }),
        locator,
        metadata: createGitHubMetadata(),
      },
      {
        persistence,
        writeAccessStore: createWriteAccessStore(),
        resolveConnectionBinding: createNullConnectionBindingResolver(),
      },
    ),
    (error) => {
      assert.ok(error instanceof RepositoryConnectError);
      assert.equal(error.code, "repository_contract_not_ready");
      assert.equal(error.status, 409);
      assert.match(error.details ?? "", /missing registry files/i);
      return true;
    },
  );

  assert.equal(called, false);
});

test("connectTenantRepository persists a resolved provider connection binding when one is selected", async () => {
  const persistenceCalls: RepositoryConnectPersistenceInput[] = [];
  const persistence: RepositoryConnectPersistence = {
    persistConnection: async (input) => {
      persistenceCalls.push(input);

      return {
        created: true,
        repository: {
          id: "repo_456",
          providerType: "github",
          ownerName: "acme",
          repoName: "finance-skills",
          canonicalCloneUrl: "https://github.com/acme/finance-skills",
          defaultBranch: "main",
          repositoryStatus: "connected",
          updatedAt: "2026-05-22T10:00:00.000Z",
        },
        syncState: {
          syncMode: "manual",
          status: "idle",
          lastIndexedAt: null,
          lastSuccessfulSyncAt: null,
          lastWebhookAt: null,
        },
      };
    },
  };
  const locator = parseRepositoryLocator({
    provider: "github",
    repoUrl: "github.com/acme/finance-skills",
  });

  assert.ok(locator);

  await connectTenantRepository(
    {
      context: createTenantContext(),
      request: {
        ...createGitHubRequest(),
        connectionId: "conn_456",
        syncMode: "manual",
      },
      validation: createReadyValidation(),
      locator,
      metadata: createGitHubMetadata(),
      now: new Date("2026-05-22T10:00:00.000Z"),
    },
    {
      persistence,
      writeAccessStore: createWriteAccessStore(),
      resolveConnectionBinding: async (input) => {
        assert.equal(input.organizationId, "org_123");
        assert.equal(input.provider, "github");
        assert.equal(input.requestedConnectionId, "conn_456");
        return "conn_456";
      },
    },
  );

  assert.equal(persistenceCalls[0]?.connectionId, "conn_456");
  assert.equal(persistenceCalls[0]?.syncMode, "manual");
});
