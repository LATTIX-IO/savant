import assert from "node:assert/strict";
import test from "node:test";

import { isProductionBillingDeployment, liveCheckoutReadiness } from "./stripe-live-config.ts";

const live = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  SAVANT_LIVE_CHECKOUT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_live_example",
  STRIPE_EXPECTED_ACCOUNT_ID: "acct_savant123",
  STRIPE_PRICE_ID_MONTHLY: "price_monthly123",
  STRIPE_PRICE_ID_YEARLY: "price_yearly123",
  STRIPE_WEBHOOK_SECRET: "whsec_example",
};

test("production checkout is disabled by default", () => {
  const state = liveCheckoutReadiness({ VERCEL_ENV: "production" });
  assert.equal(state.ready, false);
  assert.equal(state.required, true);
  assert.ok(state.missing.includes("SAVANT_LIVE_CHECKOUT_ENABLED"));
});

test("only explicitly configured live merchant and prices pass production readiness", () => {
  assert.deepEqual(liveCheckoutReadiness(live), { required: true, ready: true, missing: [] });
  assert.deepEqual(liveCheckoutReadiness({ ...live, STRIPE_SECRET_KEY: "rk_live_fixture" }), { required: true, ready: true, missing: [] });
  assert.equal(liveCheckoutReadiness({ ...live, STRIPE_SECRET_KEY: "rk_test_fixture" }).ready, false);
  assert.equal(liveCheckoutReadiness({ ...live, STRIPE_SECRET_KEY: "rk_live_" }).ready, false);
  assert.equal(liveCheckoutReadiness({ ...live, STRIPE_SECRET_KEY: "sk_test_example" }).ready, false);
  assert.equal(liveCheckoutReadiness({ ...live, STRIPE_EXPECTED_ACCOUNT_ID: "acct_" }).ready, false);
  assert.equal(liveCheckoutReadiness({ ...live, STRIPE_PRICE_ID_YEARLY: "price_invalid-hyphen" }).ready, false);
  assert.equal(liveCheckoutReadiness({ ...live, STRIPE_WEBHOOK_SECRET: "<STRIPE_WEBHOOK_SECRET>" }).ready, false);
  assert.equal(liveCheckoutReadiness({ ...live, SAVANT_LIVE_CHECKOUT_ENABLED: "1" }).ready, false);
});

test("preview and local development do not require live Stripe configuration", () => {
  assert.equal(isProductionBillingDeployment({ NODE_ENV: "production", VERCEL_ENV: "preview" }), false);
  assert.deepEqual(liveCheckoutReadiness({ NODE_ENV: "production", VERCEL_ENV: "preview" }), {
    required: false, ready: true, missing: [],
  });
  assert.equal(isProductionBillingDeployment({ NODE_ENV: "production" }), true);
});
