import assert from "node:assert/strict";
import test from "node:test";

import { GitProviderError } from "./errors.ts";
import { createFakeGitProvider, makeRepository, SAMPLE_TOKENS, VALID_SKILL_FILES } from "./testing/fixtures.ts";
import { createGitTestHarness, ORG_A, ORG_B } from "./testing/harness.ts";

async function authorize(harness: ReturnType<typeof createGitTestHarness>, provider: "gitlab" | "github", organizationId = ORG_A) {
  const actor = harness.actor(organizationId);
  const url = new URL(await harness.connections.startAuthorization(actor, { provider, workspaceSlug: "acme" }));
  const query = new URLSearchParams({ state: url.searchParams.get("state") ?? "" });
  if (provider === "gitlab") {
    query.set("code", SAMPLE_TOKENS.authorizationCode);
  } else {
    query.set("installation_id", "777");
    query.set("setup_action", "install");
  }
  return { actor, url, query };
}

test("callback binds the organization from state, never from query parameters", async () => {
  const { provider } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });
  const { actor, query } = await authorize(harness, "gitlab");
  // An attacker-supplied tenant hint in the callback is ignored.
  query.set("organization_id", ORG_B);
  query.set("workspaceSlug", "victim");

  const completed = await harness.connections.completeAuthorization({ provider: "gitlab", query, userSubject: actor.subject });

  assert.equal(completed.organizationId, ORG_A);
  assert.equal(harness.state.connections.length, 1);
  assert.equal(harness.state.connections[0]?.organizationId, ORG_A);
  assert.equal(completed.returnPath, "/o/acme/settings?section=source-control");
  assert.equal((await harness.stores.connections.listConnections(ORG_B)).length, 0);
});

test("authorization uses PKCE and single-use state; the stored credential is encrypted and never returned", async () => {
  const { provider } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });
  const { actor, url, query } = await authorize(harness, "gitlab");
  assert.ok(url.searchParams.get("code_challenge"));

  const completed = await harness.connections.completeAuthorization({ provider: "gitlab", query, userSubject: actor.subject });
  const secret = harness.state.secrets[0];
  assert.ok(secret);
  assert.ok(!secret.encryptedPayload.includes(SAMPLE_TOKENS.valid));
  assert.ok(!secret.encryptedPayload.includes(SAMPLE_TOKENS.refresh));

  const listed = await harness.connections.listConnections(actor);
  const serialized = JSON.stringify({ completed, listed });
  for (const token of [SAMPLE_TOKENS.valid, SAMPLE_TOKENS.refresh, secret.encryptedPayload]) {
    assert.ok(!serialized.includes(token));
  }
  assert.equal(listed[0]?.credentialStored, true);

  // Replaying the same callback fails: state is single use.
  await assert.rejects(
    () => harness.connections.completeAuthorization({ provider: "gitlab", query, userSubject: actor.subject }),
    (error: unknown) => error instanceof GitProviderError && error.code === "AUTHORIZATION_STATE_INVALID",
  );
});

test("a callback completed by a different Savant user is rejected", async () => {
  const { provider } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });
  const { query } = await authorize(harness, "gitlab");

  await assert.rejects(
    () => harness.connections.completeAuthorization({ provider: "gitlab", query, userSubject: "auth0|someone-else" }),
    (error: unknown) => error instanceof GitProviderError && error.code === "AUTHORIZATION_STATE_INVALID",
  );
  assert.equal(harness.state.connections.length, 0);
});

test("members cannot connect providers; admins and repository managers have scoped rights", async () => {
  const { provider } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });

  await assert.rejects(
    () => harness.connections.startAuthorization(harness.actor(ORG_A, "member", "auth0|member"), { provider: "gitlab" }),
    (error: unknown) => error instanceof GitProviderError && error.code === "PERMISSION_DENIED",
  );
  await assert.rejects(
    () => harness.connections.startAuthorization(harness.actor(ORG_A, "repository_manager", "auth0|mgr"), { provider: "gitlab" }),
    (error: unknown) => error instanceof GitProviderError && error.code === "PERMISSION_DENIED",
  );
  assert.equal((await harness.connections.listConnections(harness.actor(ORG_A, "member", "auth0|member"))).length, 0);
});

