import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import { GitProviderError } from "./errors.ts";
import { ALL_SAMPLE_SECRETS, createFakeGitProvider, makeRepository, SAMPLE_TOKENS, VALID_SKILL_FILES } from "./testing/fixtures.ts";
import { createGitTestHarness, ORG_A, ORG_B } from "./testing/harness.ts";

function twoTenants() {
  const fake = createFakeGitProvider({
    type: "gitlab",
    repositories: [
      { repository: makeRepository({ provider: "gitlab", id: "a-1", owner: "acme", name: "skills", host: "gitlab.fixture" }), files: VALID_SKILL_FILES, readableBy: [SAMPLE_TOKENS.valid] },
      { repository: makeRepository({ provider: "gitlab", id: "b-1", owner: "beta", name: "secret-skills", host: "gitlab.fixture" }), files: VALID_SKILL_FILES, readableBy: [SAMPLE_TOKENS.otherTenant] },
    ],
  });
  const harness = createGitTestHarness({ providers: [fake.provider] });
  const connectionA = harness.seedConnection({ organizationId: ORG_A, provider: "gitlab", authType: "oauth" });
  harness.seedTokenSecret(connectionA, { accessToken: SAMPLE_TOKENS.valid });
  const connectionB = harness.seedConnection({ organizationId: ORG_B, provider: "gitlab", authType: "oauth" });
  harness.seedTokenSecret(connectionB, { accessToken: SAMPLE_TOKENS.otherTenant });
  const repoB = harness.seedRepository({ organizationId: ORG_B, provider: "gitlab", owner: "beta", name: "secret-skills", providerConnectionId: connectionB.id, providerRepositoryId: "b-1" });
  return { ...fake, harness, connectionA, connectionB, repoB, adminA: harness.actor(ORG_A), adminB: harness.actor(ORG_B) };
}

const isNotFound = (error: unknown) =>
  error instanceof GitProviderError && (error.code === "CONNECTION_NOT_FOUND" || error.code === "REPOSITORY_NOT_FOUND");

test("tenant isolation: organization A cannot list organization B's connections", async () => {
  const { harness, adminA, connectionB } = twoTenants();
  const listed = await harness.connections.listConnections(adminA);
  assert.ok(listed.every((connection) => connection.id !== connectionB.id));
  await assert.rejects(() => harness.connections.getConnection(adminA, connectionB.id), isNotFound);
});

test("tenant isolation: organization A cannot list organization B's repositories through B's connection", async () => {
  const { harness, adminA, connectionB } = twoTenants();
  await assert.rejects(() => harness.connections.listDiscoveredRepositories(adminA, connectionB.id, {}), isNotFound);
});

test("tenant isolation: organization A cannot resolve organization B's credentials", async () => {
  const { harness, connectionB } = twoTenants();
  await assert.rejects(() => harness.broker.resolve({ organizationId: ORG_A, connectionId: connectionB.id }), isNotFound);
});

test("tenant isolation: organization A cannot sync, inspect, reassign or remove organization B's repository", async () => {
  const { harness, adminA, repoB, connectionA } = twoTenants();
  await assert.rejects(() => harness.sync(ORG_A, repoB.id), isNotFound);
  await assert.rejects(() => harness.repositories.getSyncStatus(adminA, repoB.id), isNotFound);
  await assert.rejects(() => harness.repositories.removeRepository(adminA, repoB.id), isNotFound);
  await assert.rejects(() => harness.connections.assignRepositoryConnection(adminA, repoB.id, connectionA.id), isNotFound);
  assert.equal(harness.state.repositories.length, 1);
});

test("tenant isolation: organization A cannot connect repositories through, validate, or disconnect B's provider", async () => {
  const { harness, adminA, connectionB } = twoTenants();
  await assert.rejects(() => harness.repositories.connectSelectedRepositories(adminA, { connectionId: connectionB.id, repositories: [{ providerRepositoryId: "b-1" }] }), isNotFound);
  await assert.rejects(() => harness.connections.validateConnection(adminA, connectionB.id), isNotFound);
  await assert.rejects(() => harness.connections.disconnectConnection(adminA, connectionB.id), isNotFound);
  assert.equal(harness.state.connections.find((connection) => connection.id === connectionB.id)?.status, "active");
  assert.equal(harness.state.secrets.length, 2);
});

