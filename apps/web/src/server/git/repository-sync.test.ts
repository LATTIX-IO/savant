import assert from "node:assert/strict";
import test from "node:test";

import { GitProviderError } from "./errors.ts";
import { createFakeGitProvider, makeRepository, MALFORMED_SKILL_FILES, SAMPLE_TOKENS, VALID_SKILL_FILES } from "./testing/fixtures.ts";
import { createGitTestHarness, ORG_A } from "./testing/harness.ts";

const PRIVATE_REPO = makeRepository({ id: "901", owner: "LATTIX-IO", name: "lattix-skills" });

function setup(files: Record<string, string> = VALID_SKILL_FILES, extra?: { extraPaths?: string[] }) {
  const fake = createFakeGitProvider({
    type: "github",
    repositories: [{ repository: PRIVATE_REPO, files, readableBy: [SAMPLE_TOKENS.valid], ...(extra?.extraPaths ? { extraPaths: extra.extraPaths } : {}) }],
  });
  const harness = createGitTestHarness({ providers: [fake.provider] });
  const connection = harness.seedConnection({ organizationId: ORG_A, provider: "github", authType: "github_app_installation", providerInstallationId: "777" });
  return { ...fake, harness, connection };
}

test("connecting a private repository persists the explicit association and triggers the initial index", async () => {
  const { harness, connection } = setup();
  const actor = harness.actor(ORG_A);

  const result = await harness.repositories.connectSelectedRepositories(actor, {
    connectionId: connection.id,
    repositories: [{ providerRepositoryId: "901", fullName: "LATTIX-IO/lattix-skills" }],
  });

  assert.equal(result.failed.length, 0);
  const connected = result.connected[0];
  assert.equal(connected?.repository.syncState, "indexing");
  assert.equal(connected?.indexing.started, true);
  assert.equal(harness.state.associations[0]?.connectionId, connection.id);
  assert.equal(harness.state.repositories[0]?.providerConnectionId, connection.id);
  assert.equal(harness.state.repositories[0]?.providerRepositoryId, "901");

  // The job carries identifiers only.
  assert.deepEqual(Object.keys(harness.jobs[0] ?? {}).sort(), ["actorSubject", "connectionId", "organizationId", "repositoryId", "targetRevision", "trigger"]);
  assert.equal(harness.jobs[0]?.trigger, "initial");

  const [run] = await harness.drainJobs();
  assert.equal(run?.error, undefined);
  const sync = harness.state.syncStates.get(connected?.repository.id as string);
  assert.equal(sync?.status, "ok");
  assert.ok(sync?.lastIndexedAt, "indexedAt is set after a successful index");
  assert.equal(harness.state.indexedSkills.length, 1);
  assert.ok(harness.state.audit.some((event) => event.action === "repository_connected"));
  assert.ok(harness.state.audit.some((event) => event.action === "repository_index_succeeded"));
});

test("repository connection is idempotent on organization + provider + provider repository id", async () => {
  const { harness, connection } = setup();
  const actor = harness.actor(ORG_A);
  const request = { connectionId: connection.id, repositories: [{ providerRepositoryId: "901", fullName: "LATTIX-IO/lattix-skills" }, { providerRepositoryId: "901" }] };

  const first = await harness.repositories.connectSelectedRepositories(actor, request);
  const second = await harness.repositories.connectSelectedRepositories(actor, request);

  assert.equal(harness.state.repositories.length, 1);
  assert.equal(first.connected[0]?.repository.created, true);
  assert.equal(second.connected[0]?.repository.created, false);
  assert.equal(first.connected[0]?.repository.id, second.connected[0]?.repository.id);
});

test("a selection whose hints do not match the provider id is rejected", async () => {
  const { harness, connection, controls } = setup();
  controls.repositories.push({ repository: makeRepository({ id: "902", owner: "LATTIX-IO", name: "other" }), files: {}, readableBy: [SAMPLE_TOKENS.valid] });

  const result = await harness.repositories.connectSelectedRepositories(harness.actor(ORG_A), {
    connectionId: connection.id,
    repositories: [{ providerRepositoryId: "999", fullName: "LATTIX-IO/other" }],
  });
  assert.equal(result.connected.length, 0);
  assert.ok(result.failed[0]);
});

