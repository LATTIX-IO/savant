import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  buildStripeTenantMetadata,
  extractProvisionTenantInput,
  normalizeSeatCount,
} from "@/lib/onboarding";
import { isStripeConfigured, stripe, stripeWebhookSecret } from "@/lib/stripe";
import { buildWorkspaceUrl } from "@/lib/workspace-url";
import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { isControlPlaneDatabaseConfigured } from "@/server/control-plane/database";
import {
  claimWebhookEvent,
  finalizeCheckoutProvisioning,
  markOnboardingFailureByCheckoutSessionId,
  markOnboardingReady,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  syncBillingSubscriptionState,
} from "@/server/control-plane/onboarding-store";

export const runtime = "nodejs";
// Stripe needs the raw body for signature verification — disable Next's static
// optimization and any caching for this route.
export const dynamic = "force-dynamic";

const ONBOARDING_FAILURE_CODE = "onboarding_provisioning_failed";
const ONBOARDING_FAILURE_MESSAGE =
  "We hit a provisioning snag while finalizing your workspace. Please try again or contact support if it persists.";

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveBillingCycleFromStripeInterval(
  interval: string | undefined,
): "monthly" | "annual" | null {
  if (interval === "month") {
    return "monthly";
  }

  if (interval === "year") {
    return "annual";
  }

  return null;
}

export async function POST(request: Request) {
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json(
      createApiErrorResponse("stripe_not_configured", "Stripe not configured."),
      { status: 503 },
    );
  }

  const webhookSecret = stripeWebhookSecret();
  if (!webhookSecret) {
    return NextResponse.json(
      createApiErrorResponse("stripe_webhook_secret_missing", "STRIPE_WEBHOOK_SECRET not set."),
      { status: 503 },
    );
  }

  if (!isControlPlaneDatabaseConfigured && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      createApiErrorResponse(
        "onboarding_persistence_unconfigured",
        "DATABASE_URL must be configured before production webhook provisioning can run.",
      ),
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      createApiErrorResponse("stripe_signature_missing", "Missing stripe-signature header."),
      { status: 400 },
    );
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[billing/webhook] signature verification failed:", message);
    return NextResponse.json(
      createApiErrorResponse("stripe_signature_invalid", "Signature verification failed."),
      { status: 400 },
    );
  }

  const shouldTrackWebhookEvent = isControlPlaneDatabaseConfigured && (
    event.type === "checkout.session.completed"
    || event.type === "customer.subscription.deleted"
    || event.type === "customer.subscription.updated"
    || event.type === "customer.subscription.created"
  );

  if (shouldTrackWebhookEvent) {
    const claimed = await claimWebhookEvent(event.id, event.type);
    if (!claimed) {
      return NextResponse.json({ received: true });
    }
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
        await handleSubscriptionChanged(event.data.object);
        break;
      }
      default:
        // Unhandled but acknowledged — Stripe will stop retrying.
        break;
    }

    if (shouldTrackWebhookEvent) {
      await markWebhookEventProcessed(event.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[billing/webhook] handler error for ${event.type}:`, message);

    if (shouldTrackWebhookEvent) {
      await markWebhookEventFailed(event.id, message).catch(() => undefined);
    }

    if (event.type === "checkout.session.completed") {
      await markOnboardingFailureByCheckoutSessionId(
        event.data.object.id,
        ONBOARDING_FAILURE_CODE,
        ONBOARDING_FAILURE_MESSAGE,
      ).catch(() => undefined);
    }

    // Return 500 so Stripe retries with backoff.
    return NextResponse.json(
      createApiErrorResponse("stripe_webhook_handler_failed", "Webhook processing failed."),
      { status: 500 },
    );
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
  if (!isControlPlaneDatabaseConfigured || !stripe) {
    console.warn("[billing/webhook] durable provisioning skipped because DATABASE_URL is not configured.");
    return;
  }

  const provisionTenant = extractProvisionTenantInput(session);
  if (!provisionTenant.ok) {
    throw new Error(provisionTenant.message);
  }

  const provisionedTenant = await finalizeCheckoutProvisioning(provisionTenant.value);
  const tenantMetadata = buildStripeTenantMetadata({
    organizationId: provisionedTenant.organizationId,
    workspaceSlug: provisionedTenant.workspaceSlug,
    workspaceUrl: buildWorkspaceUrl(provisionedTenant.workspaceSlug),
    auth0Subject: provisionedTenant.auth0Subject,
  });

  if (provisionedTenant.stripeCustomerId) {
    await stripe.customers.update(provisionedTenant.stripeCustomerId, {
      metadata: tenantMetadata,
    });
  }

  if (provisionedTenant.stripeSubscriptionId) {
    const syncedSubscription = await stripe.subscriptions.update(
      provisionedTenant.stripeSubscriptionId,
      { metadata: tenantMetadata },
    );

    const primaryItem = syncedSubscription.items.data[0];
    await syncBillingSubscriptionState({
      organizationId: provisionedTenant.organizationId,
      stripeCustomerId: provisionedTenant.stripeCustomerId,
      stripeSubscriptionId: syncedSubscription.id,
      stripePriceId: primaryItem?.price.id ?? null,
      status: syncedSubscription.status,
      cancelAtPeriodEnd: syncedSubscription.cancel_at_period_end,
      cycle: resolveBillingCycleFromStripeInterval(primaryItem?.price.recurring?.interval),
      seats: typeof primaryItem?.quantity === "number"
        ? normalizeSeatCount(primaryItem.quantity, provisionTenant.value.seats)
        : provisionTenant.value.seats,
    });
  }

  await markOnboardingReady(provisionedTenant.onboardingSession.id);
}

async function handleSubscriptionChanged(subscription: Stripe.Subscription) {
  if (!isControlPlaneDatabaseConfigured) {
    return;
  }

  const primaryItem = subscription.items.data[0];

  await syncBillingSubscriptionState({
    organizationId: normalizeOptionalString(subscription.metadata?.tenantId),
    stripeCustomerId: typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null,
    stripeSubscriptionId: subscription.id,
    stripePriceId: primaryItem?.price.id ?? null,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cycle: resolveBillingCycleFromStripeInterval(primaryItem?.price.recurring?.interval),
    seats: typeof primaryItem?.quantity === "number"
      ? normalizeSeatCount(primaryItem.quantity, 1)
      : null,
  });
}
