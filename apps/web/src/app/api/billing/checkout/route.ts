import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth0";
import { appUrl, isStripeConfigured, priceIdFor, stripe, type BillingCycle } from "@/lib/stripe";

type CheckoutRequestBody = {
  cycle?: BillingCycle;
  seats?: number;
  workspaceName?: string;
  workspaceSlug?: string;
};

export async function POST(request: Request) {
  let body: CheckoutRequestBody;
  try {
    body = (await request.json()) as CheckoutRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cycle: BillingCycle = body.cycle === "monthly" ? "monthly" : "annual";
  const seats = Number.isInteger(body.seats) && body.seats! > 0 ? body.seats! : 5;
  const workspaceName = (body.workspaceName ?? "").trim();
  const workspaceSlug = (body.workspaceSlug ?? "").trim();

  if (!workspaceName) {
    return NextResponse.json({ error: "workspaceName is required" }, { status: 400 });
  }

  if (!isStripeConfigured || !stripe) {
    return NextResponse.json(
      {
        error:
          "Stripe is not configured. Set STRIPE_SECRET_KEY, STRIPE_PRICE_ID_MONTHLY, and STRIPE_PRICE_ID_YEARLY.",
      },
      { status: 503 },
    );
  }

  const priceId = priceIdFor(cycle);
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price for cycle "${cycle}" is not configured.` },
      { status: 503 },
    );
  }

  const session = auth0 ? await auth0.getSession() : null;
  const customerEmail = session?.user?.email ?? null;
  const authSub = session?.user?.sub ?? null;

  const baseUrl = appUrl();

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: seats }],
      // 14-day free trial — matches the landing page promise.
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          workspaceName,
          workspaceSlug,
          cycle,
          authSub: authSub ?? "",
        },
      },
      // Allow promo codes; never hurts conversion.
      allow_promotion_codes: true,
      // Only attach optional fields when we have them — exactOptionalPropertyTypes
      // forbids `: undefined`.
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      ...(authSub ? { client_reference_id: authSub } : {}),
      success_url: `${baseUrl}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/onboarding?cycle=${cycle}&seats=${seats}&cancelled=1`,
      metadata: {
        workspaceName,
        workspaceSlug,
        cycle,
        seats: String(seats),
        authSub: authSub ?? "",
      },
    });

    if (!checkout.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL." },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Stripe error";
    console.error("[billing/checkout] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