test("tenant isolation: a repository cannot be bound to another tenant's connection", async () => {
  const { harness, connectionB } = twoTenants();
  const repoA = harness.seedRepository({ organizationId: ORG_A, provider: "gitlab", owner: "acme", name: "skills" });
  await assert.rejects(() => harness.stores.repositories.bindRepository(ORG_A, repoA.id, connectionB.id, "a-1"));
  // Even a forged association pointing at B's connection does not resolve inside A.
  harness.state.associations.push({ organizationId: ORG_A, repositoryId: repoA.id, connectionId: connectionB.id, providerRepositoryId: "a-1" });
  await assert.rejects(() => harness.sync(ORG_A, repoA.id), isNotFound);
});

test("credential leakage: no token fixture appears in API results, logs, audit events, errors, or job payloads", async () => {
  const captured: string[] = [];
  const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      captured.push(args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 8 }))).join(" "));
    };
  }
  process.env.GIT_INTEGRATION_DEBUG_LOGS = "true";

  try {
    const { harness, adminA, connectionA, controls } = twoTenants();
    const apiResults: unknown[] = [];
    const errors: unknown[] = [];

    apiResults.push(await harness.connections.listConnections(adminA));
    apiResults.push(await harness.connections.getConnection(adminA, connectionA.id));
    apiResults.push(await harness.connections.listDiscoveredRepositories(adminA, connectionA.id, {}));
    apiResults.push(await harness.connections.validateConnection(adminA, connectionA.id));
    apiResults.push(await harness.repositories.connectSelectedRepositories(adminA, { connectionId: connectionA.id, repositories: [{ providerRepositoryId: "a-1", fullName: "acme/skills" }] }));
    apiResults.push(await harness.connections.connectManualToken(adminA, { provider: "gitlab", token: SAMPLE_TOKENS.valid, displayName: "manual" }));
    const jobs = [...harness.jobs];
    await harness.drainJobs();
    apiResults.push(await harness.repositories.getSyncStatus(adminA, harness.state.repositories.find((repo) => repo.organizationId === ORG_A)!.id));

    // Failure paths: revoked credential, auth failure during sync, bad manual token.
    controls.repositories[0]!.readableBy = [];
    const repoA = harness.state.repositories.find((repo) => repo.organizationId === ORG_A)!;
    await harness.sync(ORG_A, repoA.id).catch((error: unknown) => errors.push(error));
    await harness.connections.connectManualToken(adminA, { provider: "gitlab", token: SAMPLE_TOKENS.revoked }).catch((error: unknown) => errors.push(error));
    harness.state.secrets = harness.state.secrets.filter((secret) => secret.connectionId !== connectionA.id);
    harness.seedTokenSecret(connectionA, { accessToken: SAMPLE_TOKENS.expired, refreshToken: SAMPLE_TOKENS.revokedRefresh, expiresAt: new Date(0).toISOString() });
    await harness.broker.resolve({ organizationId: ORG_A, connectionId: connectionA.id }).catch((error: unknown) => errors.push(error));
    apiResults.push(await harness.connections.disconnectConnection(adminA, connectionA.id));

    assert.ok(errors.length >= 3);
    const haystacks: Record<string, string> = {
      api: JSON.stringify(apiResults),
      logs: captured.join("\n"),
      audit: JSON.stringify(harness.state.audit),
      errors: errors.map((error) => `${JSON.stringify(error)} ${inspect(error)} ${String(error)}`).join("\n"),
      jobs: JSON.stringify(jobs),
      connections: JSON.stringify(harness.state.connections),
      repositories: JSON.stringify(harness.state.repositories),
    };

    for (const [name, haystack] of Object.entries(haystacks)) {
      for (const secret of ALL_SAMPLE_SECRETS) {
        assert.ok(!haystack.includes(secret), `${name} leaked a credential fixture (${secret.slice(0, 14)}…)`);
      }
    }
  } finally {
    Object.assign(console, originals);
    delete process.env.GIT_INTEGRATION_DEBUG_LOGS;
  }
});
