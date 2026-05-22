import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { isStripeConfigured, stripe } from "@/lib/stripe";

export const runtime = "nodejs";
// Stripe needs the raw body for signature verification — disable Next's static
// optimization and any caching for this route.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET not set" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[billing/webhook] signature verification failed:", message);
    return NextResponse.json({ error: `Signature verification failed: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }
      case "customer.subscription.deleted":
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        // Hook these up to your tenant lifecycle once the control plane has a
        // subscription mutator. For now we just acknowledge.
        break;
      }
      default:
        // Unhandled but acknowledged — Stripe will stop retrying.
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[billing/webhook] handler error for ${event.type}:`, message);
    // Return 500 so Stripe retries with backoff.
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/**
 * Provision (or top up) the tenant associated with this checkout session.
 *
 * Idempotent by Stripe customer id — the control plane should upsert.
 * Today this is a stub that just logs; wire it into the real tenant mutator
 * the moment `apps/web/src/server/control-plane` grows a `provisionTenant`
 * surface.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const authSub = session.metadata?.authSub || session.client_reference_id || null;
  const workspaceName = session.metadata?.workspaceName ?? null;
  const workspaceSlug = session.metadata?.workspaceSlug ?? null;
  const cycle = session.metadata?.cycle ?? null;
  const seats = session.metadata?.seats ? Number(session.metadata.seats) : null;

  // TODO: replace with control-plane.provisionTenant({...}). For now, log it.
  console.log("[billing/webhook] checkout.session.completed", {
    customerId,
    subscriptionId,
    authSub,
    workspaceName,
    workspaceSlug,
    cycle,
    seats,
    email: session.customer_email ?? session.customer_details?.email ?? null,
  });
}
