import assert from "node:assert/strict";
import test from "node:test";

import { GitProviderError } from "../errors.ts";
import { decodeCursor } from "../http.ts";
import type { FetchLike, RepositoryLocator, RuntimeCredential } from "../types.ts";
import { createBitbucketProvider, escapeBitbucketQueryValue } from "./bitbucket.ts";

const sampleClientId = "sample-bitbucket-client-id";
const sampleClientSecret = "sample-bitbucket-client-secret";
const sampleAccessToken = "sample-bitbucket-access-token";
const sampleRefreshToken = "sample-bitbucket-refresh-token";
const NOW = Date.parse("2026-09-29T12:00:00.000Z");

type Call = { url: string; init: RequestInit | undefined };

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function createFetcher(handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(new URL(url), init);
  };
  return { fetcher, calls };
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function createProvider() {
  return createBitbucketProvider({
    config: { clientId: sampleClientId, clientSecret: sampleClientSecret, scopes: ["repository", "account"] },
    env: {},
    now: () => NOW,
  });
}

async function runtimeCredential(): Promise<RuntimeCredential> {
  return createProvider().createRuntimeCredential({
    connectionId: "conn_1",
    organizationId: "org_1",
    authType: "oauth",
    host: "bitbucket.org",
    installationId: null,
    credential: { accessToken: sampleAccessToken },
  });
}

const locator: RepositoryLocator = {
  provider: "bitbucket",
  host: "bitbucket.org",
  owner: "acme",
  name: "skills",
  fullName: "acme/skills",
};

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

test("getAuthorizationUrl targets the Bitbucket authorize endpoint with client_id and state", async () => {
  const url = new URL(await createProvider().getAuthorizationUrl({ state: "state-123", redirectUri: "https://app.example/cb" }));
  assert.equal(url.origin + url.pathname, "https://bitbucket.org/site/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), sampleClientId);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("scope"), null);
});

test("isConfigured and configurationHint reflect the OAuth consumer configuration", () => {
  const unconfigured = createBitbucketProvider({ env: { APP_BASE_URL: "https://savant.example" } });
  assert.equal(unconfigured.isConfigured(), false);
  const hint = unconfigured.configurationHint() ?? "";
  assert.match(hint, /BITBUCKET_OAUTH_CLIENT_ID/);
  assert.match(hint, /BITBUCKET_OAUTH_CLIENT_SECRET/);
  assert.match(hint, /https:\/\/savant\.example\/api\/git\/connections\/bitbucket\/callback/);
  assert.equal(createProvider().isConfigured(), true);
  assert.equal(createProvider().configurationHint(), null);
});

test("completeAuthorization exchanges the code with Basic auth and stores refresh token and expiry", async () => {
  const { fetcher, calls } = createFetcher((url) => {
    if (url.href === "https://bitbucket.org/site/oauth2/access_token") {
      return jsonResponse({
        access_token: sampleAccessToken,
        refresh_token: sampleRefreshToken,
        expires_in: 7200,
        scopes: "account repository",
        token_type: "bearer",
      });
    }
    if (url.href === "https://api.bitbucket.org/2.0/user") {
      return jsonResponse({ uuid: "{11111111-2222-3333-4444-555555555555}", username: "jdoe", display_name: "J Doe", account_id: "557058:abc" });
    }
    return jsonResponse({}, { status: 500 });
  });

  const result = await createProvider().completeAuthorization(
    new URLSearchParams({ code: "sample-auth-code", state: "s" }),
    { redirectUri: "https://app.example/cb" },
    { fetcher },
  );

  const tokenCall = calls[0];
  assert.ok(tokenCall);
  assert.equal(tokenCall.init?.method, "POST");
  assert.equal(
    headerOf(tokenCall.init, "Authorization"),
    `Basic ${Buffer.from(`${sampleClientId}:${sampleClientSecret}`).toString("base64")}`,
  );
  const body = new URLSearchParams(String(tokenCall.init?.body));
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "sample-auth-code");

  const userCall = calls[1];
  assert.ok(userCall);
  assert.equal(headerOf(userCall.init, "Authorization"), `Bearer ${sampleAccessToken}`);

  assert.equal(result.authType, "oauth");
  assert.equal(result.credential?.accessToken, sampleAccessToken);
  assert.equal(result.credential?.refreshToken, sampleRefreshToken);
  assert.equal(result.credential?.expiresAt, new Date(NOW + 7200 * 1000).toISOString());
  assert.deepEqual(result.credential?.scopes, ["account", "repository"]);
  assert.deepEqual(result.scopes, ["account", "repository"]);
  assert.equal(result.accountId, "{11111111-2222-3333-4444-555555555555}");
  assert.equal(result.accountName, "jdoe");
  assert.equal(result.host, "bitbucket.org");
  assert.equal(result.identity.displayName, "J Doe");
});

