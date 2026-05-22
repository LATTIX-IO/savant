import Stripe from "stripe";

/**
 * Server-only Stripe client.
 *
 * Required env vars (set in apps/web/.env.local or your deployment env):
 *   STRIPE_SECRET_KEY            — sk_test_… or sk_live_…
 *   STRIPE_PRICE_ID_MONTHLY      — recurring per-seat price, $1 / user / month
 *   STRIPE_PRICE_ID_YEARLY       — recurring per-seat price, $10 / user / year
 *   STRIPE_WEBHOOK_SECRET        — whsec_… for /api/billing/webhook signature verification
 *   NEXT_PUBLIC_APP_URL          — fully-qualified URL of this deployment
 */

const secretKey = process.env.STRIPE_SECRET_KEY;

export const isStripeConfigured = Boolean(secretKey);

export const stripe = secretKey
  ? new Stripe(secretKey, {
      // Pin to the SDK's bundled API version so behavior is predictable.
      apiVersion: "2026-04-22.dahlia",
      typescript: true,
      appInfo: {
        name: "Savant",
        url: process.env.NEXT_PUBLIC_APP_URL || "https://savant.app",
      },
    })
  : null;

export type BillingCycle = "monthly" | "annual";

export function priceIdFor(cycle: BillingCycle): string | null {
  return cycle === "annual"
    ? process.env.STRIPE_PRICE_ID_YEARLY ?? null
    : process.env.STRIPE_PRICE_ID_MONTHLY ?? null;
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