test("a failed index keeps the repository connected and does not erase the previous index", async () => {
  const { harness, connection, controls } = setup();
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerRepositoryId: "901", providerConnectionId: connection.id }, { status: "ok", lastIndexedAt: "2026-09-01T00:00:00.000Z" });
  harness.state.indexedSkills.push({ repositoryId: repository.id, skillId: "legal/contract-review-assistant" });

  controls.repositories[0]!.files = MALFORMED_SKILL_FILES;
  await assert.rejects(() => harness.sync(ORG_A, repository.id));
  assert.equal(harness.state.repositories.length, 1);
  assert.equal(harness.state.indexedSkills.length, 1, "prior index intact after validation failure");
  assert.equal(harness.state.syncStates.get(repository.id)?.lastIndexedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(harness.state.syncStates.get(repository.id)?.status, "error");

  // Transient provider failure: still intact, and the connection stays active.
  controls.repositories[0]!.files = VALID_SKILL_FILES;
  controls.injectedFailures.push("unavailable");
  await assert.rejects(() => harness.sync(ORG_A, repository.id), (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_UNAVAILABLE");
  assert.equal(harness.state.indexedSkills.length, 1);
  assert.equal(harness.state.connections[0]?.status, "active");

  // Rate limiting does not mark authorization invalid either.
  controls.injectedFailures.push("rate_limited");
  await assert.rejects(() => harness.sync(ORG_A, repository.id), (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_RATE_LIMITED");
  assert.equal(harness.state.connections[0]?.status, "active");
  assert.equal(harness.state.syncStates.get(repository.id)?.status, "error");

  await harness.sync(ORG_A, repository.id);
  assert.equal(harness.state.syncStates.get(repository.id)?.status, "ok");
});

test("losing repository access yields auth_required with remediation, not repository absence", async () => {
  const { harness, connection, controls } = setup();
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerRepositoryId: "901", providerConnectionId: connection.id });
  controls.repositories[0]!.readableBy = [];

  await assert.rejects(() => harness.sync(ORG_A, repository.id), (error: unknown) => error instanceof GitProviderError && error.code === "REPOSITORY_ACCESS_DENIED");
  const sync = harness.state.syncStates.get(repository.id);
  assert.equal(sync?.status, "auth_required");
  assert.match(sync?.errorMessage ?? "", /Repository connected, but Savant could not read it/);
  assert.match(sync?.errorMessage ?? "", /grant the Savant GitHub App access to this repository/);

  const status = await harness.repositories.getSyncStatus(harness.actor(ORG_A), repository.id);
  assert.equal(status.syncState, "auth_required");
  assert.match(status.remediation ?? "", /Reauthorize GitHub/);
  assert.ok(harness.state.audit.some((event) => event.action === "repository_access_failed"));
});

test("a revoked installation marks the repository access_revoked and the connection revoked", async () => {
  const { harness, connection } = setup();
  connection.providerInstallationId = "revoked-installation";
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerRepositoryId: "901", providerConnectionId: connection.id });

  await assert.rejects(() => harness.sync(ORG_A, repository.id));
  assert.equal(harness.state.syncStates.get(repository.id)?.status, "access_revoked");
  assert.equal(harness.state.repositories.length, 1);
});

test("explicit connection takes precedence over other compatible connections", async () => {
  const { harness, connection } = setup();
  const other = harness.seedConnection({ organizationId: ORG_A, provider: "github", authType: "pat" });
  harness.seedTokenSecret(other, { accessToken: SAMPLE_TOKENS.otherTenant });
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerConnectionId: connection.id, providerRepositoryId: "901" });

  const result = await harness.sync(ORG_A, repository.id);
  assert.equal(result.connectionId, connection.id);
});

test("legacy unique-connection fallback works and makes the association explicit", async () => {
  const { harness, connection } = setup();
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills" });

  const result = await harness.sync(ORG_A, repository.id);
  assert.equal(result.connectionId, connection.id);
  assert.equal(harness.state.repositories[0]?.providerConnectionId, connection.id);
  assert.equal(harness.state.associations[0]?.providerRepositoryId, "901");
});

test("multiple candidate connections produce CONNECTION_AMBIGUOUS instead of picking one", async () => {
  const { harness } = setup();
  const second = harness.seedConnection({ organizationId: ORG_A, provider: "github", authType: "pat" });
  harness.seedTokenSecret(second, { accessToken: SAMPLE_TOKENS.valid });
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills" });

  await assert.rejects(() => harness.sync(ORG_A, repository.id), (error: unknown) => error instanceof GitProviderError && error.code === "CONNECTION_AMBIGUOUS");
  assert.equal(harness.state.syncStates.get(repository.id)?.status, "auth_required");

  // Choosing a connection resolves the ambiguity.
  await harness.connections.assignRepositoryConnection(harness.actor(ORG_A), repository.id, second.id);
  const result = await harness.sync(ORG_A, repository.id);
  assert.equal(result.connectionId, second.id);
});

