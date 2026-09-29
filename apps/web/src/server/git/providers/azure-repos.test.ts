import assert from "node:assert/strict";
import test from "node:test";

import { GitProviderError } from "../errors.ts";
import { AZURE_DEVOPS_RESOURCE_ID, type AzureEntraConfig } from "../provider-config.ts";
import type { FetchLike, RepositoryLocator, RuntimeCredential } from "../types.ts";
import { createAzureReposProvider } from "./azure-repos.ts";

const clientId = "11111111-2222-3333-4444-555555555555";
const tenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const objectId = "99999999-8888-7777-6666-555555555555";
const accessToken = "sample-azure-access-token";
const refreshToken = "sample-azure-refresh-token";
const patValue = "sample-azure-pat-dummy";

const config: AzureEntraConfig = {
  clientId,
  clientSecret: "sample-azure-client-secret",
  tenant: "organizations",
  scopes: [`${AZURE_DEVOPS_RESOURCE_ID}/vso.code`, "offline_access", "openid", "profile"],
};

const fixedNow = Date.parse("2026-09-29T12:00:00.000Z");

function createProvider() {
  return createAzureReposProvider({ config, now: () => fixedNow });
}

type Call = { url: string; init: RequestInit | undefined };
type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function createFetcher(handler: Handler): { fetcher: FetchLike; calls: Call[] } {
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
  return headers[name];
}

function buildIdToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.sig`;
}

async function oauthCredential(): Promise<RuntimeCredential> {
  return createProvider().createRuntimeCredential({
    connectionId: "conn_1",
    organizationId: "org_1",
    authType: "oauth",
    host: null,
    installationId: null,
    credential: { accessToken },
  });
}

async function patCredential(accountScope = "contoso"): Promise<RuntimeCredential> {
  return createProvider().createRuntimeCredential({
    connectionId: "conn_2",
    organizationId: "org_1",
    authType: "pat",
    host: null,
    installationId: null,
    accountScope,
    credential: { accessToken: patValue },
  });
}

const locator: RepositoryLocator = {
  provider: "azure",
  host: "dev.azure.com",
  owner: "contoso",
  project: "Platform",
  name: "api",
  fullName: "contoso/Platform/api",
  providerRepositoryId: "repo-guid-1",
};

function azureRepo(id: string, project: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    defaultBranch: "refs/heads/main",
    webUrl: `https://dev.azure.com/x/${project}/_git/${name}`,
    remoteUrl: `https://x@dev.azure.com/x/${project}/_git/${name}`,
    project: { id: `p-${project}`, name: project, visibility: "private" },
    ...extra,
  };
}

test("authorization URL uses Entra v2 with PKCE, tenant and the Azure DevOps resource scope", async () => {
  const url = new URL(await createProvider().getAuthorizationUrl({
    state: "state-value",
    redirectUri: "https://app.example.com/api/git/connections/azure/callback",
    codeChallenge: "challenge-value",
  }));

  assert.equal(url.origin, "https://login.microsoftonline.com");
  assert.equal(url.pathname, "/organizations/oauth2/v2.0/authorize");
  assert.equal(url.searchParams.get("client_id"), clientId);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("response_mode"), "query");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const scopes = (url.searchParams.get("scope") ?? "").split(" ");
  assert.ok(scopes.includes(`${AZURE_DEVOPS_RESOURCE_ID}/vso.code`));
  assert.ok(scopes.includes("offline_access"));

  await assert.rejects(
    createProvider().getAuthorizationUrl({ state: "s", redirectUri: "https://app.example.com/cb" }),
    (error: unknown) => error instanceof GitProviderError && error.code === "AUTHORIZATION_STATE_INVALID",
  );
});

