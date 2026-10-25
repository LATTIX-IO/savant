import type Stripe from "stripe";

import { liveCheckoutReadiness, type StripeLiveEnvironment } from "./stripe-live-config.ts";
import { verifyStripeMerchant } from "./stripe-merchant.ts";

export type BillingPreflightResult = "ready" | "configuration" | "merchant" | "catalog" | "provider";

/** Binds a restricted key to Savant live prices, not merely an API key prefix. */
export async function verifyLiveBillingPreflight(
  client: Stripe | null,
  env: StripeLiveEnvironment = process.env,
): Promise<BillingPreflightResult> {
  if (!liveCheckoutReadiness(env).ready || !client) return "configuration";
  const secretKey = env.STRIPE_SECRET_KEY!.trim();
  const expectedAccountId = env.STRIPE_EXPECTED_ACCOUNT_ID!.trim();
  const merchant = await verifyStripeMerchant({ secretKey, expectedAccountId });
  if (merchant !== "verified") return merchant === "stripe_unavailable" ? "provider" : "merchant";
  try {
    for (const [key, amount, interval] of [
      ["STRIPE_PRICE_ID_MONTHLY", 100, "month"],
      ["STRIPE_PRICE_ID_YEARLY", 1000, "year"],
    ] as const) {
      const price = await client.prices.retrieve(env[key]!);
      if (!price.active || !price.livemode || price.currency !== "usd" || price.unit_amount !== amount
        || price.recurring?.interval !== interval || price.recurring?.usage_type !== "licensed" || price.type !== "recurring"
        || price.product !== "prod_VVVsMOvk4P2oMl") return "catalog";
    }
    return "ready";
  } catch {
    return "provider";
  }
}