test("private repositories are never read anonymously; public ones may be when no connection exists", async () => {
  const fake = createFakeGitProvider({ type: "github" });
  const harness = createGitTestHarness({ providers: [fake.provider] });
  let anonymousReads = 0;
  const readAnonymousSnapshot = async () => {
    anonymousReads += 1;
    return { metadata: { externalId: "1", defaultBranch: "main", displayName: "o/r", visibility: "public" as const }, defaultBranch: "main", commitSha: "a".repeat(40), observedPaths: Object.keys(VALID_SKILL_FILES), files: VALID_SKILL_FILES };
  };

  const privateRepo = harness.seedRepository({ organizationId: ORG_A, owner: "o", name: "private" });
  await assert.rejects(() => harness.sync(ORG_A, privateRepo.id, "manual", { readAnonymousSnapshot }), (error: unknown) => error instanceof GitProviderError && error.code === "CONNECTION_REQUIRED");
  assert.equal(anonymousReads, 0);
  const stored = harness.state.syncStates.get(privateRepo.id)?.errorMessage ?? "";
  assert.equal(stored.split("Settings → Source control").length - 1, 1, "remediation is not repeated");

  const publicRepo = harness.seedRepository({ organizationId: ORG_A, owner: "o", name: "public", visibility: "public" });
  await harness.sync(ORG_A, publicRepo.id, "manual", { readAnonymousSnapshot });
  assert.equal(anonymousReads, 1);

  // Once a connection exists, even a public repository uses it.
  const connection = harness.seedConnection({ organizationId: ORG_A, provider: "github", authType: "github_app_installation", providerInstallationId: "777" });
  fake.controls.repositories.push({ repository: makeRepository({ id: "5", owner: "o", name: "public", isPrivate: false }), files: VALID_SKILL_FILES, readableBy: [SAMPLE_TOKENS.valid] });
  const result = await harness.sync(ORG_A, publicRepo.id, "manual", { readAnonymousSnapshot });
  assert.equal(result.connectionId, connection.id);
  assert.equal(anonymousReads, 1);
});

test("concurrent syncs for the same repository return SYNC_ALREADY_RUNNING", async () => {
  const { harness, connection } = setup();
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerConnectionId: connection.id });
  const claimed = await harness.stores.repositories.claimSync(ORG_A, repository.id, { now: new Date().toISOString(), staleAfterMs: 600_000, targetRevision: null });
  assert.equal(claimed, true);

  await assert.rejects(() => harness.sync(ORG_A, repository.id), (error: unknown) => error instanceof GitProviderError && error.code === "SYNC_ALREADY_RUNNING");

  // A stale claim (crashed worker) is taken over.
  harness.state.syncStates.get(repository.id)!.syncStartedAt = new Date(Date.now() - 3_600_000).toISOString();
  await harness.sync(ORG_A, repository.id);
});

test("repositories containing no skills index successfully with zero skills", async () => {
  const { harness, connection } = setup({ "README.md": "# empty\n" });
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerConnectionId: connection.id });
  const result = await harness.sync(ORG_A, repository.id);
  assert.equal(result.skillCount, 0);
  assert.ok(harness.state.syncStates.get(repository.id)?.lastIndexedAt);
});

test("large repositories are bounded by configurable limits", async () => {
  const extraPaths = Array.from({ length: 60 }, (_, index) => `bulk/file-${index}.txt`);
  const { harness, connection } = setup(VALID_SKILL_FILES, { extraPaths });
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerConnectionId: connection.id });

  const { syncRepository } = await import("./repository-sync-service.ts");
  await assert.rejects(
    () => syncRepository({
      connections: harness.stores.connections,
      repositories: harness.stores.repositories,
      broker: harness.broker,
      audit: harness.stores.audit,
      writer: harness.writer,
      limits: { maxTreeEntries: 20, maxFileBytes: 1024, maxTotalBytes: 4096, maxSkillCount: 10, maxDepth: 12, readConcurrency: 4 },
    }, { organizationId: ORG_A, repositoryId: repository.id, actor: { type: "system", ref: "test" }, trigger: "manual" }),
    (error: unknown) => error instanceof GitProviderError && error.code === "INDEX_FAILED",
  );
  assert.equal(harness.state.syncStates.get(repository.id)?.status, "error");
});

test("removing a repository removes its skills but keeps the provider connection", async () => {
  const { harness, connection } = setup();
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerConnectionId: connection.id });
  harness.state.indexedSkills.push({ repositoryId: repository.id, skillId: "a" });

  const removed = await harness.repositories.removeRepository(harness.actor(ORG_A, "repository_manager", "auth0|mgr"), repository.id);
  assert.equal(removed.removedSkillCount, 1);
  assert.equal(harness.state.repositories.length, 0);
  assert.equal(harness.state.indexedSkills.length, 0);
  assert.equal(harness.state.connections[0]?.status, "active");
  assert.ok(harness.state.audit.some((event) => event.action === "repository_disconnected"));
});
