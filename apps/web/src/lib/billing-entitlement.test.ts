import assert from "node:assert/strict";
import test from "node:test";

import { assessTenantBilling, LEGACY_WORKSPACE_CUTOFF } from "./billing-entitlement.ts";

const prod = { NODE_ENV: "production", VERCEL_ENV: "production" };
const record = {
  organizationCreatedAt: "2026-10-26T00:00:00Z",
  stripeCustomerId: "cus_live",
  stripeMode: "live",
  subscriptionStatus: "active",
};

test("only active or trialing live subscriptions unlock new tenants", () => {
  assert.equal(assessTenantBilling(record, prod), "granted");
  assert.equal(assessTenantBilling({ ...record, subscriptionStatus: "trialing" }, prod), "granted");
  for (const status of ["pending_sync", "canceled", "past_due", "unpaid", "incomplete", "paused", null]) {
    assert.equal(assessTenantBilling({ ...record, subscriptionStatus: status }, prod), "payment_required");
  }
});

test("new organizations cannot bypass Stripe via missing or test billing rows", () => {
  assert.equal(assessTenantBilling(null, prod), "payment_required");
  assert.equal(assessTenantBilling({ ...record, stripeCustomerId: null }, prod), "payment_required");
  assert.equal(assessTenantBilling({ ...record, stripeMode: "test" }, prod), "payment_required");
});

test("prelaunch owner workspaces remain accessible but canceled live subscriptions are not", () => {
  assert.equal(LEGACY_WORKSPACE_CUTOFF, "2026-10-25T18:00:00.000Z");
  const legacy = { ...record, organizationCreatedAt: "2026-10-20T00:00:00Z", stripeCustomerId: null };
  assert.equal(assessTenantBilling(legacy, prod), "legacy");
  assert.equal(assessTenantBilling({ ...legacy, stripeCustomerId: "cus_live", subscriptionStatus: "canceled" }, prod), "payment_required");
  assert.equal(assessTenantBilling(legacy, { VERCEL_ENV: "preview", NODE_ENV: "production" }), "granted");
});
