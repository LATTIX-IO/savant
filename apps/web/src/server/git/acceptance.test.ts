import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { clearGitHubInstallationTokenCache, createGitHubProvider } from "./providers/github.ts";
import { SAMPLE_TOKENS, VALID_SKILL_FILES } from "./testing/fixtures.ts";
import { createGitTestHarness, createTestEnv, ORG_A } from "./testing/harness.ts";
import type { FetchLike } from "./types.ts";

/**
 * Spec §43 acceptance scenario: the existing private LATTIX-IO/lattix-skills
 * repository (indexedAt NULL, 0 skills) recovers after the Savant GitHub App is
 * authorized — no GITHUB_WRITE_TOKEN, no hand-written SQL, no reconnection.
 */

const INSTALLATION_ID = "777";
const REPO_ID = 901;
const COMMIT = "a".repeat(40);
const INSTALLATION_TOKEN = "ghs_sampleInstallationTokenFixture0001";

function createFakeGitHub(publicKey: string) {
  const requests: Array<{ method: string; url: string; authorization: string | null; body: string | null }> = [];
  let accessRevoked = false;

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  const fetcher: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const authorization = headers.get("authorization");
    const body = typeof init?.body === "string" ? init.body : null;
    requests.push({ method, url: url.toString(), authorization, body });
    const path = url.pathname;

    if (url.host === "github.com" && path === "/login/oauth/access_token") {
      return JSON.parse(body ?? "{}").code === SAMPLE_TOKENS.authorizationCode ? json({ access_token: "sample-user-to-server-token" }) : json({ error: "bad_verification_code" });
    }

    if (path.startsWith("/app/")) {
      // App endpoints must be called with a valid RS256 JWT signed by the App key.
      const jwt = authorization?.replace(/^Bearer /, "") ?? "";
      const [header, payload, signature] = jwt.split(".");
      const verifier = createVerify("RSA-SHA256");
      verifier.update(`${header}.${payload}`);
      if (!signature || !verifier.verify(publicKey, Buffer.from(signature, "base64url"))) {
        return json({ message: "Bad credentials" }, 401);
      }
      if (path === `/app/installations/${INSTALLATION_ID}`) {
        return json({ id: Number(INSTALLATION_ID), account: { login: "LATTIX-IO", id: 55, type: "Organization" }, repository_selection: "selected" });
      }
      if (path === `/app/installations/${INSTALLATION_ID}/access_tokens` && method === "POST") {
        const requested = JSON.parse(body ?? "{}") as { permissions?: Record<string, string> };
        assert.deepEqual(requested.permissions, { contents: "read", metadata: "read" });
        return json({ token: INSTALLATION_TOKEN, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
      }
      return json({ message: "Not Found" }, 404);
    }

    if (path === "/user") {
      return json({ id: 7, login: "james-booth", name: "James" });
    }
    if (path === "/user/installations") {
      return json({ installations: [{ id: Number(INSTALLATION_ID) }] });
    }

    // Repository reads require the installation token.
    if (authorization !== `Bearer ${INSTALLATION_TOKEN}` || accessRevoked) {
      return json({ message: "Not Found" }, 404);
    }

    const repo = { id: REPO_ID, name: "lattix-skills", full_name: "LATTIX-IO/lattix-skills", private: true, default_branch: "main", owner: { login: "LATTIX-IO" } };
    if (path === `/repositories/${REPO_ID}` || path === "/repos/LATTIX-IO/lattix-skills") {
      return json(repo);
    }
    if (path === "/installation/repositories") {
      return json({ total_count: 1, repositories: [repo] });
    }
    if (path === "/repos/LATTIX-IO/lattix-skills/commits/main") {
      return new Response(COMMIT, { status: 200 });
    }
    if (path === `/repos/LATTIX-IO/lattix-skills/git/trees/${COMMIT}`) {
      const tree = new Map<string, "blob" | "tree">();
      for (const file of Object.keys(VALID_SKILL_FILES)) {
        tree.set(file, "blob");
        const parts = file.split("/");
        for (let index = 1; index < parts.length; index += 1) {
          tree.set(parts.slice(0, index).join("/"), "tree");
        }
      }
      return json({ truncated: false, tree: [...tree].map(([entryPath, type]) => ({ path: entryPath, type })) });
    }
    const contents = /^\/repos\/LATTIX-IO\/lattix-skills\/contents\/(.+)$/.exec(path);
    if (contents?.[1] && url.searchParams.get("ref") === COMMIT) {
      const file = VALID_SKILL_FILES[decodeURIComponent(contents[1])];
      return file === undefined ? json({ message: "Not Found" }, 404) : new Response(file, { status: 200 });
    }

    return json({ message: "Not Found" }, 404);
  };

  return { fetcher, requests, revokeAccess: () => { accessRevoked = true; } };
}

test("acceptance: authorizing the Savant GitHub App recovers the existing LATTIX-IO/lattix-skills repository", async () => {
  clearGitHubInstallationTokenCache();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const github = createFakeGitHub(publicKey.export({ type: "spki", format: "pem" }).toString());
  const env = createTestEnv();
  assert.equal(env.GITHUB_WRITE_TOKEN, undefined);

  const provider = createGitHubProvider({
    env,
    config: {
      appId: "12345",
      appSlug: "savant-test",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      clientId: "Iv1.sampleclient",
      clientSecret: SAMPLE_TOKENS.clientSecret,
      webBaseUrl: "https://github.com",
      apiBaseUrl: "https://api.github.com",
    },
  });
  const harness = createGitTestHarness({ providers: [provider], env, fetcher: github.fetcher });
  const actor = harness.actor(ORG_A, "admin", "auth0|james-booth");

  // Given: the repository exists, private, never indexed, with no connection.
  const existing = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", canonicalUrl: "https://github.com/lattix-io/lattix-skills" });
  assert.equal(harness.state.syncStates.get(existing.id)?.lastIndexedAt, null);

  // When: the user opens Settings → Integrations → Source Control and authorizes the app.
  const authorizationUrl = new URL(await harness.connections.startAuthorization(actor, { provider: "github", workspaceSlug: "james-booth" }));
  assert.equal(authorizationUrl.origin + authorizationUrl.pathname, "https://github.com/apps/savant-test/installations/new");
  const state = authorizationUrl.searchParams.get("state");
  assert.ok(state);

  const callback = new URLSearchParams({ state, installation_id: INSTALLATION_ID, setup_action: "install", code: SAMPLE_TOKENS.authorizationCode });
  const completed = await harness.connections.completeAuthorization({ provider: "github", query: callback, userSubject: actor.subject });

  // Then: a connection with installation metadata exists, and no token was persisted.
  const connection = harness.state.connections[0];
  assert.equal(completed.created, true);
  assert.equal(connection?.authType, "github_app_installation");
  assert.equal(connection?.providerInstallationId, INSTALLATION_ID);
  assert.equal(connection?.providerAccountName, "LATTIX-IO");
  assert.equal(harness.state.secrets.length, 0, "installation tokens are never persisted");

  // The existing repository was located, access verified, and associated.
  assert.deepEqual(completed.repositoryIdsToSync, [existing.id]);
  assert.equal(harness.state.repositories[0]?.providerConnectionId, connection?.id);
  assert.equal(harness.state.repositories[0]?.providerRepositoryId, String(REPO_ID));

  // Sync: installation token → access verified → indexed → skills discovered.
  const synced = await harness.sync(ORG_A, existing.id);
  assert.equal(synced.skillCount, 1);
  assert.equal(synced.commitSha, COMMIT);
  const syncState = harness.state.syncStates.get(existing.id);
  assert.equal(syncState?.status, "ok");
  assert.ok(syncState?.lastIndexedAt);
  assert.deepEqual(harness.state.indexedSkills.map((skill) => skill.skillId), ["legal/contract-review-assistant"]);
  const status = await harness.repositories.getSyncStatus(actor, existing.id);
  assert.equal(status.syncState, "ready");
  assert.equal(status.skillCount, 1);

  // The user-to-server token only verified ownership and was never stored anywhere.
  const persisted = JSON.stringify({ connections: harness.state.connections, secrets: harness.state.secrets, audit: harness.state.audit, repositories: harness.state.repositories });
  assert.ok(!persisted.includes("sample-user-to-server-token"));
  assert.ok(!persisted.includes(INSTALLATION_TOKEN));

  // Audit trail covers authorization, connection, and indexing.
  const actions = harness.state.audit.map((event) => event.action);
  for (const action of ["git_provider_authorization_started", "git_provider_connected", "repository_sync_started", "repository_sync_succeeded"]) {
    assert.ok(actions.includes(action), `missing audit ${action}`);
  }

  // Later revocation on GitHub's side is reported as an authorization problem and keeps the index.
  github.revokeAccess();
  await assert.rejects(() => harness.sync(ORG_A, existing.id));
  assert.equal(harness.state.syncStates.get(existing.id)?.status, "auth_required");
  assert.equal(harness.state.indexedSkills.length, 1);
});

test("acceptance: an installation id that the authorizing user cannot access is rejected", async () => {
  clearGitHubInstallationTokenCache();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const github = createFakeGitHub(publicKey.export({ type: "spki", format: "pem" }).toString());
  const env = createTestEnv();
  const provider = createGitHubProvider({
    env,
    config: {
      appId: "12345",
      appSlug: "savant-test",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      clientId: "Iv1.sampleclient",
      clientSecret: SAMPLE_TOKENS.clientSecret,
      webBaseUrl: "https://github.com",
      apiBaseUrl: "https://api.github.com",
    },
  });
  const harness = createGitTestHarness({ providers: [provider], env, fetcher: github.fetcher });
  const actor = harness.actor(ORG_A);
  const state = new URL(await harness.connections.startAuthorization(actor, { provider: "github" })).searchParams.get("state") ?? "";

  // Someone else's installation id pasted into the callback.
  await assert.rejects(
    () => harness.connections.completeAuthorization({
      provider: "github",
      query: new URLSearchParams({ state, installation_id: "31337", setup_action: "install", code: SAMPLE_TOKENS.authorizationCode }),
      userSubject: actor.subject,
    }),
    /not accessible/,
  );
  assert.equal(harness.state.connections.length, 0);
});