test("completeAuthorization reports a declined authorization as AUTH_REQUIRED", async () => {
  await assert.rejects(
    () => createProvider().completeAuthorization(new URLSearchParams({ error: "access_denied" }), { redirectUri: "https://app.example/cb" }),
    (error: unknown) => error instanceof GitProviderError && error.code === "AUTH_REQUIRED" && /declined/.test(error.message),
  );
});

test("refreshCredential uses the refresh_token grant and keeps the prior refresh token when none is returned", async () => {
  const { fetcher, calls } = createFetcher(() =>
    jsonResponse({ access_token: "sample-bitbucket-access-token-2", expires_in: 3600, scopes: "repository account", token_type: "bearer" }),
  );
  const refresh = createProvider().refreshCredential;
  assert.ok(refresh);

  const refreshed = await refresh({ accessToken: sampleAccessToken, refreshToken: sampleRefreshToken }, { fetcher });

  const body = new URLSearchParams(String(calls[0]?.init?.body));
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("refresh_token"), sampleRefreshToken);
  assert.match(headerOf(calls[0]?.init, "Authorization") ?? "", /^Basic /);
  assert.equal(refreshed.accessToken, "sample-bitbucket-access-token-2");
  assert.equal(refreshed.refreshToken, sampleRefreshToken);
  assert.equal(refreshed.expiresAt, new Date(NOW + 3600 * 1000).toISOString());
});

