import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import { GitProviderError, normalizeProviderHttpFailure } from "./errors.ts";
import { isBlockedIpAddress, validateProviderBaseUrl } from "./host-validation.ts";
import { computeBackoffMs, providerRequest } from "./http.ts";
import { consumeAuthorizationState, createAuthorizationState, sanitizeReturnPath } from "./oauth-state.ts";
import { redactString, redactValue, sanitizeGitAuditPayload } from "./redaction.ts";
import { decryptProviderCredential, encryptProviderCredential } from "./secret-vault.ts";
import { createMemoryGitStores } from "./testing/memory-stores.ts";
import { createTestEnv, ORG_A, ORG_B } from "./testing/harness.ts";
import { SAMPLE_TOKENS } from "./testing/fixtures.ts";
import { createRuntimeCredential, type FetchLike } from "./types.ts";
import { canonicalRepositoryUrl, parseGitRepositoryUrl, parseGitLabRepositoryUrl } from "./url-parsing.ts";

const noSleep = async () => undefined;

test("vault: credentials are encrypted at rest and bound to their organization and connection", () => {
  const env = createTestEnv();
  const binding = { purpose: "connection_credential" as const, organizationId: ORG_A, connectionId: "conn-1" };
  const encrypted = encryptProviderCredential({ accessToken: SAMPLE_TOKENS.valid, refreshToken: SAMPLE_TOKENS.refresh }, binding, env);

  assert.ok(!encrypted.encryptedPayload.includes(SAMPLE_TOKENS.valid));
  assert.ok(!encrypted.encryptedPayload.includes(SAMPLE_TOKENS.refresh));
  assert.equal(decryptProviderCredential(encrypted.encryptedPayload, binding, env).accessToken, SAMPLE_TOKENS.valid);

  // Ciphertext copied into another tenant (or connection) does not decrypt.
  assert.throws(() => decryptProviderCredential(encrypted.encryptedPayload, { ...binding, organizationId: ORG_B }, env), GitProviderError);
  assert.throws(() => decryptProviderCredential(encrypted.encryptedPayload, { ...binding, connectionId: "conn-2" }, env), GitProviderError);
  // A different key (e.g. a DB copied to another deployment) does not decrypt.
  assert.throws(() => decryptProviderCredential(encrypted.encryptedPayload, binding, createTestEnv()), GitProviderError);
});

