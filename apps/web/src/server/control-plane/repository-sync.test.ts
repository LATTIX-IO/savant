import assert from "node:assert/strict";
import test from "node:test";

import { getRepositoryProviderReadiness } from "@savant/types";
import type {
  RepoSyncRequest,
} from "@savant/types";

import {
  requestTenantRepositorySync,
  RepositorySyncError,
  type RepositorySyncPersistence,
  type RepositorySyncPersistenceInput,
} from "./repository-sync.ts";
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

function createSyncRequest(reason: RepoSyncRequest["reason"] = "manual"): RepoSyncRequest {
  return { reason };
}

function createWriteAccessStore(): TenantWriteAccessStore {
  return {
    resolveAccess: async () => ({
      userId: "user_123",
      isFirstMember: true,
      groups: ["platform-admins"],
    }),
  };
}

test("requestTenantRepositorySync records a repository sync request and returns the repository projection", async () => {
  const persistenceCalls: RepositorySyncPersistenceInput[] = [];
  const persistence: RepositorySyncPersistence = {
    requestSync: async (input) => {
      persistenceCalls.push(input);

      return {
        accepted: true,
        message: "Repository sync requested.",
        requestedAt: input.requestedAt,
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
          nextPollAt: "2026-05-22T10:00:00.000Z",
        },
      };
    },
  };

  const result = await requestTenantRepositorySync(
    {
      context: createTenantContext(),
      repositoryId: "repo_123",
      request: createSyncRequest(),
      now: new Date("2026-05-22T10:00:00.000Z"),
    },
    {
      persistence,
      writeAccessStore: createWriteAccessStore(),
    },
  );

  assert.equal(persistenceCalls.length, 1);
  assert.deepEqual(persistenceCalls[0], {
    organizationId: "org_123",
    actorSubject: "auth0|user_123",
    repositoryId: "repo_123",
    reason: "manual",
    requestedAt: new Date("2026-05-22T10:00:00.000Z"),
  });

  assert.equal(result.accepted, true);
  assert.equal(result.repository.id, "repo_123");
  assert.equal(result.repository.provider, "github");
  assert.equal(result.repository.name, "acme/finance-skills");
  assert.equal(result.repository.webUrl, "https://github.com/acme/finance-skills");
  assert.equal(result.repository.status, "ok");
  assert.deepEqual(result.repository.providerReadiness, getRepositoryProviderReadiness("github"));
  assert.equal(result.syncMode, "poll");
  assert.equal(result.requestedAt, "2026-05-22T10:00:00.000Z");
  assert.equal(result.nextPollAt, "2026-05-22T10:00:00.000Z");
  assert.equal(result.indexedSkillCount, 0);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.message, "Repository sync requested.");
});

test("requestTenantRepositorySync returns the in-progress state when sync is already running", async () => {
  const persistence: RepositorySyncPersistence = {
    requestSync: async (input) => ({
      accepted: false,
      message: "A sync is already in progress for this repository.",
      requestedAt: input.requestedAt,
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
        status: "indexing",
        lastIndexedAt: null,
        lastSuccessfulSyncAt: null,
        lastWebhookAt: null,
        nextPollAt: "2026-05-22T10:00:00.000Z",
      },
    }),
  };

  const result = await requestTenantRepositorySync(
    {
      context: createTenantContext(),
      repositoryId: "repo_123",
      request: createSyncRequest("initial_connect"),
      now: new Date("2026-05-22T10:00:00.000Z"),
    },
    {
      persistence,
      writeAccessStore: createWriteAccessStore(),
    },
  );

  assert.equal(result.accepted, false);
  assert.equal(result.repository.status, "warn");
  assert.equal(result.indexedSkillCount, 0);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.message, "A sync is already in progress for this repository.");
});

test("requestTenantRepositorySync fails closed when the user is not authenticated", async () => {
  const persistence: RepositorySyncPersistence = {
    requestSync: async () => {
      throw new Error("should not be called");
    },
  };

  await assert.rejects(
    () => requestTenantRepositorySync(
      {
        context: {
          ...createTenantContext(),
          identity: null,
        },
        repositoryId: "repo_123",
        request: createSyncRequest(),
      },
      { persistence },
    ),
    (error) => {
      assert.ok(error instanceof RepositorySyncError);
      assert.equal(error.code, "auth_required");
      assert.equal(error.status, 401);
      return true;
    },
  );
});