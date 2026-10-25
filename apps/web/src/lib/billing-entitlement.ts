import { isProductionBillingDeployment } from "./stripe-live-config.ts";

export type TenantBillingState = {
  organizationCreatedAt: Date | string;
  stripeCustomerId: string | null;
  stripeMode: string | null;
  subscriptionStatus: string | null;
};

export type TenantBillingDecision = "granted" | "legacy" | "payment_required";

/**
 * Existing synthetic pre-launch workspaces are intentionally grandfathered.
 * New organizations must have a live paid/trialing Stripe subscription.
 * This static cutoff must NEVER roll forward with each deployment.
 */
export const LEGACY_WORKSPACE_CUTOFF = "2026-10-25T18:00:00.000Z";

export function assessTenantBilling(
  row: TenantBillingState | null,
  env: Record<string, string | undefined> = process.env,
): TenantBillingDecision {
  if (!isProductionBillingDeployment(env)) return "granted";
  if (!row) return "payment_required";

  const created = new Date(row.organizationCreatedAt).getTime();
  const preLaunch = Number.isFinite(created) && created < Date.parse(LEGACY_WORKSPACE_CUTOFF);

  if (!row.stripeCustomerId || row.stripeMode !== "live") {
    return preLaunch ? "legacy" : "payment_required";
  }

  return row.subscriptionStatus === "trialing" || row.subscriptionStatus === "active"
    ? "granted"
    : "payment_required";
}