test("vault: refuses to store credentials without an encryption key", () => {
  assert.throws(
    () => encryptProviderCredential({ accessToken: SAMPLE_TOKENS.valid }, { purpose: "connection_credential", organizationId: ORG_A, connectionId: "c" }, {}),
    (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_NOT_CONFIGURED",
  );
});

test("redaction: bearer headers, provider token formats, query params and JSON fields are scrubbed", () => {
  const ghToken = ["ghs", "_", "A".repeat(36)].join("");
  const glToken = ["glpat", "-", "B".repeat(20)].join("");
  const line = `Authorization: Bearer ${SAMPLE_TOKENS.valid} token=${glToken} ${ghToken} {"refresh_token":"${SAMPLE_TOKENS.refresh}"} https://x-access-token:${SAMPLE_TOKENS.valid}@github.com/o/r`;
  const redacted = redactString(line);

  for (const secret of [SAMPLE_TOKENS.valid, SAMPLE_TOKENS.refresh, ghToken, glToken]) {
    assert.ok(!redacted.includes(secret), `leaked ${secret.slice(0, 6)}`);
  }

  const value = redactValue({ headers: { Authorization: "Bearer x" }, nested: { client_secret: SAMPLE_TOKENS.clientSecret, ok: 1 } }) as Record<string, Record<string, unknown>>;
  assert.equal(value.headers?.Authorization, "[REDACTED]");
  assert.equal(value.nested?.client_secret, "[REDACTED]");
  assert.equal(value.nested?.ok, 1);
});

test("redaction: audit payloads keep only allowlisted keys", () => {
  const payload = sanitizeGitAuditPayload({
    provider: "github",
    connection_id: "c1",
    access_token: SAMPLE_TOKENS.valid,
    refresh_token: SAMPLE_TOKENS.refresh,
    authorization_code: SAMPLE_TOKENS.authorizationCode,
    client_secret: SAMPLE_TOKENS.clientSecret,
    credential: { accessToken: SAMPLE_TOKENS.valid },
    error_code: "TOKEN_REVOKED",
  });
  assert.deepEqual(Object.keys(payload).sort(), ["connection_id", "error_code", "provider"]);
  assert.ok(!JSON.stringify(payload).includes("sample-"));
});

test("runtime credentials never serialize or inspect their token", () => {
  const credential = createRuntimeCredential({
    provider: "github",
    connectionId: "c1",
    organizationId: ORG_A,
    apiBaseUrl: "https://api.github.com",
    host: "github.com",
    accessToken: SAMPLE_TOKENS.valid,
  });

  assert.equal(credential.accessToken, SAMPLE_TOKENS.valid);
  assert.ok(!JSON.stringify(credential).includes(SAMPLE_TOKENS.valid));
  assert.ok(!JSON.stringify({ job: { credential } }).includes(SAMPLE_TOKENS.valid));
  assert.ok(!inspect(credential).includes(SAMPLE_TOKENS.valid));
  assert.ok(!JSON.stringify({ ...credential }).includes(SAMPLE_TOKENS.valid));
  assert.ok(!Object.values(credential).includes(SAMPLE_TOKENS.valid));
});

test("SSRF: self-managed hosts must be HTTPS and must not resolve to internal networks", async () => {
  const publicResolver = async () => ["203.0.113.10"];
  const ok = await validateProviderBaseUrl("gitlab.acme.example", { env: {}, resolve: publicResolver });
  assert.equal(ok.origin, "https://gitlab.acme.example");

  const rejected = [
    "http://gitlab.acme.example",
    "https://localhost",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://metadata.google.internal",
    "https://user:pass@gitlab.acme.example",
    "https://10.1.2.3",
  ];
  for (const url of rejected) {
    await assert.rejects(() => validateProviderBaseUrl(url, { env: {}, resolve: publicResolver }), (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_HOST_REJECTED", url);
  }

  // DNS pointing a public name at a private address is rejected too.
  await assert.rejects(() => validateProviderBaseUrl("https://gitlab.rebind.example", { env: {}, resolve: async () => ["192.168.1.5"] }));

  // Deliberately supported private connectivity is an explicit operator opt-in.
  const allowed = await validateProviderBaseUrl("https://gitlab.corp.example", {
    env: { GIT_PROVIDER_ALLOWED_PRIVATE_HOSTS: "gitlab.corp.example" },
    resolve: async () => ["10.0.0.5"],
  });
  assert.equal(allowed.host, "gitlab.corp.example");
  assert.equal(isBlockedIpAddress("fd00:ec2::254"), true);
  assert.equal(isBlockedIpAddress("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedIpAddress("8.8.8.8"), false);
});

test("URL parsing normalizes HTTPS and SSH forms for every provider", () => {
  assert.equal(parseGitRepositoryUrl("https://github.com/LATTIX-IO/lattix-skills")?.fullName, "LATTIX-IO/lattix-skills");
  assert.equal(parseGitRepositoryUrl("git@github.com:LATTIX-IO/lattix-skills.git")?.fullName, "LATTIX-IO/lattix-skills");
  assert.equal(parseGitRepositoryUrl("https://gitlab.com/group/subgroup/repo")?.owner, "group/subgroup");
  assert.equal(parseGitRepositoryUrl("git@gitlab.com:group/subgroup/repo.git")?.name, "repo");
  assert.equal(parseGitLabRepositoryUrl("https://gitlab.acme.example/g/r/-/tree/main", "gitlab.acme.example")?.fullName, "g/r");
  assert.equal(parseGitRepositoryUrl("https://bitbucket.org/workspace/repo")?.provider, "bitbucket");
  const azure = parseGitRepositoryUrl("https://dev.azure.com/org/project/_git/repo");
  assert.deepEqual([azure?.provider, azure?.owner, azure?.project, azure?.name], ["azure", "org", "project", "repo"]);
  assert.equal(parseGitRepositoryUrl("https://org.visualstudio.com/project/_git/repo")?.project, "project");
  assert.equal(parseGitRepositoryUrl("git@ssh.dev.azure.com:v3/org/project/repo")?.fullName, "org/project/repo");

  // Duplicate detection uses a canonical form.
  const a = parseGitRepositoryUrl("git@github.com:LATTIX-IO/Lattix-Skills.git");
  const b = parseGitRepositoryUrl("https://github.com/lattix-io/lattix-skills/");
  assert.ok(a && b);
  assert.equal(canonicalRepositoryUrl(a), canonicalRepositoryUrl(b));
});

test("error normalization: a 404 for a known repository is an access problem, not absence", () => {
  assert.equal(normalizeProviderHttpFailure({ provider: "github", status: 404, repositoryKnown: true }).code, "REPOSITORY_ACCESS_DENIED");
  assert.equal(normalizeProviderHttpFailure({ provider: "github", status: 404 }).code, "REPOSITORY_NOT_FOUND");
  assert.equal(normalizeProviderHttpFailure({ provider: "gitlab", status: 401 }).code, "TOKEN_EXPIRED");
  assert.equal(normalizeProviderHttpFailure({ provider: "gitlab", status: 401, authenticated: false }).code, "AUTH_REQUIRED");
  assert.equal(normalizeProviderHttpFailure({ provider: "azure", status: 400, oauthError: "invalid_grant" }).code, "TOKEN_REVOKED");
  assert.equal(normalizeProviderHttpFailure({ provider: "bitbucket", status: 429 }).code, "PROVIDER_RATE_LIMITED");
  assert.equal(normalizeProviderHttpFailure({ provider: "github", status: 403, rateLimitExhausted: true }).code, "PROVIDER_RATE_LIMITED");
  assert.equal(normalizeProviderHttpFailure({ provider: "github", status: 503 }).code, "PROVIDER_UNAVAILABLE");
});

test("http: retries 429/5xx with backoff but never retries 401", async () => {
  let calls = 0;
  const flaky: FetchLike = async () => {
    calls += 1;
    return calls < 3 ? new Response("busy", { status: calls === 1 ? 429 : 502 }) : new Response("{}", { status: 200 });
  };
  await providerRequest("https://api.example/x", { provider: "github", fetcher: flaky, sleep: noSleep });
  assert.equal(calls, 3);

  calls = 0;
  const unauthorized: FetchLike = async () => {
    calls += 1;
    return new Response("{}", { status: 401 });
  };
  await assert.rejects(
    () => providerRequest("https://api.example/x", { provider: "github", fetcher: unauthorized, sleep: noSleep, credential: createRuntimeCredential({ provider: "github", connectionId: null, organizationId: null, apiBaseUrl: "https://api.example", host: "example", accessToken: SAMPLE_TOKENS.valid }) }),
    (error: unknown) => error instanceof GitProviderError && error.code === "TOKEN_EXPIRED",
  );
  assert.equal(calls, 1);

  // Network failures are transient and do not become auth errors.
  const offline: FetchLike = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    () => providerRequest("https://api.example/x", { provider: "gitlab", fetcher: offline, sleep: noSleep }),
    (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_UNAVAILABLE",
  );

  const jittered = computeBackoffMs(3, null, () => 0.5);
  assert.ok(jittered >= 0 && jittered <= 8000);
  assert.equal(computeBackoffMs(0, 1500), 1500);
});

test("oauth state: single use, expiring, same user, same provider, org taken from state", async () => {
  const env = createTestEnv();
  const stores = createMemoryGitStores();
  const { oauthStates } = stores;
  const now = new Date("2026-09-29T10:00:00Z");
  const base = { organizationId: ORG_A, userSubject: "auth0|alice", provider: "gitlab" as const, returnPath: "/o/acme/settings", usePkce: true, now, env };

  const created = await createAuthorizationState(oauthStates, base);
  assert.ok(created.codeChallenge && created.codeChallenge.length >= 43);
  const consumed = await consumeAuthorizationState(oauthStates, { state: created.state, provider: "gitlab", userSubject: "auth0|alice", now, env });
  assert.equal(consumed.organizationId, ORG_A);
  assert.ok(consumed.payload.codeVerifier);

  // Reuse is rejected.
  await assert.rejects(() => consumeAuthorizationState(oauthStates, { state: created.state, provider: "gitlab", userSubject: "auth0|alice", now, env }), /already used/);

  // Expired state is rejected.
  const expired = await createAuthorizationState(oauthStates, base);
  await assert.rejects(
    () => consumeAuthorizationState(oauthStates, { state: expired.state, provider: "gitlab", userSubject: "auth0|alice", now: new Date(now.getTime() + 11 * 60_000), env }),
    /expired/,
  );

  // A different Savant user (e.g. a member of another tenant replaying the link) is rejected.
  const crossUser = await createAuthorizationState(oauthStates, base);
  await assert.rejects(
    () => consumeAuthorizationState(oauthStates, { state: crossUser.state, provider: "gitlab", userSubject: "auth0|mallory", now, env }),
    (error: unknown) => error instanceof GitProviderError && error.status === 403,
  );

  // Provider mismatch is rejected.
  const mismatch = await createAuthorizationState(oauthStates, base);
  await assert.rejects(() => consumeAuthorizationState(oauthStates, { state: mismatch.state, provider: "github", userSubject: "auth0|alice", now, env }), /provider/);

  // The persisted record holds only a hash of the state and an encrypted verifier.
  const serialized = JSON.stringify(stores.state.oauthStates);
  assert.equal(stores.state.oauthStates.length, 4);
  assert.ok(!serialized.includes(created.state));
  assert.ok(!serialized.includes(consumed.payload.codeVerifier as string));
});

test("oauth state: return paths are restricted to same-origin relative paths", () => {
  assert.equal(sanitizeReturnPath("/o/acme/settings?section=source-control", "/x"), "/o/acme/settings?section=source-control");
  assert.equal(sanitizeReturnPath("https://evil.example/", "/x"), "/x");
  assert.equal(sanitizeReturnPath("//evil.example/path", "/x"), "/x");
  assert.equal(sanitizeReturnPath("/\\evil.example", "/x"), "/x");
  assert.equal(sanitizeReturnPath(undefined, "/x"), "/x");
});