test("completeAuthorization exchanges the code and decodes tid/oid from the id_token", async () => {
  const idToken = buildIdToken({ tid: tenantId, oid: objectId, aud: clientId, name: "Ada Lovelace", preferred_username: "ada@contoso.com" });
  const { fetcher, calls } = createFetcher((url) => {
    if (url.hostname === "login.microsoftonline.com") {
      return jsonResponse({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        token_type: "Bearer",
        scope: `${AZURE_DEVOPS_RESOURCE_ID}/vso.code`,
        id_token: idToken,
      });
    }
    if (url.pathname === "/_apis/profile/profiles/me") {
      return jsonResponse({ id: "member-1", displayName: "Ada L.", emailAddress: "ada@contoso.com" });
    }
    return jsonResponse({}, 404);
  });

  const result = await createProvider().completeAuthorization(
    new URLSearchParams({ code: "sample-auth-code", state: "s" }),
    { redirectUri: "https://app.example.com/api/git/connections/azure/callback", codeVerifier: "sample-verifier" },
    { fetcher },
  );

  const tokenCall = calls[0];
  assert.ok(tokenCall);
  assert.equal(tokenCall.url, "https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
  const form = new URLSearchParams(String(tokenCall.init?.body));
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "sample-auth-code");
  assert.equal(form.get("code_verifier"), "sample-verifier");
  assert.equal(form.get("client_id"), clientId);
  assert.ok(form.get("scope")?.includes(`${AZURE_DEVOPS_RESOURCE_ID}/vso.code`));

  const profileCall = calls[1];
  assert.ok(profileCall);
  assert.equal(profileCall.url, "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1");
  assert.equal(headerOf(profileCall.init, "Authorization"), `Bearer ${accessToken}`);

  assert.equal(result.authType, "oauth");
  assert.equal(result.accountId, `${tenantId}:${objectId}`);
  assert.equal(result.accountName, "Ada L.");
  assert.equal(result.host, "dev.azure.com");
  assert.deepEqual(result.identity, {
    id: "member-1",
    login: "ada@contoso.com",
    displayName: "Ada L.",
    attributes: { tenantId, objectId },
  });
  assert.equal(result.credential?.accessToken, accessToken);
  assert.equal(result.credential?.refreshToken, refreshToken);
  assert.equal(result.credential?.expiresAt, new Date(fixedNow + 3600 * 1000).toISOString());
  assert.deepEqual(result.scopes, [`${AZURE_DEVOPS_RESOURCE_ID}/vso.code`]);
});

test("completeAuthorization surfaces a sanitized provider error", async () => {
  await assert.rejects(
    createProvider().completeAuthorization(
      new URLSearchParams({ error: "access_denied", error_description: `AADSTS65004: User declined.\n${"x".repeat(1000)}` }),
      { redirectUri: "https://app.example.com/cb" },
    ),
    (error: unknown) =>
      error instanceof GitProviderError
      && error.code === "AUTH_REQUIRED"
      && error.message.includes("AADSTS65004")
      && !error.message.includes("\n")
      && error.message.length < 500,
  );
});

test("refreshCredential keeps a rotated refresh token, else the previous one", async () => {
  let rotate = true;
  const { fetcher, calls } = createFetcher(() => jsonResponse({
    access_token: "sample-azure-access-token-2",
    expires_in: 3600,
    ...(rotate ? { refresh_token: "sample-azure-refresh-token-2" } : {}),
  }));
  const provider = createProvider();

  const rotated = await provider.refreshCredential?.({ accessToken, refreshToken }, { fetcher });
  assert.equal(rotated?.accessToken, "sample-azure-access-token-2");
  assert.equal(rotated?.refreshToken, "sample-azure-refresh-token-2");
  const form = new URLSearchParams(String(calls[0]?.init?.body));
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), refreshToken);
  assert.ok(form.get("scope")?.includes(`${AZURE_DEVOPS_RESOURCE_ID}/vso.code`));

  rotate = false;
  const kept = await provider.refreshCredential?.({ accessToken, refreshToken }, { fetcher });
  assert.equal(kept?.refreshToken, refreshToken);
});

test("refreshCredential maps invalid_grant to TOKEN_REVOKED", async () => {
  const { fetcher, calls } = createFetcher(() => jsonResponse({ error: "invalid_grant", error_description: "AADSTS70008" }, 400));
  await assert.rejects(
    createProvider().refreshCredential?.({ accessToken, refreshToken }, { fetcher }) ?? Promise.resolve(),
    (error: unknown) => error instanceof GitProviderError && error.code === "TOKEN_REVOKED",
  );
  assert.equal(calls.length, 1);
});