test("callback re-checks that the user still holds the admin role in the state's organization", async () => {
  const { provider } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });
  const { actor, query } = await authorize(harness, "gitlab");

  await assert.rejects(
    () => harness.connections.completeAuthorization({
      provider: "gitlab",
      query,
      userSubject: actor.subject,
      verifyActor: async (organizationId, subject) => ({ organizationId, subject, role: "member" }),
    }),
    (error: unknown) => error instanceof GitProviderError && error.code === "PERMISSION_DENIED",
  );
});

test("multiple connections to the same provider are supported and re-authorizing the same account updates it", async () => {
  const { provider, controls } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });

  const first = await authorize(harness, "gitlab");
  await harness.connections.completeAuthorization({ provider: "gitlab", query: first.query, userSubject: first.actor.subject });
  const again = await authorize(harness, "gitlab");
  const repeat = await harness.connections.completeAuthorization({ provider: "gitlab", query: again.query, userSubject: again.actor.subject });
  assert.equal(repeat.created, false);
  assert.equal(harness.state.connections.length, 1);

  controls.identity = { id: "9999", login: "second-account" };
  controls.authorization = { accountId: "9999", accountName: "second-account" };
  const second = await authorize(harness, "gitlab");
  const created = await harness.connections.completeAuthorization({ provider: "gitlab", query: second.query, userSubject: second.actor.subject });
  assert.equal(created.created, true);
  assert.equal(harness.state.connections.length, 2);
});

test("validation updates health without invalidating on transient provider errors", async () => {
  const { provider, controls } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });
  const actor = harness.actor(ORG_A);
  const connection = harness.seedConnection({ organizationId: ORG_A, provider: "gitlab", authType: "oauth" });
  harness.seedTokenSecret(connection, { accessToken: SAMPLE_TOKENS.valid });

  const healthy = await harness.connections.validateConnection(actor, connection.id);
  assert.equal(healthy.healthy, true);
  assert.ok(healthy.connection.lastValidatedAt);

  controls.injectedFailures.push("rate_limited");
  const limited = await harness.connections.validateConnection(actor, connection.id);
  assert.equal(limited.errorCode, "PROVIDER_RATE_LIMITED");
  assert.equal(limited.connection.status, "active");

  harness.state.secrets = [];
  harness.seedTokenSecret(connection, { accessToken: SAMPLE_TOKENS.revoked });
  const revoked = await harness.connections.validateConnection(actor, connection.id);
  assert.equal(revoked.errorCode, "TOKEN_REVOKED");
  assert.equal(revoked.connection.status, "revoked");
  assert.ok(harness.state.audit.some((event) => event.action === "git_provider_validation_failed"));
});

test("expired OAuth credentials refresh automatically and rotated refresh tokens are persisted encrypted", async () => {
  const { provider, controls } = createFakeGitProvider({
    type: "gitlab",
    repositories: [{ repository: makeRepository({ provider: "gitlab", id: "55", owner: "group", name: "skills", host: "gitlab.fixture" }), files: VALID_SKILL_FILES, readableBy: [SAMPLE_TOKENS.refreshed] }],
  });
  const harness = createGitTestHarness({ providers: [provider] });
  const connection = harness.seedConnection({ organizationId: ORG_A, provider: "gitlab", authType: "oauth" });
  harness.seedTokenSecret(connection, { accessToken: SAMPLE_TOKENS.expired, refreshToken: SAMPLE_TOKENS.refresh, expiresAt: new Date(Date.now() - 1000).toISOString() });

  const resolved = await harness.broker.resolve({ organizationId: ORG_A, connectionId: connection.id });
  assert.equal(resolved.credential.accessToken, SAMPLE_TOKENS.refreshed);
  assert.equal(controls.refreshCalls, 1);
  assert.ok(!harness.state.secrets[0]?.encryptedPayload.includes(SAMPLE_TOKENS.refreshed));

  // Subsequent resolution uses the stored refreshed token without refreshing again.
  await harness.broker.resolve({ organizationId: ORG_A, connectionId: connection.id });
  assert.equal(controls.refreshCalls, 1);
});

