import assert from "node:assert/strict";
import test from "node:test";

import { GitProviderError } from "../errors.ts";
import { createRuntimeCredential, type FetchLike, type RepositoryLocator } from "../types.ts";
import { createGitLabProvider, gitLabProjectRef } from "./gitlab.ts";

const sampleAccessToken = "sample-gitlab-access-token";
const sampleRefreshToken = "sample-gitlab-refresh-token";
const rotatedAccessToken = "sample-gitlab-rotated-access-token";
const rotatedRefreshToken = "sample-gitlab-rotated-refresh-token";
const sampleClientSecret = "sample-gitlab-client-secret";

type RecordedRequest = { url: string; method: string; headers: Record<string, string>; body: string | null };

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function createFetcher(handler: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const fetcher: FetchLike = async (input, init) => {
    const request: RecordedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body == null ? null : String(init.body),
    };
    requests.push(request);
    return handler(request);
  };
  return { fetcher, requests };
}

function createProvider() {
  return createGitLabProvider({
    env: {},
    config: { clientId: "sample-gitlab-client-id", clientSecret: sampleClientSecret, scopes: ["read_repository", "read_api", "read_user"] },
    now: () => Date.parse("2026-09-01T00:00:00.000Z"),
    resolveHost: async () => ["203.0.113.10"],
  });
}

function runtimeCredential(host = "gitlab.com") {
  return createRuntimeCredential({
    provider: "gitlab",
    connectionId: "conn_1",
    organizationId: "org_1",
    apiBaseUrl: `https://${host}/api/v4`,
    host,
    accessToken: sampleAccessToken,
  });
}

const locator: RepositoryLocator = {
  provider: "gitlab",
  host: "gitlab.com",
  owner: "acme/platform",
  name: "skills",
  fullName: "acme/platform/skills",
  providerRepositoryId: "42",
};

