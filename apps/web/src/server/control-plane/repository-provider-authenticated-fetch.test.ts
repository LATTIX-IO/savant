import assert from "node:assert/strict";
import test from "node:test";

import { RepositoryProviderError } from "./repository-provider-read.ts";
import { createProviderAuthenticatedFetch } from "./repository-provider-authenticated-fetch.ts";

test("createProviderAuthenticatedFetch adds GitHub bearer auth headers", async () => {
  let authorizationHeader: string | null = null;
  let acceptHeader: string | null = null;
  const fetcher = createProviderAuthenticatedFetch("github", "gh-test-token", async (_input, init) => {
    const capturedHeaders = new Headers(init?.headers);
    authorizationHeader = capturedHeaders.get("authorization");
    acceptHeader = capturedHeaders.get("accept");
    return new Response("{}", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  await fetcher("https://api.github.com/repos/lattix/savant", {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  assert.equal(authorizationHeader, "Bearer gh-test-token");
  assert.equal(acceptHeader, "application/vnd.github+json");
});

test("createProviderAuthenticatedFetch adds GitLab private token headers", async () => {
  let privateTokenHeader: string | null = null;
  let acceptHeader: string | null = null;
  const fetcher = createProviderAuthenticatedFetch("gitlab", "gl-test-token", async (_input, init) => {
    const capturedHeaders = new Headers(init?.headers);
    privateTokenHeader = capturedHeaders.get("private-token");
    acceptHeader = capturedHeaders.get("accept");
    return new Response("{}", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  await fetcher("https://gitlab.com/api/v4/projects", {
    headers: {
      Accept: "application/json",
    },
  });

  assert.equal(privateTokenHeader, "gl-test-token");
  assert.equal(acceptHeader, "application/json");
});

test("createProviderAuthenticatedFetch rejects unsupported providers", () => {
  assert.throws(
    () => createProviderAuthenticatedFetch("azure" as never, "unused-token"),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryProviderError);
      assert.equal(error.code, "repository_provider_authenticated_fetch_unsupported");
      return true;
    },
  );
});
