import assert from "node:assert/strict";
import test from "node:test";

import { GitProviderError } from "./errors.ts";
import { createAzureReposProvider } from "./providers/azure-repos.ts";
import { createBitbucketProvider } from "./providers/bitbucket.ts";
import { clearGitHubInstallationTokenCache, createGitHubProvider } from "./providers/github.ts";
import { createGitLabProvider } from "./providers/gitlab.ts";
import { SAMPLE_TOKENS } from "./testing/fixtures.ts";
import type { FetchLike, GitConnectionAuthType, GitProvider, ProviderCredential, RepositoryLocator } from "./types.ts";

/**
 * Provider contract tests (spec §37): every adapter is run against the same
 * behavioral contract with a scripted, deterministic provider API. External
 * integration tests against live providers are intentionally separate.
 */

const SHA = "b".repeat(40);
const SKILL_PATH = "tier1/standards/security/SKILL.md";
const SKILL_CONTENT = "# Security standard\n";

type Route = (url: URL, init: RequestInit | undefined) => Response | undefined;

type ContractFixture = {
  name: string;
  provider: GitProvider;
  authType: GitConnectionAuthType;
  host: string | null;
  accountScope?: string | undefined;
  locator: RepositoryLocator;
  expectedFullName: string;
  routes: Route;
  refresh?: { credential: ProviderCredential; host?: string | undefined; expectedAccessToken: string } | undefined;
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function scriptedFetch(routes: Route, override?: { status: number; headers?: Record<string, string> }): FetchLike {
  return async (input, init) => {
    const url = new URL(String(input));
    if (override && !/oauth|token|login/.test(url.pathname)) {
      return json({ message: "forced" }, override.status, override.headers ?? {});
    }
    return routes(url, init) ?? json({ message: "Not Found" }, 404);
  };
}

const fixtures: ContractFixture[] = [
  {
    name: "GitHub",
    provider: createGitHubProvider({ env: { NODE_ENV: "test" } }),
    authType: "pat",
    host: null,
    locator: { provider: "github", host: "github.com", owner: "acme", name: "skills", fullName: "acme/skills", providerRepositoryId: "901" },
    expectedFullName: "acme/skills",
    routes: (url) => {
      const repo = { id: 901, name: "skills", full_name: "acme/skills", private: true, default_branch: "main", owner: { login: "acme" } };
      if (url.pathname === "/user/repos") return json([repo]);
      if (url.pathname === "/repositories/901" || url.pathname === "/repos/acme/skills") return json(repo);
      if (url.pathname === "/repos/acme/skills/commits/main") return new Response(SHA);
      if (url.pathname === `/repos/acme/skills/git/trees/${SHA}`) return json({ truncated: false, tree: [{ path: "tier1", type: "tree" }, { path: SKILL_PATH, type: "blob", size: 20 }] });
      if (url.pathname === `/repos/acme/skills/contents/${SKILL_PATH}`) return new Response(SKILL_CONTENT);
      return undefined;
    },
  },
  {
    name: "GitLab",
    provider: createGitLabProvider({ env: { NODE_ENV: "test", GITLAB_OAUTH_CLIENT_ID: "sample-gitlab-client", GITLAB_OAUTH_CLIENT_SECRET: SAMPLE_TOKENS.clientSecret } }),
    authType: "oauth",
    host: "gitlab.com",
    locator: { provider: "gitlab", host: "gitlab.com", owner: "group/sub", name: "skills", fullName: "group/sub/skills", providerRepositoryId: "55" },
    expectedFullName: "group/sub/skills",
    routes: (url, init) => {
      const project = { id: 55, path: "skills", path_with_namespace: "group/sub/skills", namespace: { full_path: "group/sub" }, default_branch: "main", visibility: "private" };
      if (url.pathname === "/oauth/token" && init?.method === "POST") return json({ access_token: SAMPLE_TOKENS.refreshed, refresh_token: `${SAMPLE_TOKENS.refresh}-rotated`, expires_in: 7200, created_at: Math.floor(Date.now() / 1000) });
      if (url.pathname === "/api/v4/projects") return json([project]);
      if (url.pathname === "/api/v4/projects/55") return json(project);
      if (url.pathname === "/api/v4/projects/55/repository/commits/main") return json({ id: SHA });
      if (url.pathname === "/api/v4/projects/55/repository/tree") return json([{ path: "tier1", type: "tree" }, { path: SKILL_PATH, type: "blob" }]);
      if (url.pathname === `/api/v4/projects/55/repository/files/${encodeURIComponent(SKILL_PATH)}/raw` || decodeURIComponent(url.pathname) === `/api/v4/projects/55/repository/files/${SKILL_PATH}/raw`) return new Response(SKILL_CONTENT);
      return undefined;
    },
    refresh: { credential: { accessToken: SAMPLE_TOKENS.expired, refreshToken: SAMPLE_TOKENS.refresh }, host: "gitlab.com", expectedAccessToken: SAMPLE_TOKENS.refreshed },
  },
  {
    name: "Bitbucket",
    provider: createBitbucketProvider({ env: { NODE_ENV: "test", BITBUCKET_OAUTH_CLIENT_ID: "sample-bitbucket-client", BITBUCKET_OAUTH_CLIENT_SECRET: SAMPLE_TOKENS.clientSecret } }),
    authType: "oauth",
    host: "bitbucket.org",
    locator: { provider: "bitbucket", host: "bitbucket.org", owner: "ws", name: "skills", fullName: "ws/skills", providerRepositoryId: "{00000000-0000-4000-8000-000000000001}" },
    expectedFullName: "ws/skills",
    routes: (url, init) => {
      const repo = { uuid: "{00000000-0000-4000-8000-000000000001}", name: "skills", slug: "skills", full_name: "ws/skills", is_private: true, mainbranch: { name: "main" }, workspace: { slug: "ws" } };
      if (url.host === "bitbucket.org" && url.pathname === "/site/oauth2/access_token" && init?.method === "POST") return json({ access_token: SAMPLE_TOKENS.refreshed, refresh_token: SAMPLE_TOKENS.refresh, expires_in: 7200, scopes: "repository account" });
      if (url.pathname === "/2.0/user/workspaces") return json({ values: [{ workspace: { slug: "ws", name: "WS", uuid: "{w}" } }] });
      if (url.pathname === "/2.0/repositories/ws") return json({ values: [repo], page: 1 });
      if (url.pathname === "/2.0/repositories/ws/skills") return json(repo);
      if (url.pathname === "/2.0/repositories/ws/skills/commit/main") return json({ hash: SHA });
      if (url.pathname === `/2.0/repositories/ws/skills/src/${SHA}/`) return json({ values: [{ type: "commit_directory", path: "tier1" }, { type: "commit_file", path: SKILL_PATH, size: 20 }] });
      if (decodeURIComponent(url.pathname) === `/2.0/repositories/ws/skills/src/${SHA}/${SKILL_PATH}`) return new Response(SKILL_CONTENT);
      if (url.pathname.startsWith(`/2.0/repositories/ws/skills/src/${SHA}/tier1`)) return json({ values: [{ type: "commit_file", path: SKILL_PATH, size: 20 }] });
      return undefined;
    },
    refresh: { credential: { accessToken: SAMPLE_TOKENS.expired, refreshToken: SAMPLE_TOKENS.refresh }, expectedAccessToken: SAMPLE_TOKENS.refreshed },
  },
  {
    name: "Azure Repos",
    provider: createAzureReposProvider({ env: { NODE_ENV: "test", AZURE_DEVOPS_ENTRA_CLIENT_ID: "sample-azure-client", AZURE_DEVOPS_ENTRA_CLIENT_SECRET: SAMPLE_TOKENS.clientSecret } }),
    authType: "pat",
    host: "dev.azure.com",
    accountScope: "contoso",
    locator: { provider: "azure", host: "dev.azure.com", owner: "contoso", project: "Platform", name: "skills", fullName: "contoso/Platform/skills", providerRepositoryId: "11111111-2222-4333-8444-555555555555" },
    expectedFullName: "contoso/Platform/skills",
    routes: (url, init) => {
      const repo = { id: "11111111-2222-4333-8444-555555555555", name: "skills", defaultBranch: "refs/heads/main", project: { id: "p1", name: "Platform", visibility: "private" }, webUrl: "https://dev.azure.com/contoso/Platform/_git/skills" };
      const base = "/contoso/Platform/_apis/git/repositories/11111111-2222-4333-8444-555555555555";
      if (url.host === "login.microsoftonline.com" && init?.method === "POST") return json({ access_token: SAMPLE_TOKENS.refreshed, refresh_token: SAMPLE_TOKENS.refresh, expires_in: 3600, scope: "vso.code" });
      if (url.pathname === "/contoso/_apis/git/repositories") return json({ value: [repo], count: 1 });
      if (url.pathname === base && !url.search.includes("path=")) return json(repo);
      if (url.pathname === `${base}/refs`) return json({ value: [{ name: "refs/heads/main", objectId: SHA }] });
      if (url.pathname === `${base}/items` && url.searchParams.get("recursionLevel") === "Full") return json({ value: [{ path: "/", isFolder: true }, { path: "/tier1", isFolder: true }, { path: `/${SKILL_PATH}`, isFolder: false, gitObjectType: "blob" }] });
      if (url.pathname === `${base}/items` && url.searchParams.get("path")) return new Response(SKILL_CONTENT);
      return undefined;
    },
    refresh: { credential: { accessToken: SAMPLE_TOKENS.expired, refreshToken: SAMPLE_TOKENS.refresh }, expectedAccessToken: SAMPLE_TOKENS.refreshed },
  },
];

async function runtimeFor(fixture: ContractFixture) {
  return fixture.provider.createRuntimeCredential({
    connectionId: "conn-contract",
    organizationId: "org-contract",
    authType: fixture.authType,
    host: fixture.host,
    installationId: null,
    accountScope: fixture.accountScope ?? null,
    credential: { accessToken: SAMPLE_TOKENS.valid },
  });
}

for (const fixture of fixtures) {
  test(`${fixture.name} contract: lists and retrieves repositories with canonical ids`, async () => {
    const credential = await runtimeFor(fixture);
    const context = { fetcher: scriptedFetch(fixture.routes) };
    const page = await fixture.provider.listRepositories(credential, { pageSize: 10 }, context);
    assert.equal(page.items[0]?.fullName, fixture.expectedFullName);
    assert.equal(page.items[0]?.providerRepositoryId, fixture.locator.providerRepositoryId);
    assert.ok((page.items[0]?.hierarchy.length ?? 0) >= 1);

    const repository = await fixture.provider.getRepository(credential, fixture.locator, context);
    assert.equal(repository.fullName, fixture.expectedFullName);
    assert.equal(repository.isPrivate, true);
    assert.equal(await fixture.provider.getDefaultBranch(credential, fixture.locator, context), "main");
  });

  test(`${fixture.name} contract: resolves revisions, lists the tree, and reads files`, async () => {
    const credential = await runtimeFor(fixture);
    const context = { fetcher: scriptedFetch(fixture.routes) };
    assert.equal(await fixture.provider.resolveRevision(credential, fixture.locator, "main", context), SHA);
    const tree = await fixture.provider.listTree(credential, fixture.locator, SHA, context);
    assert.ok(tree.some((entry) => entry.path === SKILL_PATH && entry.kind === "file"), `tree: ${JSON.stringify(tree)}`);
    const content = await fixture.provider.readFile(credential, fixture.locator, SHA, SKILL_PATH, context);
    assert.equal(content.toString("utf8"), SKILL_CONTENT);
  });

  for (const [status, expected, headers] of [
    [401, ["TOKEN_EXPIRED", "AUTH_REQUIRED"], {}],
    [403, ["REPOSITORY_ACCESS_DENIED", "INSUFFICIENT_SCOPE"], {}],
    [404, ["REPOSITORY_ACCESS_DENIED"], {}],
    [429, ["PROVIDER_RATE_LIMITED"], { "retry-after": "0" }],
  ] as const) {
    test(`${fixture.name} contract: normalizes HTTP ${status}`, async () => {
      const credential = await runtimeFor(fixture);
      await assert.rejects(
        () => fixture.provider.getRepository(credential, fixture.locator, { fetcher: scriptedFetch(fixture.routes, { status, headers }) }),
        (error: unknown) => error instanceof GitProviderError && (expected as readonly string[]).includes(error.code),
      );
      const access = await fixture.provider.validateRepositoryAccess(credential, fixture.locator, { fetcher: scriptedFetch(fixture.routes, { status: status === 429 ? 404 : status }) });
      assert.equal(access.accessible, false);
    });
  }

  test(`${fixture.name} contract: handles credential refresh`, async () => {
    if (!fixture.refresh) {
      // GitHub Apps mint short-lived installation tokens on demand instead of refreshing.
      assert.equal(fixture.provider.capabilities.supportsRefresh, false);
      clearGitHubInstallationTokenCache();
      return;
    }
    assert.ok(fixture.provider.refreshCredential);
    const refreshed = await fixture.provider.refreshCredential(fixture.refresh.credential, {
      fetcher: scriptedFetch(fixture.routes),
      ...(fixture.refresh.host ? { host: fixture.refresh.host } : {}),
    });
    assert.equal(refreshed.accessToken, fixture.refresh.expectedAccessToken);
    assert.ok(refreshed.refreshToken);
  });
}

test("every provider requests read-only access and never write/admin scopes", () => {
  for (const fixture of fixtures) {
    const requested = fixture.provider.requestedAccess.join(" ").toLowerCase();
    assert.ok(!/write|admin|delete|\bapi\b(?!_)/.test(requested.replace("read_api", "")), `${fixture.name} requests ${requested}`);
  }
});