test("refreshCredential maps invalid_grant to TOKEN_REVOKED", async () => {
  const { fetcher, calls } = createFetcher(() =>
    jsonResponse({ error: "invalid_grant", error_description: "Invalid refresh_token" }, { status: 400 }),
  );
  const refresh = createProvider().refreshCredential;
  assert.ok(refresh);

  await assert.rejects(
    () => refresh({ accessToken: sampleAccessToken, refreshToken: sampleRefreshToken }, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "TOKEN_REVOKED",
  );
  assert.equal(calls.length, 1);
});

test("createRuntimeCredential requires an access token and uses bearer", async () => {
  const credential = await runtimeCredential();
  assert.equal(credential.scheme, "bearer");
  assert.equal(credential.apiBaseUrl, "https://api.bitbucket.org/2.0");
  assert.equal(credential.host, "bitbucket.org");

  await assert.rejects(
    () => createProvider().createRuntimeCredential({
      connectionId: "conn_1",
      organizationId: "org_1",
      authType: "oauth",
      host: null,
      installationId: null,
      credential: null,
    }),
    (error: unknown) => error instanceof GitProviderError && error.code === "AUTH_REQUIRED",
  );
});

test("listRepositories maps repositories, sends the search query, and pages with an opaque cursor", async () => {
  const credential = await runtimeCredential();
  const { fetcher, calls } = createFetcher((url) => {
    if (url.pathname === "/2.0/user/workspaces") {
      return jsonResponse({ values: [{ workspace: { slug: "acme", name: "Acme", uuid: "{ws-1}" } }] });
    }
    if (url.pathname === "/2.0/repositories/acme") {
      const page = Number(url.searchParams.get("page"));
      return jsonResponse({
        page,
        pagelen: 2,
        values: [
          {
            uuid: "{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}",
            slug: "skills",
            name: "Skills",
            full_name: "acme/skills",
            is_private: true,
            mainbranch: { name: "main" },
            workspace: { slug: "acme" },
            project: { key: "PLAT", name: "Platform" },
            links: {
              html: { href: "https://bitbucket.org/acme/skills" },
              clone: [
                { name: "https", href: "https://bitbucket.org/acme/skills.git" },
                { name: "ssh", href: "git@bitbucket.org:acme/skills.git" },
              ],
            },
          },
        ],
        ...(page === 1 ? { next: "https://evil.example/2.0/repositories/acme?page=2" } : {}),
      });
    }
    return jsonResponse({}, { status: 500 });
  });

  const provider = createProvider();
  const first = await provider.listRepositories(credential, { search: 'sk"ills', pageSize: 2 }, { fetcher });

  const repoCall = new URL(calls[1]?.url ?? "");
  assert.equal(repoCall.searchParams.get("role"), "member");
  assert.equal(repoCall.searchParams.get("pagelen"), "2");
  assert.equal(repoCall.searchParams.get("page"), "1");
  assert.equal(repoCall.searchParams.get("sort"), "full_name");
  assert.equal(repoCall.searchParams.get("q"), 'name ~ "sk\\"ills"');

  assert.equal(first.items.length, 1);
  assert.deepEqual(first.items[0], {
    providerRepositoryId: "{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}",
    provider: "bitbucket",
    host: "bitbucket.org",
    owner: "acme",
    project: "PLAT",
    name: "skills",
    fullName: "acme/skills",
    hierarchy: ["acme", "Platform"],
    defaultBranch: "main",
    webUrl: "https://bitbucket.org/acme/skills",
    cloneUrl: "https://bitbucket.org/acme/skills.git",
    isPrivate: true,
  });

  // The cursor carries only a page number, never the provider-supplied next URL.
  assert.ok(first.nextCursor);
  assert.doesNotMatch(Buffer.from(first.nextCursor, "base64url").toString("utf8"), /evil|https?:/);
  assert.deepEqual(decodeCursor(first.nextCursor, {}), { w: 0, page: 2 });

  const second = await provider.listRepositories(credential, { cursor: first.nextCursor, pageSize: 2 }, { fetcher });
  const secondCall = new URL(calls[3]?.url ?? "");
  assert.equal(secondCall.origin, "https://api.bitbucket.org");
  assert.equal(secondCall.searchParams.get("page"), "2");
  assert.equal(second.nextCursor, null);
});

test("escapeBitbucketQueryValue escapes quotes and backslashes", () => {
  assert.equal(escapeBitbucketQueryValue('a"b\\c'), 'a\\"b\\\\c');
});

test("listAccounts returns workspaces", async () => {
  const credential = await runtimeCredential();
  const { fetcher } = createFetcher(() =>
    jsonResponse({ values: [{ workspace: { slug: "acme", name: "Acme", uuid: "{ws-1}" } }] }),
  );
  const accounts = await createProvider().listAccounts?.(credential, { fetcher });
  assert.deepEqual(accounts, [{ id: "{ws-1}", name: "Acme", kind: "workspace" }]);
});

test("listTree follows same-origin pagination and maps entries", async () => {
  const credential = await runtimeCredential();
  const { fetcher, calls } = createFetcher((url) => {
    if (url.searchParams.get("page") === "2") {
      return jsonResponse({ values: [{ type: "commit_file", path: "skills/a/SKILL.md", size: 42 }] });
    }
    return jsonResponse({
      values: [
        { type: "commit_directory", path: "skills" },
        { type: "commit_directory", path: "skills/a" },
        { type: "commit_file", path: "README.md", size: 10 },
      ],
      next: `https://api.bitbucket.org/2.0/repositories/acme/skills/src/${COMMIT}/?page=2`,
    });
  });

  const entries = await createProvider().listTree(credential, locator, COMMIT, { fetcher, maxDepth: 5 });
  assert.equal(new URL(calls[0]?.url ?? "").pathname, `/2.0/repositories/acme/skills/src/${COMMIT}/`);
  assert.equal(new URL(calls[0]?.url ?? "").searchParams.get("max_depth"), "5");
  assert.equal(calls.length, 2);
  assert.deepEqual(
    entries.sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: "README.md", kind: "file", size: 10 },
      { path: "skills", kind: "dir" },
      { path: "skills/a", kind: "dir" },
      { path: "skills/a/SKILL.md", kind: "file", size: 42 },
    ],
  );
});

test("listTree walks directories Bitbucket did not expand", async () => {
  const credential = await runtimeCredential();
  const { fetcher, calls } = createFetcher((url) => {
    if (url.pathname.endsWith(`/src/${COMMIT}/skills/`)) {
      return jsonResponse({ values: [{ type: "commit_file", path: "skills/SKILL.md", size: 1 }] });
    }
    return jsonResponse({ values: [{ type: "commit_directory", path: "skills" }] });
  });

  const entries = await createProvider().listTree(credential, locator, COMMIT, { fetcher });
  assert.equal(calls.length, 2);
  assert.ok(entries.some((entry) => entry.path === "skills/SKILL.md"));
});

