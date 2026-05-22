import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkspacePath,
  buildWorkspaceUrl,
  formatWorkspaceUrlForDisplay,
  formatWorkspaceUrlPrefixForDisplay,
  resolveCanonicalWorkspaceOrigin,
} from "./workspace-url.ts";

test("buildWorkspacePath formats the path-based tenant route", () => {
  assert.equal(buildWorkspacePath("finance-ops"), "/o/finance-ops");
});

test("workspace URL helpers default to the savantrepo.com canonical origin", () => {
  assert.equal(resolveCanonicalWorkspaceOrigin({}), "https://savantrepo.com");
  assert.equal(buildWorkspaceUrl("finance-ops"), "https://savantrepo.com/o/finance-ops");
  assert.equal(formatWorkspaceUrlForDisplay("finance-ops"), "savantrepo.com/o/finance-ops");
  assert.equal(formatWorkspaceUrlPrefixForDisplay(), "savantrepo.com/o/");
});

test("resolveCanonicalWorkspaceOrigin prefers the configured production hostname", () => {
  assert.equal(
    resolveCanonicalWorkspaceOrigin({
      VERCEL_PROJECT_PRODUCTION_URL: "app.savantrepo.com",
      APP_BASE_URL: "http://localhost:3000",
    }),
    "https://app.savantrepo.com",
  );
});

test("resolveCanonicalWorkspaceOrigin ignores localhost fallbacks for canonical tenant URLs", () => {
  assert.equal(
    resolveCanonicalWorkspaceOrigin({
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      APP_BASE_URL: "http://localhost:3000",
    }),
    "https://savantrepo.com",
  );
});
