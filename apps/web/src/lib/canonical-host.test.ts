import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHostRedirect } from "./canonical-host.ts";

const env = { APP_BASE_URL: "https://savantskills.app" };

test("page requests on the old domain and www go to the canonical origin", () => {
  assert.equal(canonicalHostRedirect(new URL("https://savantrepo.com/catalog?q=pdf"), null, env), "https://savantskills.app/catalog?q=pdf");
  assert.equal(canonicalHostRedirect(new URL("https://x/o/acme/skills"), "www.savantrepo.com", env), "https://savantskills.app/o/acme/skills");
  assert.equal(canonicalHostRedirect(new URL("https://www.savantskills.app/"), null, env), "https://savantskills.app/");
});

test("APIs, auth callbacks, the canonical host and unknown hosts are left alone", () => {
  assert.equal(canonicalHostRedirect(new URL("https://savantrepo.com/api/mcp"), null, env), null);
  assert.equal(canonicalHostRedirect(new URL("https://savantrepo.com/api/git/connections/github/callback?code=x"), null, env), null);
  assert.equal(canonicalHostRedirect(new URL("https://savantrepo.com/auth/callback?code=x"), null, env), null);
  assert.equal(canonicalHostRedirect(new URL("https://savantskills.app/catalog"), null, env), null);
  assert.equal(canonicalHostRedirect(new URL("https://savant-web-git-main.vercel.app/catalog"), null, env), null);
  assert.equal(canonicalHostRedirect(new URL("http://localhost:3000/"), null, env), null);
});

test("while APP_BASE_URL is still the old domain, the old domain is canonical (sign-in keeps working)", () => {
  const before = { APP_BASE_URL: "https://savantrepo.com" };
  assert.equal(canonicalHostRedirect(new URL("https://savantrepo.com/dashboard"), null, before), null);
  assert.equal(canonicalHostRedirect(new URL("https://savantskills.app/dashboard"), null, before), "https://savantrepo.com/dashboard");
});
