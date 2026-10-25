import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth0";
import { appUrl, stripe } from "@/lib/stripe";
import { isProductionBillingDeployment } from "@/lib/stripe-live-config";
import { normalizeWorkspaceSlug } from "@/lib/onboarding";
import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { getControlPlaneDatabase } from "@/server/control-plane/database";
import { requireTenantAdminActor, TenantAuthorizationError } from "@/server/control-plane/tenant-authorization";
import { resolveTenantMembershipForUser, TenantContextError } from "@/server/control-plane/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Savant live portal configuration. Public Stripe resource ID (never an API secret).
const SAVANT_LIVE_PORTAL_ID = "bpc_1UUW8NRXtgzihaETq3pxNZXc";

export async function POST(request: Request) {
  const expectedOrigin = new URL(appUrl()).origin;
  if (isProductionBillingDeployment() && request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json(createApiErrorResponse("origin_denied", "Request origin not authorized."), { status: 403 });
  }

  const session = auth0 ? await auth0.getSession() : null;
  if (!session?.user) {
    return NextResponse.json(createApiErrorResponse("auth_required", "Sign in to manage billing."), { status: 401 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(createApiErrorResponse("invalid_json", "Invalid request."), { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(createApiErrorResponse("invalid_request", "Invalid request."), { status: 400 });
  }
  const workspaceSlug = (body as Record<string, unknown>).workspaceSlug;
  if (typeof workspaceSlug !== "string" || normalizeWorkspaceSlug(workspaceSlug) !== workspaceSlug) {
    return NextResponse.json(createApiErrorResponse("workspace_slug_invalid", "Invalid workspace."), { status: 400 });
  }
  if (!stripe) {
    return NextResponse.json(createApiErrorResponse("billing_unavailable", "Billing is unavailable."), { status: 503 });
  }

  try {
    // Only this route may bypass the inactive subscription gate; membership and
    // owner/admin authorization are still required before selecting a customer.
    const context = await resolveTenantMembershipForUser(session.user, workspaceSlug, { allowInactiveBilling: true });
    const sql = getControlPlaneDatabase();
    await requireTenantAdminActor(sql, context);
    const billingRows = await sql<{ stripe_customer_id: string; stripe_mode: string }[]>`
      select stripe_customer_id, stripe_mode from billing_accounts
      where organization_id = ${context.tenant.organizationId}
      limit 1
    `;
    const billing = billingRows[0];
    if (!billing || (isProductionBillingDeployment() && billing.stripe_mode !== "live")) {
      return NextResponse.json(createApiErrorResponse("billing_account_missing", "No live billing account is linked to this workspace."), { status: 404 });
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: new URL(`/o/${encodeURIComponent(workspaceSlug)}/settings?section=billing`, expectedOrigin).toString(),
      ...(isProductionBillingDeployment() ? { configuration: SAVANT_LIVE_PORTAL_ID } : {}),
    });
    const portalUrl = new URL(portal.url);
    if (portalUrl.protocol !== "https:" || portalUrl.hostname !== "billing.stripe.com") {
      throw new Error("unexpected_portal_url");
    }
    return NextResponse.json({ url: portalUrl.toString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TenantContextError || error instanceof TenantAuthorizationError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), { status: error.status });
    }
    console.error("[billing/portal] unable to open customer billing portal:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json(createApiErrorResponse("billing_portal_unavailable", "Billing management is temporarily unavailable."), { status: 503 });
  }
}
