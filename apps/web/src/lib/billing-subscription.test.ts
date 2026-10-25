import assert from "node:assert/strict";
import test from "node:test";

import { shouldSyncSubscription } from "./billing-subscription.ts";

const old = { stripeCustomerId: "cus_one", stripeSubscriptionId: "sub_old" };

test("matching subscription updates are idempotent", () => {
  assert.equal(shouldSyncSubscription(old, old), true);
  assert.equal(shouldSyncSubscription(null, old), true);
});

test("stale events cannot overwrite replacement subscriptions", () => {
  const newer = { ...old, stripeSubscriptionId: "sub_new" };
  assert.equal(shouldSyncSubscription(old, newer), false);
  assert.equal(shouldSyncSubscription(old, newer, true), true);
});

test("different customers never overwrite an organization even with replacement enabled", () => {
  const foreign = { stripeCustomerId: "cus_foreign", stripeSubscriptionId: "sub_foreign" };
  assert.equal(shouldSyncSubscription(old, foreign), false);
  assert.equal(shouldSyncSubscription(old, foreign, true), false);
});
