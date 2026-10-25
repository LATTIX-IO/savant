/**
 * Production billing is opt-in and bound to a single Stripe merchant account.
 * Never silently reuse sandbox, Lattix corporate, or pricing-table credentials.
 */
export type StripeLiveEnvironment = Record<string, string | undefined>;

export type LiveCheckoutReadiness = {
  required: boolean;
  ready: boolean;
  missing: string[];
};

function configured(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  if (!result || result.startsWith("<") || /^(REPLACE_ME|placeholder-|undefined|null)/i.test(result)) {
    return null;
  }
  return result;
}

export function isProductionBillingDeployment(env: StripeLiveEnvironment = process.env): boolean {
  return env.VERCEL_ENV === "production"
    || (!env.VERCEL_ENV && env.NODE_ENV === "production");
}

export function liveCheckoutReadiness(
  env: StripeLiveEnvironment = process.env,
): LiveCheckoutReadiness {
  if (!isProductionBillingDeployment(env)) {
    return { required: false, ready: true, missing: [] };
  }

  const missing: string[] = [];
  if (configured(env.SAVANT_LIVE_CHECKOUT_ENABLED)?.toLowerCase() !== "true") {
    missing.push("SAVANT_LIVE_CHECKOUT_ENABLED");
  }
  if (!configured(env.STRIPE_SECRET_KEY)?.startsWith("sk_live_")) {
    missing.push("STRIPE_SECRET_KEY (live)");
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(configured(env.STRIPE_EXPECTED_ACCOUNT_ID) ?? "")) {
    missing.push("STRIPE_EXPECTED_ACCOUNT_ID");
  }
  if (!/^price_[A-Za-z0-9]+$/.test(configured(env.STRIPE_PRICE_ID_MONTHLY) ?? "")) {
    missing.push("STRIPE_PRICE_ID_MONTHLY");
  }
  if (!/^price_[A-Za-z0-9]+$/.test(configured(env.STRIPE_PRICE_ID_YEARLY) ?? "")) {
    missing.push("STRIPE_PRICE_ID_YEARLY");
  }
  if (!configured(env.STRIPE_WEBHOOK_SECRET)?.startsWith("whsec_")) {
    missing.push("STRIPE_WEBHOOK_SECRET");
  }

  return { required: true, ready: missing.length === 0, missing };
}
