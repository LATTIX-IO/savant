import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createGitHubProvider } from "./github.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("GitHub configuration hint names exactly the missing variables", () => {
  const provider = createGitHubProvider({ env: { NODE_ENV: "production", GITHUB_APP_ID: "5124425" } });
  assert.equal(provider.isConfigured(), false);
  const hint = provider.configurationHint() ?? "";
  for (const name of ["GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET"]) {
    assert.match(hint, new RegExp(name));
  }
  assert.doesNotMatch(hint, /GITHUB_APP_ID\b/);
});

test("production requires the GitHub App OAuth client used to verify installation ownership", () => {
  const base = { NODE_ENV: "production", GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "savant-skills", GITHUB_APP_PRIVATE_KEY: pem };
  assert.equal(createGitHubProvider({ env: base }).isConfigured(), false);
  assert.equal(
    createGitHubProvider({ env: { ...base, GITHUB_APP_CLIENT_ID: "Iv23sample", GITHUB_APP_CLIENT_SECRET: "sample-github-client-secret" } }).isConfigured(),
    true,
  );
  // Outside production the ownership check can be skipped for local testing.
  assert.equal(createGitHubProvider({ env: { ...base, NODE_ENV: "development" } }).isConfigured(), true);
});

test("a malformed private key is reported instead of failing at connect time", () => {
  const provider = createGitHubProvider({
    env: { NODE_ENV: "development", GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "savant-skills", GITHUB_APP_PRIVATE_KEY: "sample-not-a-pem" },
  });
  assert.equal(provider.isConfigured(), false);
  assert.match(provider.configurationHint() ?? "", /not a valid PEM private key/);

  // Deployment env stores often flatten newlines to literal "\n"; that still works.
  const flattened = createGitHubProvider({
    env: { NODE_ENV: "development", GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "savant-skills", GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, "\\n") },
  });
  assert.equal(flattened.isConfigured(), true);
});