test("getAuthorizationUrl includes PKCE, state, and space-joined read scopes", async () => {
  const url = new URL(await createProvider().getAuthorizationUrl({
    state: "sample-state",
    redirectUri: "https://app.example.com/api/git/connections/gitlab/callback",
    codeChallenge: "sample-code-challenge",
  }));

  assert.equal(url.origin, "https://gitlab.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "sample-gitlab-client-id");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "sample-state");
  assert.equal(url.searchParams.get("scope"), "read_repository read_api read_user");
  assert.equal(url.searchParams.get("code_challenge"), "sample-code-challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("getAuthorizationUrl uses the self-managed host and its instance client id", async () => {
  const url = new URL(await createProvider().getAuthorizationUrl({
    state: "sample-state",
    redirectUri: "https://app.example.com/cb",
    codeChallenge: "sample-code-challenge",
    host: "gitlab.example.com",
    clientId: "sample-instance-client-id",
  }));

  assert.equal(url.origin, "https://gitlab.example.com");
  assert.equal(url.searchParams.get("client_id"), "sample-instance-client-id");
});

test("self-managed hosts resolving to private addresses are rejected before any request", async () => {
  const provider = createGitLabProvider({
    env: {},
    config: { clientId: "sample-gitlab-client-id", clientSecret: sampleClientSecret, scopes: ["read_api"] },
    resolveHost: async () => ["10.0.0.5"],
  });
  const { fetcher, requests } = createFetcher(() => jsonResponse({}));

  await assert.rejects(
    () => provider.completeAuthorization(new URLSearchParams({ code: "sample-code" }), {
      redirectUri: "https://app.example.com/cb",
      host: "gitlab.internal-corp.example",
      clientId: "sample-instance-client-id",
      clientSecret: sampleClientSecret,
    }, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_HOST_REJECTED",
  );
  assert.equal(requests.length, 0);
});

test("completeAuthorization exchanges the code with the PKCE verifier and stores refresh token and expiry", async () => {
  const { fetcher, requests } = createFetcher((request) => {
    if (request.url === "https://gitlab.com/oauth/token") {
      return jsonResponse({
        access_token: sampleAccessToken,
        refresh_token: sampleRefreshToken,
        expires_in: 7200,
        created_at: Date.parse("2026-09-01T00:00:00.000Z") / 1000,
        scope: "read_repository read_api read_user",
        token_type: "Bearer",
      });
    }
    if (request.url === "https://gitlab.com/api/v4/user") {
      return jsonResponse({ id: 7, username: "octo", name: "Octo Cat" });
    }
    return jsonResponse({}, { status: 500 });
  });

  const result = await createProvider().completeAuthorization(
    new URLSearchParams({ code: "sample-code", state: "sample-state" }),
    { redirectUri: "https://app.example.com/cb", codeVerifier: "sample-code-verifier" },
    { fetcher },
  );

  const tokenBody = new URLSearchParams(requests[0]?.body ?? "");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(tokenBody.get("grant_type"), "authorization_code");
  assert.equal(tokenBody.get("code"), "sample-code");
  assert.equal(tokenBody.get("code_verifier"), "sample-code-verifier");
  assert.equal(tokenBody.get("client_secret"), sampleClientSecret);
  assert.equal(requests[1]?.headers.Authorization, `Bearer ${sampleAccessToken}`);

  assert.equal(result.authType, "oauth");
  assert.equal(result.host, "gitlab.com");
  assert.equal(result.accountId, "7");
  assert.equal(result.accountName, "octo");
  assert.deepEqual(result.scopes, ["read_repository", "read_api", "read_user"]);
  assert.equal(result.credential?.accessToken, sampleAccessToken);
  assert.equal(result.credential?.refreshToken, sampleRefreshToken);
  assert.equal(result.credential?.expiresAt, "2026-09-01T02:00:00.000Z");
  assert.equal(result.credential?.clientId, undefined);
});

test("completeAuthorization reports a declined callback as AUTH_REQUIRED", async () => {
  await assert.rejects(
    () => createProvider().completeAuthorization(new URLSearchParams({ error: "access_denied" }), { redirectUri: "https://app.example.com/cb" }),
    (error: unknown) => error instanceof GitProviderError && error.code === "AUTH_REQUIRED" && /declined/.test(error.message),
  );
});

test("self-managed exchange persists the instance OAuth client for refresh", async () => {
  const { fetcher, requests } = createFetcher((request) => request.url.endsWith("/oauth/token")
    ? jsonResponse({ access_token: sampleAccessToken, refresh_token: sampleRefreshToken, expires_in: 7200 })
    : jsonResponse({ id: 9, username: "self" }));

  const result = await createProvider().completeAuthorization(new URLSearchParams({ code: "sample-code" }), {
    redirectUri: "https://app.example.com/cb",
    host: "gitlab.example.com",
    clientId: "sample-instance-client-id",
    clientSecret: sampleClientSecret,
    codeVerifier: "sample-code-verifier",
  }, { fetcher });

  assert.equal(requests[0]?.url, "https://gitlab.example.com/oauth/token");
  assert.equal(requests[1]?.url, "https://gitlab.example.com/api/v4/user");
  assert.equal(result.host, "gitlab.example.com");
  assert.equal(result.credential?.clientId, "sample-instance-client-id");
  assert.equal(result.credential?.clientSecret, sampleClientSecret);
});

test("refreshCredential rotates the refresh token", async () => {
  const { fetcher, requests } = createFetcher(() => jsonResponse({
    access_token: rotatedAccessToken,
    refresh_token: rotatedRefreshToken,
    expires_in: 7200,
    created_at: Date.parse("2026-09-02T00:00:00.000Z") / 1000,
  }));

  const refreshed = await createProvider().refreshCredential!(
    { accessToken: sampleAccessToken, refreshToken: sampleRefreshToken },
    { fetcher, host: "gitlab.com" },
  );

  const body = new URLSearchParams(requests[0]?.body ?? "");
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("refresh_token"), sampleRefreshToken);
  assert.equal(refreshed.accessToken, rotatedAccessToken);
  assert.equal(refreshed.refreshToken, rotatedRefreshToken);
  assert.equal(refreshed.expiresAt, "2026-09-02T02:00:00.000Z");
});

test("invalid_grant on refresh is TOKEN_REVOKED", async () => {
  const { fetcher, requests } = createFetcher(() => jsonResponse({ error: "invalid_grant" }, { status: 400 }));

  await assert.rejects(
    () => createProvider().refreshCredential!({ refreshToken: sampleRefreshToken }, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "TOKEN_REVOKED",
  );
  assert.equal(requests.length, 1);
});

test("revokeCredential ignores 4xx responses", async () => {
  const { fetcher, requests } = createFetcher(() => jsonResponse({ error: "invalid_request" }, { status: 400 }));
  await createProvider().revokeCredential!({ accessToken: sampleAccessToken }, { fetcher });
  assert.equal(requests[0]?.url, "https://gitlab.com/oauth/revoke");
});

test("createRuntimeCredential targets the connection host's API", async () => {
  const credential = await createProvider().createRuntimeCredential({
    connectionId: "conn_1",
    organizationId: "org_1",
    authType: "pat",
    host: "gitlab.example.com",
    installationId: null,
    credential: { accessToken: sampleAccessToken },
  });

  assert.equal(credential.apiBaseUrl, "https://gitlab.example.com/api/v4");
  assert.equal(credential.host, "gitlab.example.com");
  assert.equal(credential.scheme, "bearer");
  assert.equal(JSON.stringify(credential).includes(sampleAccessToken), false);
});

test("listRepositories maps namespace hierarchy and paginates with an opaque cursor", async () => {
  const { fetcher, requests } = createFetcher(() => jsonResponse([
    {
      id: 42,
      path: "skills",
      name: "Skills",
      path_with_namespace: "acme/platform/skills",
      namespace: { full_path: "acme/platform" },
      default_branch: "main",
      web_url: "https://gitlab.com/acme/platform/skills",
      http_url_to_repo: "https://gitlab.com/acme/platform/skills.git",
      visibility: "internal",
    },
  ], { headers: { "x-next-page": "2" } }));

  const page = await createProvider().listRepositories(runtimeCredential(), { search: "skills", pageSize: 20 }, { fetcher });
  const url = new URL(requests[0]?.url ?? "");

  assert.equal(url.pathname, "/api/v4/projects");
  assert.equal(url.searchParams.get("membership"), "true");
  assert.equal(url.searchParams.get("per_page"), "20");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("search"), "skills");

  const [repo] = page.items;
  assert.equal(repo?.providerRepositoryId, "42");
  assert.equal(repo?.owner, "acme/platform");
  assert.equal(repo?.name, "skills");
  assert.equal(repo?.fullName, "acme/platform/skills");
  assert.deepEqual(repo?.hierarchy, ["acme", "platform"]);
  assert.equal(repo?.isPrivate, true);
  assert.equal(repo?.cloneUrl, "https://gitlab.com/acme/platform/skills.git");

  assert.ok(page.nextCursor);
  assert.equal(page.nextCursor?.includes("http"), false);

  await createProvider().listRepositories(runtimeCredential(), { cursor: page.nextCursor ?? undefined }, { fetcher });
  assert.equal(new URL(requests[1]?.url ?? "").searchParams.get("page"), "2");
});

test("readFile returns raw bytes from the files API", async () => {
  const { fetcher, requests } = createFetcher(() => new Response(Buffer.from("# Skill\n", "utf8")));

  const body = await createProvider().readFile(runtimeCredential(), locator, "main", "skills/a/SKILL.md", { fetcher });

  assert.equal(body.toString("utf8"), "# Skill\n");
  assert.equal(requests[0]?.url, "https://gitlab.com/api/v4/projects/42/repository/files/skills%2Fa%2FSKILL.md/raw?ref=main");
});

test("listTree follows keyset pagination links and maps entry kinds", async () => {
  const { fetcher, requests } = createFetcher((request) => {
    if (!request.url.includes("page_token")) {
      return jsonResponse([{ path: "skills", type: "tree" }, { path: "skills/a", type: "tree" }], {
        headers: { link: "<https://gitlab.com/api/v4/projects/42/repository/tree?page_token=abc&pagination=keyset>; rel=\"next\"" },
      });
    }
    return jsonResponse([{ path: "skills/a/SKILL.md", type: "blob" }, { path: "vendor", type: "commit" }]);
  });

  const entries = await createProvider().listTree(runtimeCredential(), locator, "main", { fetcher });

  assert.equal(requests.length, 2);
  assert.deepEqual(entries, [
    { path: "skills", kind: "dir" },
    { path: "skills/a", kind: "dir" },
    { path: "skills/a/SKILL.md", kind: "file" },
  ]);

  const depthLimited = await createProvider().listTree(runtimeCredential(), locator, "main", { fetcher, maxDepth: 2 });
  assert.deepEqual(depthLimited.map((entry) => entry.path), ["skills", "skills/a"]);

  await assert.rejects(
    () => createProvider().listTree(runtimeCredential(), locator, "main", { fetcher, maxEntries: 2 }),
    (error: unknown) => error instanceof GitProviderError && error.code === "INDEX_FAILED" && error.status === 413,
  );
});

test("resolveRevision returns the commit sha", async () => {
  const sha = "a".repeat(40);
  const { fetcher, requests } = createFetcher(() => jsonResponse({ id: sha }));
  assert.equal(await createProvider().resolveRevision(runtimeCredential(), locator, "feature/x", { fetcher }), sha);
  assert.equal(requests[0]?.url, "https://gitlab.com/api/v4/projects/42/repository/commits/feature%2Fx");
});

test("project addressing falls back to the encoded full path", () => {
  assert.equal(gitLabProjectRef({ providerRepositoryId: "42", fullName: "a/b" }), "42");
  assert.equal(gitLabProjectRef({ providerRepositoryId: undefined, fullName: "acme/platform/skills" }), "acme%2Fplatform%2Fskills");
});

test("HTTP failures normalize to standardized codes", async () => {
  const provider = createProvider();
  const cases: Array<[number, string]> = [
    [401, "TOKEN_EXPIRED"],
    [403, "REPOSITORY_ACCESS_DENIED"],
    [404, "REPOSITORY_ACCESS_DENIED"],
  ];

  for (const [status, code] of cases) {
    const { fetcher } = createFetcher(() => jsonResponse({ message: "nope" }, { status }));
    await assert.rejects(
      () => provider.getRepository(runtimeCredential(), locator, { fetcher }),
      (error: unknown) => error instanceof GitProviderError && error.code === code,
      `status ${status}`,
    );
  }

  const { fetcher: notFound } = createFetcher(() => jsonResponse({ message: "404 Project Not Found" }, { status: 404 }));
  const access = await provider.validateRepositoryAccess(runtimeCredential(), locator, { fetcher: notFound });
  assert.equal(access.accessible, false);
  assert.equal(access.errorCode, "REPOSITORY_ACCESS_DENIED");
});

test("429 with retry-after 0 is retried and surfaces PROVIDER_RATE_LIMITED", async () => {
  const { fetcher, requests } = createFetcher(() => jsonResponse({ message: "slow down" }, { status: 429, headers: { "retry-after": "0" } }));

  await assert.rejects(
    () => createProvider().getRepository(runtimeCredential(), locator, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_RATE_LIMITED",
  );
  assert.equal(requests.length, 4);
});

test("inspectTokenPrivileges warns about write scopes and tolerates OAuth tokens", async () => {
  const provider = createProvider();
  const { fetcher: pat } = createFetcher(() => jsonResponse({ scopes: ["api", "read_repository"] }));
  const warnings = await provider.inspectTokenPrivileges!(runtimeCredential(), { fetcher: pat });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /api/);

  const { fetcher: readOnly } = createFetcher(() => jsonResponse({ scopes: ["read_api", "read_repository"] }));
  assert.deepEqual(await provider.inspectTokenPrivileges!(runtimeCredential(), { fetcher: readOnly }), []);

  const { fetcher: oauth } = createFetcher(() => jsonResponse({ message: "404 Not Found" }, { status: 404 }));
  assert.deepEqual(await provider.inspectTokenPrivileges!(runtimeCredential(), { fetcher: oauth }), []);
});

test("parseRepositoryUrl honors the self-managed host", () => {
  const provider = createProvider();
  assert.equal(provider.parseRepositoryUrl("https://gitlab.com/acme/platform/skills")?.fullName, "acme/platform/skills");
  assert.equal(provider.parseRepositoryUrl("https://gitlab.example.com/acme/skills", "gitlab.example.com")?.host, "gitlab.example.com");
});