test("a revoked refresh grant marks the connection revoked instead of failing silently", async () => {
  const { provider } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });
  const connection = harness.seedConnection({ organizationId: ORG_A, provider: "gitlab", authType: "oauth" });
  harness.seedTokenSecret(connection, { accessToken: SAMPLE_TOKENS.expired, refreshToken: SAMPLE_TOKENS.revokedRefresh, expiresAt: new Date(Date.now() - 1000).toISOString() });

  await assert.rejects(() => harness.broker.resolve({ organizationId: ORG_A, connectionId: connection.id }), (error: unknown) => error instanceof GitProviderError && error.code === "TOKEN_REVOKED");
  assert.equal(harness.state.connections[0]?.status, "revoked");
});

test("disconnect revokes, deletes the credential, marks repositories auth_required and preserves indexed skills", async () => {
  const { provider, controls } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });
  const actor = harness.actor(ORG_A);
  const connection = harness.seedConnection({ organizationId: ORG_A, provider: "gitlab", authType: "oauth" });
  harness.seedTokenSecret(connection, { accessToken: SAMPLE_TOKENS.valid });
  const repository = harness.seedRepository({ organizationId: ORG_A, provider: "gitlab", owner: "group", name: "skills", providerConnectionId: connection.id }, { status: "ok", lastIndexedAt: "2026-09-01T00:00:00.000Z" });
  harness.state.indexedSkills.push({ repositoryId: repository.id, skillId: "legal/contract-review-assistant" });

  const result = await harness.connections.disconnectConnection(actor, connection.id);

  assert.equal(result.revokedRemotely, true);
  assert.equal(controls.revokeCalls, 1);
  assert.equal(result.repositoriesMarked, 1);
  assert.equal(harness.state.secrets.length, 0);
  assert.equal(harness.state.connections[0]?.status, "disconnected");
  assert.equal(harness.state.syncStates.get(repository.id)?.status, "auth_required");
  assert.equal(harness.state.repositories.length, 1);
  assert.equal(harness.state.indexedSkills.length, 1);
  assert.ok(harness.state.audit.some((event) => event.action === "git_provider_disconnected"));

  await assert.rejects(() => harness.broker.resolve({ organizationId: ORG_A, connectionId: connection.id }), (error: unknown) => error instanceof GitProviderError && error.code === "TOKEN_REVOKED");
});

test("manual token connections validate before saving and never store plaintext", async () => {
  const { provider } = createFakeGitProvider({ type: "gitlab" });
  const harness = createGitTestHarness({ providers: [provider] });
  const actor = harness.actor(ORG_A);

  await assert.rejects(() => harness.connections.connectManualToken(actor, { provider: "gitlab", token: SAMPLE_TOKENS.revoked }));
  assert.equal(harness.state.connections.length, 0);

  const result = await harness.connections.connectManualToken(actor, { provider: "gitlab", token: SAMPLE_TOKENS.valid });
  assert.equal(result.connection.authType, "pat");
  assert.ok(!JSON.stringify(result).includes(SAMPLE_TOKENS.valid));
  assert.ok(!JSON.stringify(harness.state.connections).includes(SAMPLE_TOKENS.valid));
  assert.ok(!JSON.stringify(harness.state.secrets).includes(SAMPLE_TOKENS.valid));
});

test("legacy env connections keep working through the broker and are flagged as legacy", async () => {
  const { provider } = createFakeGitProvider({ type: "github" });
  const env = { ...createGitTestHarness({ providers: [] }).env, GITHUB_WRITE_TOKEN: SAMPLE_TOKENS.valid };
  const harness = createGitTestHarness({ providers: [provider], env });
  const connection = harness.seedConnection({ organizationId: ORG_A, provider: "github", authType: "legacy_env", credentialsRef: "GITHUB_WRITE_TOKEN" });

  const resolved = await harness.broker.resolve({ organizationId: ORG_A, connectionId: connection.id });
  assert.equal(resolved.credential.accessToken, SAMPLE_TOKENS.valid);
  const [summary] = await harness.connections.listConnections(harness.actor(ORG_A));
  assert.equal(summary?.isLegacy, true);
  assert.ok(!JSON.stringify(summary).includes("GITHUB_WRITE_TOKEN"));
});
