import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedRepositoryLocator } from "./repository-provider.ts";
import { parseRepositoryLocator } from "./repository-provider.ts";
import {
  createGitLabRepository,
  createGitLabRepositoryCommit,
  registerGitLabRepositoryWebhook,
} from "./repository-provider-gitlab-write.ts";

function createGitLabLocator(url: string): ParsedRepositoryLocator {
  const locator = parseRepositoryLocator({
    provider: "gitlab",
    repoUrl: url,
  });

  assert.ok(locator);
  return locator;
}

test("createGitLabRepository creates a repository in the resolved namespace", async () => {
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = `${input}`;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ url, method, body });

    if (url === "https://gitlab.example.com/api/v4/namespaces/team%2Fplatform" && method === "GET") {
      return Response.json({
        id: 99,
        full_path: "team/platform",
      });
    }

    if (url === "https://gitlab.example.com/api/v4/projects" && method === "POST") {
      return Response.json({
        id: 42,
        name: "finance-skills",
        path_with_namespace: "team/platform/finance-skills",
        default_branch: "main",
        visibility: "private",
        web_url: "https://gitlab.example.com/team/platform/finance-skills",
      });
    }

    if (url === "https://gitlab.example.com/api/v4/projects/team%2Fplatform%2Ffinance-skills" && method === "GET") {
      return Response.json({
        id: 42,
        name: "finance-skills",
        path_with_namespace: "team/platform/finance-skills",
        name_with_namespace: "Team / Platform / Finance Skills",
        default_branch: "main",
        visibility: "private",
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const result = await createGitLabRepository({
    owner: "team/platform",
    name: "finance-skills",
    defaultBranch: "main",
    description: "Tenant-owned Savant skills",
    visibility: "private",
    baseUrl: "https://gitlab.example.com",
  }, {
    fetcher,
  });

  assert.equal(result.normalizedUrl, "https://gitlab.example.com/team/platform/finance-skills");
  assert.equal(result.defaultBranch, "main");
  assert.equal(result.displayName, "team/platform/finance-skills");
  assert.equal(result.visibility, "private");
  assert.deepEqual(requests[1]?.body, {
    name: "finance-skills",
    path: "finance-skills",
    namespace_id: 99,
    description: "Tenant-owned Savant skills",
    visibility: "private",
    initialize_with_readme: true,
    default_branch: "main",
  });
});

test("createGitLabRepositoryCommit maps file writes to create and update actions", async () => {
  const locator = createGitLabLocator("https://gitlab.example.com/team/platform/finance-skills");
  let commitBody: Record<string, unknown> | null = null;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = `${input}`;
    const method = init?.method ?? "GET";

    if (
      url === "https://gitlab.example.com/api/v4/projects/team%2Fplatform%2Ffinance-skills/repository/tree?page=1&per_page=100&recursive=true&ref=main"
      && method === "GET"
    ) {
      return new Response(JSON.stringify([
        { path: "registry/skills.yaml", type: "blob" },
        { path: "skills", type: "tree" },
      ]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (
      url === "https://gitlab.example.com/api/v4/projects/team%2Fplatform%2Ffinance-skills/repository/commits"
      && method === "POST"
    ) {
      commitBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return Response.json({
        id: "abc123def456",
        committed_date: "2026-01-01T00:00:00.000Z",
        web_url: "https://gitlab.example.com/team/platform/finance-skills/-/commit/abc123def456",
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const result = await createGitLabRepositoryCommit(locator, {
    branch: "main",
    message: "Bootstrap Savant repository",
    files: [
      {
        path: "registry/skills.yaml",
        content: "skills: []\n",
      },
      {
        path: "tier1/README.md",
        content: "# Tier 1\n",
      },
    ],
  }, {
    fetcher,
  });

  assert.equal(result.commitSha, "abc123def456");
  assert.equal(result.url, "https://gitlab.example.com/team/platform/finance-skills/-/commit/abc123def456");
  assert.deepEqual(result.changedPaths, ["registry/skills.yaml", "tier1/README.md"]);
  assert.ok(commitBody);
  const commitRequest = commitBody as {
    branch: string;
    commit_message: string;
    actions: unknown[];
  };

  assert.equal(commitRequest.branch, "main");
  assert.equal(commitRequest.commit_message, "Bootstrap Savant repository");
  assert.deepEqual(commitRequest.actions, [
    {
      action: "update",
      file_path: "registry/skills.yaml",
      content: "skills: []\n",
      encoding: "text",
    },
    {
      action: "create",
      file_path: "tier1/README.md",
      content: "# Tier 1\n",
      encoding: "text",
    },
  ]);
});

test("registerGitLabRepositoryWebhook creates a push hook with token verification", async () => {
  const locator = createGitLabLocator("https://gitlab.example.com/team/platform/finance-skills");
  const hookValue = "gitlab-hook-validation-value";
  let webhookBody: Record<string, unknown> | null = null;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = `${input}`;
    const method = init?.method ?? "GET";

    if (
      url === "https://gitlab.example.com/api/v4/projects/team%2Fplatform%2Ffinance-skills/hooks"
      && method === "POST"
    ) {
      webhookBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return Response.json({
        id: 17,
        url: "https://app.savantrepo.com/api/repositories/webhooks/17",
        push_events: true,
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const result = await registerGitLabRepositoryWebhook(locator, {
    callbackUrl: "https://app.savantrepo.com/api/repositories/webhooks/17",
    secretRef: "REPOSITORY_WEBHOOK_SECRET",
    events: ["push"],
  }, {
    fetcher,
    env: {
      REPOSITORY_WEBHOOK_SECRET: hookValue,
    },
  });

  assert.equal(result.id, "17");
  assert.equal(result.url, "https://app.savantrepo.com/api/repositories/webhooks/17");
  assert.deepEqual(result.events, ["push"]);
  assert.equal(result.secretRef, "REPOSITORY_WEBHOOK_SECRET");
  assert.deepEqual(webhookBody, {
    url: "https://app.savantrepo.com/api/repositories/webhooks/17",
    push_events: true,
    enable_ssl_verification: true,
    token: hookValue,
  });
});
