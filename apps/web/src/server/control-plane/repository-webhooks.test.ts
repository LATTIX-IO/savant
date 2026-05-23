import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  parseGitHubRepositoryWebhookEvent,
  parseGitLabRepositoryWebhookEvent,
  RepositoryWebhookError,
  resolveRepositoryWebhookPublicBaseUrl,
  verifyGitHubWebhookSignature,
  verifyGitLabWebhookToken,
} from "./repository-webhooks.ts";

const hookSignatureValue = "github-hook-validation-value";
const matchingGitLabHookValue = "gitlab-hook-validation-value";
const mismatchedGitLabHookValue = "gitlab-hook-mismatch-value";

function createWebhookTarget(overrides: Partial<{
  id: string;
  repositoryId: string;
  endpointPath: string;
  secretRef: string;
  providerWebhookId: string | null;
  status: "active" | "warning" | "disabled";
  organizationId: string;
  providerType: "github" | "gitlab";
  ownerName: string;
  repoName: string;
  defaultBranch: string;
  externalRepoId: string | null;
  connectionId: string | null;
  canonicalCloneUrl: string | null;
  lastIndexedCommitSha: string | null;
}> = {}) {
  return {
    id: "webhook_123",
    repositoryId: "repo_123",
    endpointPath: "/api/repositories/webhooks/webhook_123",
    secretRef: "REPOSITORY_WEBHOOK_SECRET",
    providerWebhookId: "17",
    status: "active" as const,
    organizationId: "org_123",
    providerType: "github" as const,
    ownerName: "acme",
    repoName: "finance-skills",
    defaultBranch: "main",
    externalRepoId: "42",
    connectionId: "conn_123",
    canonicalCloneUrl: "https://github.com/acme/finance-skills",
    lastIndexedCommitSha: null,
    ...overrides,
  };
}

test("resolveRepositoryWebhookPublicBaseUrl requires a configured public origin", () => {
  assert.throws(
    () => resolveRepositoryWebhookPublicBaseUrl({}),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryWebhookError);
      assert.equal(error.code, "repository_webhook_public_origin_missing");
      return true;
    },
  );
});

test("resolveRepositoryWebhookPublicBaseUrl rejects localhost origins", () => {
  assert.throws(
    () => resolveRepositoryWebhookPublicBaseUrl({ APP_BASE_URL: "http://localhost:3000" }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryWebhookError);
      assert.equal(error.code, "repository_webhook_public_origin_invalid");
      return true;
    },
  );
});

test("resolveRepositoryWebhookPublicBaseUrl returns the configured origin", () => {
  const result = resolveRepositoryWebhookPublicBaseUrl({
    APP_BASE_URL: "https://app.savantrepo.com/workspaces/demo",
  });

  assert.equal(result, "https://app.savantrepo.com");
});

test("verifyGitHubWebhookSignature accepts a valid signature", () => {
  const rawBody = JSON.stringify({ hello: "world" });
  const signature = `sha256=${createHmac("sha256", hookSignatureValue).update(rawBody).digest("hex")}`;

  assert.doesNotThrow(() => verifyGitHubWebhookSignature({
    headers: new Headers({ "x-hub-signature-256": signature }),
    rawBody,
    secret: hookSignatureValue,
  }));
});

test("verifyGitHubWebhookSignature rejects an invalid signature", () => {
  assert.throws(
    () => verifyGitHubWebhookSignature({
      headers: new Headers({ "x-hub-signature-256": "sha256=deadbeef" }),
      rawBody: JSON.stringify({ hello: "world" }),
      secret: hookSignatureValue,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryWebhookError);
      assert.equal(error.code, "github_webhook_signature_invalid");
      return true;
    },
  );
});

test("verifyGitLabWebhookToken accepts a matching token", () => {
  assert.doesNotThrow(() => verifyGitLabWebhookToken({
    headers: new Headers({ "x-gitlab-token": matchingGitLabHookValue }),
    secret: matchingGitLabHookValue,
  }));
});

test("verifyGitLabWebhookToken rejects a mismatched token", () => {
  assert.throws(
    () => verifyGitLabWebhookToken({
      headers: new Headers({ "x-gitlab-token": mismatchedGitLabHookValue }),
      secret: matchingGitLabHookValue,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryWebhookError);
      assert.equal(error.code, "gitlab_webhook_token_invalid");
      return true;
    },
  );
});

test("parseGitHubRepositoryWebhookEvent accepts default-branch pushes with new commits", () => {
  const target = createWebhookTarget();
  const result = parseGitHubRepositoryWebhookEvent({
    target,
    headers: new Headers({ "x-github-event": "push" }),
    rawBody: JSON.stringify({
      ref: "refs/heads/main",
      after: "abc123def456",
      repository: {
        id: 42,
        full_name: "acme/finance-skills",
      },
    }),
  });

  assert.equal(result.indexed, true);
  assert.equal(result.branch, "main");
  assert.equal(result.commitSha, "abc123def456");
});

test("parseGitHubRepositoryWebhookEvent ignores already-indexed commits", () => {
  const target = createWebhookTarget({ lastIndexedCommitSha: "abc123def456" });
  const result = parseGitHubRepositoryWebhookEvent({
    target,
    headers: new Headers({ "x-github-event": "push" }),
    rawBody: JSON.stringify({
      ref: "refs/heads/main",
      after: "abc123def456",
      repository: {
        id: 42,
        full_name: "acme/finance-skills",
      },
    }),
  });

  assert.equal(result.indexed, false);
  assert.match(result.message, /already indexed/i);
});

test("parseGitLabRepositoryWebhookEvent accepts default-branch pushes with new commits", () => {
  const target = createWebhookTarget({
    providerType: "gitlab",
    canonicalCloneUrl: "https://gitlab.com/acme/finance-skills",
  });
  const result = parseGitLabRepositoryWebhookEvent({
    target,
    headers: new Headers({ "x-gitlab-event": "Push Hook" }),
    rawBody: JSON.stringify({
      ref: "refs/heads/main",
      after: "fedcba654321",
      project_id: 42,
      project: {
        id: 42,
        path_with_namespace: "acme/finance-skills",
      },
    }),
  });

  assert.equal(result.indexed, true);
  assert.equal(result.branch, "main");
  assert.equal(result.commitSha, "fedcba654321");
});

test("parseGitLabRepositoryWebhookEvent ignores non-default branches", () => {
  const target = createWebhookTarget({
    providerType: "gitlab",
    canonicalCloneUrl: "https://gitlab.com/acme/finance-skills",
  });
  const result = parseGitLabRepositoryWebhookEvent({
    target,
    headers: new Headers({ "x-gitlab-event": "Push Hook" }),
    rawBody: JSON.stringify({
      ref: "refs/heads/feature/demo",
      after: "fedcba654321",
      project_id: 42,
      project: {
        id: 42,
        path_with_namespace: "acme/finance-skills",
      },
    }),
  });

  assert.equal(result.indexed, false);
  assert.equal(result.branch, "feature/demo");
  assert.match(result.message, /default branch/i);
});
