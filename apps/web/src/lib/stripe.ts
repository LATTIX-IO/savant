import Stripe from "stripe";

import { resolveAuth0AppBaseUrl, type Auth0Env } from "./auth0-config.ts";

/**
 * Server-only Stripe client.
 *
 * Required env vars (set in apps/web/.env.local or your deployment env):
 *   STRIPE_SECRET_KEY                  — required for hosted checkout session creation
 *   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY — optional today, ready for future client-side Stripe.js
 *   STRIPE_WEBHOOK_SECRET              — required for /api/billing/webhook signature verification
 *
 * Optional catalog env vars:
 *   STRIPE_PRICE_ID_MONTHLY      — if set, use this Stripe-managed recurring monthly price
 *   STRIPE_PRICE_ID_YEARLY       — if set, use this Stripe-managed recurring annual price
 *
 * If no Stripe price ids are configured, Savant falls back to inline recurring
 * price data for the single Savant Seat plan: $1 / seat / month or $10 / seat / year.
 */

export type StripeEnv = Auth0Env;
export type StripeMode = "test" | "live" | "unconfigured";
export type BillingCycle = "monthly" | "annual";
type CheckoutSessionLineItem = NonNullable<
  NonNullable<Parameters<Stripe["checkout"]["sessions"]["create"]>[0]>["line_items"]
>[number];

const INLINE_STRIPE_PRODUCT_NAME = "Savant Seat";
const INLINE_STRIPE_CURRENCY = "usd";

const BILLING_CYCLE_CONFIG: Record<
  BillingCycle,
  {
    interval: Stripe.PriceCreateParams.Recurring.Interval;
    unitAmount: number;
    priceEnvKey: "STRIPE_PRICE_ID_MONTHLY" | "STRIPE_PRICE_ID_YEARLY";
  }
> = {
  monthly: {
    interval: "month",
    unitAmount: 100,
    priceEnvKey: "STRIPE_PRICE_ID_MONTHLY",
  },
  annual: {
    interval: "year",
    unitAmount: 1000,
    priceEnvKey: "STRIPE_PRICE_ID_YEARLY",
  },
};

function normalizeStripeUrlCandidate(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (
    trimmed.startsWith("localhost")
    || trimmed.startsWith("127.")
    || trimmed.startsWith("0.0.0.0")
    || trimmed.startsWith("[::1]")
  ) {
    return `http://${trimmed}`;
  }

  return `https://${trimmed}`;
}

export function isConfiguredStripeValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("<") || trimmed.includes("REPLACE") || trimmed.startsWith("placeholder-")) {
    return false;
  }

  return true;
}

export function readConfiguredStripeEnvValue(env: StripeEnv, key: string): string | null {
  const value = env[key];

  if (typeof value !== "string") {
    return null;
  }

  if (!isConfiguredStripeValue(value)) {
    return null;
  }

  return value.trim();
}

export function stripePublishableKey(env: StripeEnv = process.env): string | null {
  return readConfiguredStripeEnvValue(env, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
}

export function stripeWebhookSecret(env: StripeEnv = process.env): string | null {
  return readConfiguredStripeEnvValue(env, "STRIPE_WEBHOOK_SECRET");
}

export function stripeMode(env: StripeEnv = process.env): StripeMode {
  const candidate = readConfiguredStripeEnvValue(env, "STRIPE_SECRET_KEY") ?? stripePublishableKey(env);

  if (!candidate) {
    return "unconfigured";
  }

  if (candidate.startsWith("sk_live_") || candidate.startsWith("pk_live_")) {
    return "live";
  }

  if (candidate.startsWith("sk_test_") || candidate.startsWith("pk_test_")) {
    return "test";
  }

  return "unconfigured";
}

const secretKey = readConfiguredStripeEnvValue(process.env, "STRIPE_SECRET_KEY");

export const isStripeConfigured = Boolean(secretKey);

export const stripe = secretKey
  ? new Stripe(secretKey, {
      // Pin to the SDK's bundled API version so behavior is predictable.
      apiVersion: "2026-04-22.dahlia",
      typescript: true,
      appInfo: {
        name: "Savant",
        url: appUrl(),
      },
    })
  : null;

export function priceIdFor(cycle: BillingCycle, env: StripeEnv = process.env): string | null {
  return readConfiguredStripeEnvValue(env, BILLING_CYCLE_CONFIG[cycle].priceEnvKey);
}

export function checkoutLineItemFor(
  cycle: BillingCycle,
  seats: number,
  env: StripeEnv = process.env,
): CheckoutSessionLineItem {
  const quantity = Number.isFinite(seats) && seats > 0 ? Math.max(1, Math.floor(seats)) : 1;
  const configuredPriceId = priceIdFor(cycle, env);

  if (configuredPriceId) {
    return {
      price: configuredPriceId,
      quantity,
    };
  }

  const { interval, unitAmount } = BILLING_CYCLE_CONFIG[cycle];

  return {
    price_data: {
      currency: INLINE_STRIPE_CURRENCY,
      product_data: {
        name: INLINE_STRIPE_PRODUCT_NAME,
      },
      recurring: {
        interval,
      },
      unit_amount: unitAmount,
    },
    quantity,
  };
}

export function appUrl(env: StripeEnv = process.env): string {
  const publicUrl = readConfiguredStripeEnvValue(env, "NEXT_PUBLIC_APP_URL")
    ?? readConfiguredStripeEnvValue(env, "NEXT_PUBLIC_SITE_URL");

  if (publicUrl) {
    return normalizeStripeUrlCandidate(publicUrl);
  }

  return resolveAuth0AppBaseUrl(env) ?? "http://localhost:3000";
}
