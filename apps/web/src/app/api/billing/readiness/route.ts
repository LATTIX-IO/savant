import { NextResponse } from "next/server";

import { stripe } from "@/lib/stripe";
import { isProductionBillingDeployment } from "@/lib/stripe-live-config";
import { verifyLiveBillingPreflight } from "@/lib/stripe-live-catalog";
import { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } from "@/server/control-plane/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, cacheable readiness probe returns no credentials, account IDs, or tenant details.
// Used during rollout to prove the production deployment can access its actual Stripe account.
export async function GET() {
  const headers = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60" };
  if (!isProductionBillingDeployment()) {
    return NextResponse.json({ ready: false }, { status: 503, headers });
  }
  const billing = await verifyLiveBillingPreflight(stripe);
  if (billing !== "ready" || !isControlPlaneDatabaseConfigured) {
    return NextResponse.json({ ready: false }, { status: 503, headers });
  }
  try {
    const sql = getControlPlaneDatabase();
    const rows = await sql<{ billing_accounts: string | null; billing_subscriptions: string | null; billing_webhook_events: string | null }[]>`
      select to_regclass('public.billing_accounts')::text as billing_accounts,
        to_regclass('public.billing_subscriptions')::text as billing_subscriptions,
        to_regclass('public.billing_webhook_events')::text as billing_webhook_events
    `;
    const row = rows[0];
    const ready = Boolean(row?.billing_accounts && row.billing_subscriptions && row.billing_webhook_events);
    return NextResponse.json({ ready }, { status: ready ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ ready: false }, { status: 503, headers });
  }
}
