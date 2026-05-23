import assert from "node:assert/strict";
import test from "node:test";

import {
  getRepositoryProviderCapabilities,
  isConcreteRepositoryProvider,
  isKnownRepositoryProvider,
  normalizeRepositoryUrl,
  parseRepositoryLocator,
} from "./repository-provider.ts";

test("normalizeRepositoryUrl accepts host-style locators and strips a trailing .git suffix", () => {
  assert.equal(
    normalizeRepositoryUrl("github.com/acme/finance-skills.git"),
    "https://github.com/acme/finance-skills",
  );
});

test("normalizeRepositoryUrl converts SSH Git remotes into https locators", () => {
  assert.equal(
    normalizeRepositoryUrl("git@github.com:acme/finance-skills.git"),
    "https://github.com/acme/finance-skills",
  );
});

test("parseRepositoryLocator extracts nested group paths for GitLab-style repositories", () => {
  assert.deepEqual(
    parseRepositoryLocator({
      provider: "gitlab",
      repoUrl: "https://gitlab.com/team/platform/finance-skills",
    }),
    {
      provider: "gitlab",
      rawUrl: "https://gitlab.com/team/platform/finance-skills",
      normalizedUrl: "https://gitlab.com/team/platform/finance-skills",
      host: "gitlab.com",
      owner: "team/platform",
      repository: "finance-skills",
      projectPath: "team/platform/finance-skills",
    },
  );
});

test("parseRepositoryLocator understands Azure DevOps _git locators", () => {
  assert.deepEqual(
    parseRepositoryLocator({
      provider: "azure",
      repoUrl: "https://dev.azure.com/acme/platform/_git/finance-skills",
    }),
    {
      provider: "azure",
      rawUrl: "https://dev.azure.com/acme/platform/_git/finance-skills",
      normalizedUrl: "https://dev.azure.com/acme/platform/_git/finance-skills",
      host: "dev.azure.com",
      owner: "acme/platform",
      repository: "finance-skills",
      projectPath: "acme/platform/_git/finance-skills",
    },
  );
});

test("parseRepositoryLocator rejects locators that do not identify a concrete repository", () => {
  assert.equal(
    parseRepositoryLocator({
      provider: "github",
      repoUrl: "https://github.com/acme",
    }),
    null,
  );
});

test("provider capability defaults fail closed for manual and self-hosted integrations", () => {
  assert.equal(isKnownRepositoryProvider("github"), true);
  assert.equal(isKnownRepositoryProvider("unknown-provider"), false);
  assert.equal(isConcreteRepositoryProvider("github"), true);
  assert.equal(isConcreteRepositoryProvider("more"), false);

  assert.deepEqual(getRepositoryProviderCapabilities("selfhosted"), {
    canReadTree: true,
    canResolveRefs: true,
    canCreateRepository: false,
    canCreateCommit: false,
    canRegisterWebhooks: false,
    supportsManagedProvisioning: false,
    supportsWebhookSync: false,
  });
});