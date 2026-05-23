import assert from "node:assert/strict";
import test from "node:test";

import {
  appUrl,
  checkoutLineItemFor,
  isConfiguredStripeValue,
  priceIdFor,
  stripeMode,
  stripePublishableKey,
  stripeWebhookSecret,
} from "./stripe.ts";

test("isConfiguredStripeValue rejects empty and placeholder values", () => {
  assert.equal(isConfiguredStripeValue(undefined), false);
  assert.equal(isConfiguredStripeValue(""), false);
  assert.equal(isConfiguredStripeValue("   "), false);
  assert.equal(isConfiguredStripeValue("<STRIPE_SECRET_KEY>"), false);
  assert.equal(isConfiguredStripeValue("placeholder-local-secret"), false);
  assert.equal(isConfiguredStripeValue("REPLACE_ME"), false);
  assert.equal(isConfiguredStripeValue("sk_test_example"), true);
});

test("stripeMode detects configured test and live environments", () => {
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: "sk_test_example" }), "test");
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: "sk_live_example" }), "live");
  assert.equal(
    stripeMode({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_example" }),
    "test",
  );
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: "<STRIPE_SECRET_KEY>" }), "unconfigured");
});

test("stripePublishableKey and stripeWebhookSecret ignore placeholders", () => {
  assert.equal(
    stripePublishableKey({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "<NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY>" }),
    null,
  );
  assert.equal(stripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: "<STRIPE_WEBHOOK_SECRET>" }), null);
  assert.equal(
    stripePublishableKey({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_example" }),
    "pk_test_example",
  );
  assert.equal(stripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: "whsec_example" }), "whsec_example");
});

test("priceIdFor returns configured recurring catalog ids", () => {
  assert.equal(priceIdFor("monthly", { STRIPE_PRICE_ID_MONTHLY: "price_monthly" }), "price_monthly");
  assert.equal(priceIdFor("annual", { STRIPE_PRICE_ID_YEARLY: "price_yearly" }), "price_yearly");
  assert.equal(priceIdFor("monthly", { STRIPE_PRICE_ID_MONTHLY: "<STRIPE_PRICE_ID_MONTHLY>" }), null);
});

test("checkoutLineItemFor uses configured price ids when present", () => {
  assert.deepEqual(
    checkoutLineItemFor("annual", 12, { STRIPE_PRICE_ID_YEARLY: "price_yearly" }),
    {
      price: "price_yearly",
      quantity: 12,
    },
  );
});

test("checkoutLineItemFor falls back to inline recurring price data", () => {
  const monthly = checkoutLineItemFor("monthly", 5, {});

  assert.equal(monthly.quantity, 5);
  assert.equal(monthly.price_data?.currency, "usd");
  assert.equal(monthly.price_data?.unit_amount, 100);
  assert.equal(monthly.price_data?.recurring?.interval, "month");
  assert.equal(monthly.price_data?.product_data?.name, "Savant Seat");

  const annual = checkoutLineItemFor("annual", 3, {});
  assert.equal(annual.price_data?.unit_amount, 1000);
  assert.equal(annual.price_data?.recurring?.interval, "year");
});

test("appUrl prefers explicit Stripe return URLs and falls back to the app base url", () => {
  assert.equal(appUrl({ NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000/" }), "http://127.0.0.1:3000");
  assert.equal(appUrl({ APP_BASE_URL: "https://savantrepo.com" }), "https://savantrepo.com");
  assert.equal(
    appUrl({
      APP_BASE_URL: "https://savantrepo.com",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000/",
    }),
    "https://savantrepo.com",
  );
  assert.equal(appUrl({}), "http://localhost:3000");
});
