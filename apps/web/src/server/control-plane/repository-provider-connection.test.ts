import assert from "node:assert/strict";
import test from "node:test";

import {
  RepositoryProviderConnectionError,
  resolveRepositoryProviderAccessToken,
  resolveRepositoryProviderConnection,
  resolveRepositoryProviderSecretFromRef,
  type RepositoryProviderConnectionRecord,
  type RepositoryProviderConnectionStore,
} from "./repository-provider-connection.ts";

function createConnectionStore(
  connections: RepositoryProviderConnectionRecord[],
): RepositoryProviderConnectionStore {
  return {
    listConnections: async () => connections,
  };
}

const availableCredentialValue = "github-write-value-for-tests";

function createConnection(id: string, status: RepositoryProviderConnectionRecord["status"] = "active"): RepositoryProviderConnectionRecord {
  return {
    id,
    providerType: "github",
    displayName: `GitHub ${id}`,
    installationRef: null,
    credentialsRef: "GITHUB_WRITE_TOKEN",
    status,
    createdAt: "2026-05-22T10:00:00.000Z",
  };
}

test("resolveRepositoryProviderConnection returns the explicitly requested active connection", async () => {
  const connection = await resolveRepositoryProviderConnection(
    {
      organizationId: "org_123",
      provider: "github",
      connectionId: "conn_2",
    },
    {
      store: createConnectionStore([
        createConnection("conn_1"),
        createConnection("conn_2"),
      ]),
    },
  );

  assert.equal(connection.id, "conn_2");
});

test("resolveRepositoryProviderConnection rejects ambiguous active connections without an explicit selection", async () => {
  await assert.rejects(
    () => resolveRepositoryProviderConnection(
      {
        organizationId: "org_123",
        provider: "github",
      },
      {
        store: createConnectionStore([
          createConnection("conn_1"),
          createConnection("conn_2"),
        ]),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryProviderConnectionError);
      assert.equal(error.code, "repository_provider_connection_ambiguous");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("resolveRepositoryProviderSecretFromRef rejects invalid secret references", () => {
  assert.throws(
    () => resolveRepositoryProviderSecretFromRef("github-token", {
      GITHUB_WRITE_TOKEN: availableCredentialValue,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryProviderConnectionError);
      assert.equal(error.code, "repository_provider_secret_ref_invalid");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("resolveRepositoryProviderAccessToken fails closed when the referenced env var is a placeholder", () => {
  assert.throws(
    () => resolveRepositoryProviderAccessToken(
      { credentialsRef: "GITHUB_WRITE_TOKEN" },
      { GITHUB_WRITE_TOKEN: "<GITHUB_WRITE_TOKEN>" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryProviderConnectionError);
      assert.equal(error.code, "repository_provider_secret_unavailable");
      assert.equal(error.status, 503);
      return true;
    },
  );
});