test("listRepositories paginates across organizations with search and skips disabled repos", async () => {
  const { fetcher, calls } = createFetcher((url) => {
    if (url.pathname === "/_apis/profile/profiles/me") {
      return jsonResponse({ id: "member-1", displayName: "Ada" });
    }
    if (url.pathname === "/_apis/accounts") {
      assert.equal(url.searchParams.get("memberId"), "member-1");
      return jsonResponse({ count: 3, value: [{ accountId: "a2", accountName: "fabrikam" }, { accountId: "a1", accountName: "contoso" }, { accountId: "a3", accountName: "evil/../x" }] });
    }
    if (url.pathname === "/contoso/_apis/git/repositories") {
      return jsonResponse({ value: [
        azureRepo("c1", "Platform", "api"),
        azureRepo("c2", "Platform", "web"),
        azureRepo("c3", "Platform", "legacy", { isDisabled: true }),
        azureRepo("c4", "Tools", "cli", { project: { name: "Tools", visibility: "public" } }),
      ] });
    }
    if (url.pathname === "/fabrikam/_apis/git/repositories") {
      return jsonResponse({ value: [azureRepo("f1", "Core", "api", { defaultBranch: undefined })] });
    }
    return jsonResponse({}, 404);
  });
  const provider = createProvider();
  const credential = await oauthCredential();

  const first = await provider.listRepositories(credential, { pageSize: 2 }, { fetcher });
  assert.deepEqual(first.items.map((repo) => repo.fullName), ["contoso/Platform/api", "contoso/Platform/web"]);
  assert.ok(first.nextCursor);
  const decoded = JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(decoded).sort(), ["offset", "orgIndex"]);
  assert.ok(!first.nextCursor.includes("http"));

  const second = await provider.listRepositories(credential, { pageSize: 2, cursor: first.nextCursor }, { fetcher });
  assert.deepEqual(second.items.map((repo) => repo.fullName), ["contoso/Tools/cli", "fabrikam/Core/api"]);
  assert.equal(second.nextCursor, null);
  const cli = second.items[0];
  assert.equal(cli?.isPrivate, false);
  assert.deepEqual(cli?.hierarchy, ["contoso", "Tools"]);
  assert.equal(cli?.providerRepositoryId, "c4");
  assert.equal(second.items[1]?.defaultBranch, null);

  const searched = await provider.listRepositories(credential, { search: "API" }, { fetcher });
  assert.deepEqual(searched.items.map((repo) => repo.fullName), ["contoso/Platform/api", "fabrikam/Core/api"]);
  assert.equal(searched.items[0]?.defaultBranch, "main");
  assert.equal(searched.items[0]?.isPrivate, true);

  assert.ok(calls.every((call) => !call.url.includes("evil")), "invalid organization names are never requested");
});

test("listTree strips leading slashes, skips the root and enforces maxEntries", async () => {
  const { fetcher, calls } = createFetcher(() => jsonResponse({ value: [
    { path: "/", isFolder: true, gitObjectType: "tree" },
    { path: "/src", isFolder: true, gitObjectType: "tree" },
    { path: "/src/index.ts", gitObjectType: "blob" },
    { path: "/README.md", gitObjectType: "blob" },
    { path: "/vendor/lib", gitObjectType: "commit" },
  ] }));
  const provider = createProvider();
  const credential = await oauthCredential();
  const sha = "a".repeat(40);

  const entries = await provider.listTree(credential, locator, sha, { fetcher });
  assert.deepEqual(entries, [
    { path: "src", kind: "dir" },
    { path: "src/index.ts", kind: "file" },
    { path: "README.md", kind: "file" },
  ]);
  const url = new URL(calls[0]?.url ?? "");
  assert.equal(url.pathname, "/contoso/Platform/_apis/git/repositories/repo-guid-1/items");
  assert.equal(url.searchParams.get("recursionLevel"), "Full");
  assert.equal(url.searchParams.get("versionDescriptor.version"), sha);
  assert.equal(url.searchParams.get("versionDescriptor.versionType"), "commit");

  const shallow = await provider.listTree(credential, locator, sha, { fetcher, maxDepth: 1 });
  assert.deepEqual(shallow.map((entry) => entry.path), ["src", "README.md"]);

  await assert.rejects(
    provider.listTree(credential, locator, sha, { fetcher, maxEntries: 2 }),
    (error: unknown) => error instanceof GitProviderError && error.code === "INDEX_FAILED" && error.status === 413,
  );
});

test("readFile downloads raw bytes for a commit", async () => {
  const { fetcher, calls } = createFetcher(() => new Response("hello azure", { status: 200, headers: { "content-type": "application/octet-stream" } }));
  const credential = await oauthCredential();
  const body = await createProvider().readFile(credential, locator, "b".repeat(40), "docs/SKILL.md", { fetcher, maxBytes: 1024 });
  assert.equal(body.toString("utf8"), "hello azure");
  const url = new URL(calls[0]?.url ?? "");
  assert.equal(url.searchParams.get("path"), "/docs/SKILL.md");
  assert.equal(url.searchParams.get("$format"), "octetStream");
  assert.equal(url.searchParams.get("versionDescriptor.versionType"), "commit");

  await assert.rejects(
    createProvider().readFile(credential, locator, "b".repeat(40), "docs/SKILL.md", { fetcher, maxBytes: 4 }),
    (error: unknown) => error instanceof GitProviderError && error.status === 413,
  );
});

