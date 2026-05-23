import assert from "node:assert/strict";
import test from "node:test";

import type { ResolvedTenantContext } from "./tenant-context.ts";
import {
  assertTenantWriteAccess,
  TenantWriteAccessError,
  type TenantWriteAccessStore,
} from "./tenant-write-access.ts";

function createTenantContext(overrides?: Partial<ResolvedTenantContext>): ResolvedTenantContext {
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
    ...overrides,
  };
}

function createWriteAccessStore(row: {
  userId: string;
  isFirstMember: boolean;
  groups: string[] | null;
} | null): TenantWriteAccessStore {
  return {
    resolveAccess: async () => row,
  };
}

test("assertTenantWriteAccess allows the first workspace member", async () => {
  const decision = await assertTenantWriteAccess(
    {
      context: createTenantContext(),
      operation: "provision repositories",
    },
    {
      store: createWriteAccessStore({
        userId: "user_123",
        isFirstMember: true,
        groups: [],
      }),
    },
  );

  assert.deepEqual(decision, {
    userId: "user_123",
    role: "Owner",
    reason: "first_member",
  });
});

test("assertTenantWriteAccess allows members of platform-admins", async () => {
  const decision = await assertTenantWriteAccess(
    {
      context: createTenantContext(),
      operation: "commit skill scaffolds",
    },
    {
      store: createWriteAccessStore({
        userId: "user_456",
        isFirstMember: false,
        groups: ["platform-admins", "all-employees"],
      }),
    },
  );

  assert.deepEqual(decision, {
    userId: "user_456",
    role: "Admin",
    reason: "platform_admin",
  });
});

test("assertTenantWriteAccess rejects ordinary members", async () => {
  await assert.rejects(
    () => assertTenantWriteAccess(
      {
        context: createTenantContext(),
        operation: "request repository sync",
      },
      {
        store: createWriteAccessStore({
          userId: "user_789",
          isFirstMember: false,
          groups: ["all-employees"],
        }),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof TenantWriteAccessError);
      assert.equal(error.code, "tenant_write_access_denied");
      assert.equal(error.status, 403);
      return true;
    },
  );
});

test("assertTenantWriteAccess allows development fallback without store access", async () => {
  let called = false;
  const store: TenantWriteAccessStore = {
    resolveAccess: async () => {
      called = true;
      return null;
    },
  };

  const decision = await assertTenantWriteAccess(
    {
      context: createTenantContext({ isDevelopmentFallback: true }),
      operation: "connect or update repositories",
    },
    { store },
  );

  assert.equal(called, false);
  assert.deepEqual(decision, {
    userId: null,
    role: "Development",
    reason: "development_fallback",
  });
});