test("listTree refuses a next link on a foreign origin", async () => {
  const credential = await runtimeCredential();
  const { fetcher, calls } = createFetcher(() =>
    jsonResponse({
      values: [{ type: "commit_file", path: "README.md", size: 1 }],
      next: "https://evil.example/2.0/repositories/acme/skills/src/x/?page=2",
    }),
  );

  await assert.rejects(
    () => createProvider().listTree(credential, locator, COMMIT, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "INVALID_PROVIDER_RESPONSE",
  );
  assert.equal(calls.length, 1);
});

test("listTree enforces maxEntries", async () => {
  const credential = await runtimeCredential();
  const { fetcher } = createFetcher(() =>
    jsonResponse({
      values: [
        { type: "commit_file", path: "a", size: 1 },
        { type: "commit_file", path: "b", size: 1 },
        { type: "commit_file", path: "c", size: 1 },
      ],
    }),
  );

  await assert.rejects(
    () => createProvider().listTree(credential, locator, COMMIT, { fetcher, maxEntries: 2 }),
    (error: unknown) => error instanceof GitProviderError && error.code === "INDEX_FAILED" && error.status === 413,
  );
});

test("readFile fetches raw content with encoded path segments", async () => {
  const credential = await runtimeCredential();
  const { fetcher, calls } = createFetcher(() => new Response("# Skill\n", { status: 200 }));

  const content = await createProvider().readFile(credential, locator, COMMIT, "skills/my skill/SKILL.md", { fetcher });
  assert.equal(content.toString("utf8"), "# Skill\n");
  assert.equal(calls[0]?.url, `https://api.bitbucket.org/2.0/repositories/acme/skills/src/${COMMIT}/skills/my%20skill/SKILL.md`);
  assert.equal(headerOf(calls[0]?.init, "Authorization"), `Bearer ${sampleAccessToken}`);
});

test("resolveRevision returns the commit hash", async () => {
  const credential = await runtimeCredential();
  const { fetcher, calls } = createFetcher(() => jsonResponse({ hash: COMMIT }));
  const hash = await createProvider().resolveRevision(credential, locator, "feature/x", { fetcher });
  assert.equal(hash, COMMIT);
  assert.equal(calls[0]?.url, "https://api.bitbucket.org/2.0/repositories/acme/skills/commit/feature%2Fx");
});

test("401 maps to TOKEN_EXPIRED without retrying", async () => {
  const credential = await runtimeCredential();
  const { fetcher, calls } = createFetcher(() => jsonResponse({ type: "error" }, { status: 401 }));
  await assert.rejects(
    () => createProvider().getRepository(credential, locator, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "TOKEN_EXPIRED",
  );
  assert.equal(calls.length, 1);
});

test("403 maps to REPOSITORY_ACCESS_DENIED and validateRepositoryAccess reports it", async () => {
  const credential = await runtimeCredential();
  const { fetcher, calls } = createFetcher(() => jsonResponse({ type: "error" }, { status: 403 }));
  const result = await createProvider().validateRepositoryAccess(credential, locator, { fetcher });
  assert.equal(result.accessible, false);
  assert.equal(result.errorCode, "REPOSITORY_ACCESS_DENIED");
  assert.equal(calls.length, 1);
});

test("404 on a known repository maps to REPOSITORY_ACCESS_DENIED", async () => {
  const credential = await runtimeCredential();
  const { fetcher } = createFetcher(() => jsonResponse({ type: "error" }, { status: 404 }));
  await assert.rejects(
    () => createProvider().getRepository(credential, locator, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "REPOSITORY_ACCESS_DENIED",
  );
});

test("429 with retry-after 0 is retried", async () => {
  const credential = await runtimeCredential();
  let attempts = 0;
  const { fetcher } = createFetcher(() => {
    attempts += 1;
    if (attempts === 1) {
      return jsonResponse({ type: "error" }, { status: 429, headers: { "retry-after": "0" } });
    }
    return jsonResponse({
      uuid: "{repo}",
      slug: "skills",
      full_name: "acme/skills",
      is_private: false,
      mainbranch: { name: "trunk" },
    });
  });

  assert.equal(await createProvider().getDefaultBranch(credential, locator, { fetcher }), "trunk");
  assert.equal(attempts, 2);
});

test("inspectTokenPrivileges warns about write scopes only", async () => {
  const credential = await runtimeCredential();
  const provider = createProvider();
  const writeFetcher = createFetcher(() => jsonResponse({ uuid: "{u}" }, { headers: { "x-oauth-scopes": "account, repository:write" } }));
  const readFetcher = createFetcher(() => jsonResponse({ uuid: "{u}" }, { headers: { "x-oauth-scopes": "account, repository" } }));

  const warnings = await provider.inspectTokenPrivileges?.(credential, { fetcher: writeFetcher.fetcher });
  assert.equal(warnings?.length, 1);
  assert.match(warnings?.[0] ?? "", /repository:write/);
  assert.deepEqual(await provider.inspectTokenPrivileges?.(credential, { fetcher: readFetcher.fetcher }), []);
});

test("parseRepositoryUrl delegates to the Bitbucket URL parser", () => {
  const parsed = createProvider().parseRepositoryUrl("https://bitbucket.org/acme/skills.git");
  assert.equal(parsed?.owner, "acme");
  assert.equal(parsed?.name, "skills");
  assert.equal(createProvider().parseRepositoryUrl("https://github.com/acme/skills"), null);
});
