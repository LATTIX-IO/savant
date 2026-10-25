import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const load = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("tenant admin role derives from all organization users before matching the actor", () => {
  const source = load("../server/control-plane/tenant-authorization.ts");
  const cte = source.split("with ordered_users as (")[1]?.split(")")[0] ?? "";
  assert.ok(cte.includes("row_number() over"), "must rank organization members");
  assert.ok(!cte.includes("users.external_subject ="), "must not rank only current actor");
  assert.match(source, /where ordered_users\.external_subject = /, "must filter actor after ranking");
});

test("production enrollment promises no card and expires unconverted trials", () => {
  const source = load("../app/api/billing/checkout/route.ts");
  assert.match(source, /payment_method_collection: "if_required"/);
  assert.match(source, /missing_payment_method: "cancel"/);
  assert.match(source, /trial_period_days: 14/);
});

test("server-side billing portal requires authentication, tenant owner authorization and same-origin POST", () => {
  const source = load("../app/api/billing/portal/route.ts");
  for (const requirement of ["getSession()", "requireTenantAdminActor", "resolveTenantMembershipForUser", "request.headers.get(\"origin\")", "stripe.billingPortal.sessions.create"]) {
    assert.ok(source.includes(requirement), requirement);
  }
  assert.match(source, /allowInactiveBilling: true/);
});

test("webhook reconciliation re-fetches current subscription state", () => {
  const source = load("../app/api/billing/webhook/route.ts");
  assert.match(source, /stripe!\.subscriptions\.retrieve\(subscription\.id\)/);
  assert.match(source, /handleCheckoutCompleted/);
});
