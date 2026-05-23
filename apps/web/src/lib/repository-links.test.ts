import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRepositoryWebUrl,
  normalizeRepositoryWebUrl,
} from "./repository-links.ts";

test("normalizeRepositoryWebUrl strips .git suffixes from HTTPS clone URLs", () => {
  assert.equal(
    normalizeRepositoryWebUrl("https://github.com/acme/finance-skills.git"),
    "https://github.com/acme/finance-skills",
  );
});

test("normalizeRepositoryWebUrl converts SSH clone URLs into browser-friendly HTTPS URLs", () => {
  assert.equal(
    normalizeRepositoryWebUrl("git@gitlab.com:acme/platform/skills.git"),
    "https://gitlab.com/acme/platform/skills",
  );
});

test("buildRepositoryWebUrl prefers a stored canonical repository URL when present", () => {
  assert.equal(
    buildRepositoryWebUrl({
      provider: "azure",
      name: "contoso/shared/agent-skills",
      canonicalCloneUrl: "https://dev.azure.com/contoso/shared/_git/agent-skills",
    }),
    "https://dev.azure.com/contoso/shared/_git/agent-skills",
  );
});

test("buildRepositoryWebUrl derives browser URLs for supported providers when the canonical URL is missing", () => {
  assert.equal(
    buildRepositoryWebUrl({
      provider: "bitbucket",
      name: "acme/skills-catalog",
    }),
    "https://bitbucket.org/acme/skills-catalog",
  );

  assert.equal(
    buildRepositoryWebUrl({
      provider: "azure",
      name: "contoso/shared/agent-skills",
    }),
    "https://dev.azure.com/contoso/shared/_git/agent-skills",
  );
});

test("buildRepositoryWebUrl returns null for providers without a safe browser fallback", () => {
  assert.equal(
    buildRepositoryWebUrl({
      provider: "selfhosted",
      name: "acme/finance-skills",
    }),
    null,
  );
});
