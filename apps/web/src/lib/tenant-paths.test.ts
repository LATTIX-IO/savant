import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTenantAppPath,
  buildTenantAwareAppPath,
  buildTenantRootPath,
  extractWorkspaceSlugFromPathname,
  stripTenantPathPrefix,
  withWorkspaceSlugQuery,
} from "./tenant-paths.ts";

test("buildTenantRootPath and buildTenantAppPath create path-based workspace routes", () => {
  assert.equal(buildTenantRootPath("finance-ops"), "/o/finance-ops");
  assert.equal(buildTenantAppPath("finance-ops", "/settings"), "/o/finance-ops/settings");
  assert.equal(buildTenantAppPath("finance-ops", "skills/skl_ccr"), "/o/finance-ops/skills/skl_ccr");
});

test("extractWorkspaceSlugFromPathname and stripTenantPathPrefix parse tenant routes", () => {
  assert.equal(extractWorkspaceSlugFromPathname("/o/finance-ops/skills/skl_ccr"), "finance-ops");
  assert.equal(stripTenantPathPrefix("/o/finance-ops/skills/skl_ccr"), "/skills/skl_ccr");
  assert.equal(stripTenantPathPrefix("/o/finance-ops"), "/");
  assert.equal(extractWorkspaceSlugFromPathname("/dashboard"), null);
});

test("buildTenantAwareAppPath keeps users inside the current tenant context when present", () => {
  assert.equal(
    buildTenantAwareAppPath("/o/finance-ops/evaluations", "/audit"),
    "/o/finance-ops/audit",
  );
  assert.equal(buildTenantAwareAppPath("/dashboard", "/audit"), "/audit");
});

test("withWorkspaceSlugQuery appends the workspace slug without dropping existing filters", () => {
  assert.equal(withWorkspaceSlugQuery("/api/skills?team=legal", "finance-ops"), "/api/skills?team=legal&workspaceSlug=finance-ops");
  assert.equal(withWorkspaceSlugQuery("/api/repositories", "finance-ops"), "/api/repositories?workspaceSlug=finance-ops");
});