test("PAT runtime credential uses basic auth scoped to the organization", async () => {
  const credential = await patCredential();
  assert.equal(credential.scheme, "basic");
  assert.equal(credential.accountScope, "contoso");
  assert.equal(credential.apiBaseUrl, "https://dev.azure.com");

  const { fetcher, calls } = createFetcher((url) => {
    if (url.pathname === "/contoso/_apis/connectionData") {
      return jsonResponse({ authenticatedUser: { id: "user-1", providerDisplayName: "Ada", properties: { Account: { $value: "ada@contoso.com" } } } });
    }
    return jsonResponse({ value: [azureRepo("c1", "Platform", "api")] });
  });
  const provider = createProvider();
  const identity = await provider.getIdentity(credential, { fetcher });
  assert.equal(identity.login, "ada@contoso.com");
  assert.equal(headerOf(calls[0]?.init, "Authorization"), `Basic ${Buffer.from(`:${patValue}`).toString("base64")}`);

  assert.deepEqual(await provider.listAccounts?.(credential, { fetcher }), [{ id: "contoso", name: "contoso", kind: "azure_organization" }]);
  const repos = await provider.listRepositories(credential, {}, { fetcher });
  assert.deepEqual(repos.items.map((repo) => repo.fullName), ["contoso/Platform/api"]);

  const warnings = await provider.inspectTokenPrivileges?.(credential, { fetcher });
  assert.ok(warnings?.[0]?.includes("Code (Read)"));

  await assert.rejects(patCredential("evil/../x"), (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_HOST_REJECTED");
});

test("401 maps to TOKEN_EXPIRED without retrying", async () => {
  const { fetcher, calls } = createFetcher(() => jsonResponse({ message: "unauthorized" }, 401));
  await assert.rejects(
    createProvider().getIdentity(await oauthCredential(), { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "TOKEN_EXPIRED",
  );
  assert.equal(calls.length, 1);
});

test("203 HTML sign-in responses map to TOKEN_EXPIRED", async () => {
  const { fetcher } = createFetcher(() => new Response("<html>Sign in</html>", { status: 203, headers: { "content-type": "text/html" } }));
  const result = await createProvider().validateRepositoryAccess(await oauthCredential(), locator, { fetcher });
  assert.equal(result.accessible, false);
  assert.equal(result.errorCode, "TOKEN_EXPIRED");
});

test("404 for a known repository maps to REPOSITORY_ACCESS_DENIED", async () => {
  const { fetcher, calls } = createFetcher(() => jsonResponse({ message: "TF401019" }, 404));
  const result = await createProvider().validateRepositoryAccess(await oauthCredential(), locator, { fetcher });
  assert.equal(result.accessible, false);
  assert.equal(result.errorCode, "REPOSITORY_ACCESS_DENIED");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]?.url ?? "").pathname, "/contoso/Platform/_apis/git/repositories/repo-guid-1");
});

test("429 is retried honoring retry-after", async () => {
  let attempts = 0;
  const { fetcher } = createFetcher(() => {
    attempts += 1;
    return attempts === 1
      ? jsonResponse({ message: "slow down" }, 429, { "retry-after": "0" })
      : jsonResponse(azureRepo("repo-guid-1", "Platform", "api"));
  });
  const repository = await createProvider().getRepository(await oauthCredential(), locator, { fetcher });
  assert.equal(attempts, 2);
  assert.equal(repository.fullName, "contoso/Platform/api");
  assert.equal(repository.defaultBranch, "main");
});

test("resolveRevision resolves branches via refs and passes SHAs through", async () => {
  const sha = "c".repeat(40);
  const { fetcher, calls } = createFetcher((url) => {
    if (url.pathname.endsWith("/refs")) {
      assert.equal(url.searchParams.get("filter"), "heads/main");
      return jsonResponse({ value: [{ name: "refs/heads/main-old", objectId: "d".repeat(40) }, { name: "refs/heads/main", objectId: sha }] });
    }
    return jsonResponse({}, 404);
  });
  const provider = createProvider();
  const credential = await oauthCredential();
  assert.equal(await provider.resolveRevision(credential, locator, "main", { fetcher }), sha);
  assert.equal(await provider.resolveRevision(credential, locator, "E".repeat(40), { fetcher }), "e".repeat(40));
  assert.equal(calls.length, 1);
});

test("organization name injection is rejected before any request", async () => {
  const { fetcher, calls } = createFetcher(() => jsonResponse({}));
  const credential = await oauthCredential();
  await assert.rejects(
    createProvider().getRepository(credential, { ...locator, owner: "evil/../x" }, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "PROVIDER_HOST_REJECTED",
  );
  assert.equal(calls.length, 0);
});

test("parseRepositoryUrl and configuration", () => {
  const provider = createProvider();
  const parsed = provider.parseRepositoryUrl("https://dev.azure.com/contoso/Platform/_git/api");
  assert.equal(parsed?.owner, "contoso");
  assert.equal(parsed?.project, "Platform");
  assert.equal(parsed?.name, "api");
  assert.equal(provider.isConfigured(), true);
  assert.equal(provider.configurationHint(), null);

  const unconfigured = createAzureReposProvider({ env: {} });
  assert.equal(unconfigured.isConfigured(), false);
  assert.match(unconfigured.configurationHint() ?? "", /AZURE_DEVOPS_ENTRA_CLIENT_ID/);
});
