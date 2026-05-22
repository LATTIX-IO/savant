import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth0";
import { validateOnboardingDraftInput } from "@/lib/onboarding";
import {
  createSandboxCheckoutSessionId,
  resolveOnboardingRuntimeAccess,
  sandboxCheckoutOutcome,
} from "@/lib/onboarding-runtime";
import { appUrl, checkoutLineItemFor, isStripeConfigured, stripe, stripeMode } from "@/lib/stripe";
import { buildWorkspaceUrl } from "@/lib/workspace-url";
import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { isControlPlaneDatabaseConfigured } from "@/server/control-plane/database";
import {
  OnboardingStoreError,
  attachStripeCheckoutSession,
  beginCheckoutForOnboarding,
  markOnboardingCanceled,
  markOnboardingFailureByCheckoutSessionId,
  markOnboardingReady,
  recordCheckoutFailure,
} from "@/server/control-plane/onboarding-store";
import { readJsonObject } from "@/server/control-plane/request-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      createApiErrorResponse("invalid_json", "Request body must be a JSON object."),
      { status: 400 },
    );
  }

  const validatedDraft = validateOnboardingDraftInput({
    workspaceName: body.workspaceName,
    workspaceSlug: body.workspaceSlug,
    cycle: body.cycle,
    seats: body.seats,
  });

  if (!validatedDraft.ok) {
    return NextResponse.json(
      createApiErrorResponse(validatedDraft.code, validatedDraft.message),
      { status: 400 },
    );
  }

  const session = auth0 ? await auth0.getSession() : null;
  const runtimeAccess = resolveOnboardingRuntimeAccess(session?.user);
  const identity = runtimeAccess.identity;

  if (!identity) {
    return NextResponse.json(
      createApiErrorResponse("auth_required", "Sign in with Auth0 before starting Stripe checkout."),
      { status: 401 },
    );
  }


  if (!runtimeAccess.isSandbox && (!isStripeConfigured || !stripe)) {
    return NextResponse.json(
      createApiErrorResponse(
        "stripe_not_configured",
        "Stripe is not configured. Set STRIPE_SECRET_KEY to enable hosted checkout.",
      ),
      { status: 503 },
    );
  }
  const baseUrl = runtimeAccess.isSandbox ? new URL(request.url).origin : appUrl();
  const cancelUrl = `${baseUrl}/onboarding?cycle=${validatedDraft.value.cycle}&seats=${validatedDraft.value.seats}&cancelled=1`;
  const workspaceUrl = buildWorkspaceUrl(validatedDraft.value.workspaceSlug);
  let onboardingSession = null;

  if (isControlPlaneDatabaseConfigured) {
    try {
      onboardingSession = await beginCheckoutForOnboarding(
        identity,
        validatedDraft.value,
        stripeMode() === "live" ? "live" : "test",
      );
    } catch (error) {
      if (error instanceof OnboardingStoreError) {
        return NextResponse.json(
          createApiErrorResponse(error.code, error.message),
          { status: error.status },
        );
      }

      throw error;
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      createApiErrorResponse(
        "onboarding_persistence_unconfigured",
        "DATABASE_URL must be configured before production onboarding can start checkout.",
      ),
      { status: 503 },
    );
  }

  const stripeClient = stripe;

  if (runtimeAccess.isSandbox) {
    const outcome = sandboxCheckoutOutcome();
    const sandboxSessionId = createSandboxCheckoutSessionId();

    try {
      if (onboardingSession) {
        await attachStripeCheckoutSession(onboardingSession.id, sandboxSessionId);

        if (outcome === "cancel") {
          await markOnboardingCanceled(onboardingSession.id);
        } else if (outcome === "fail") {
          await markOnboardingFailureByCheckoutSessionId(
            sandboxSessionId,
            "sandbox_checkout_failed",
            "Local onboarding sandbox is configured to simulate a checkout failure.",
          );
        } else {
          await markOnboardingReady(onboardingSession.id);
        }
      }

      if (outcome === "cancel") {
        return NextResponse.json({ url: cancelUrl });
      }

      if (outcome === "fail" && !onboardingSession) {
        return NextResponse.json(
          createApiErrorResponse(
            "sandbox_checkout_failed",
            "Local onboarding sandbox is configured to simulate a checkout failure.",
          ),
          { status: 502 },
        );
      }

      return NextResponse.json({
        url: `${baseUrl}/onboarding/success?session_id=${encodeURIComponent(sandboxSessionId)}&sandbox=1&workspace_name=${encodeURIComponent(validatedDraft.value.workspaceName)}&workspace_slug=${encodeURIComponent(validatedDraft.value.workspaceSlug)}`,
      });
    } catch (error) {
      console.error("[billing/checkout] sandbox flow failed:", error);

      if (onboardingSession) {
        await recordCheckoutFailure(
          onboardingSession.id,
          "sandbox_checkout_failed",
          "Unable to complete the local onboarding sandbox right now.",
        );
      }

      return NextResponse.json(
        createApiErrorResponse(
          "sandbox_checkout_failed",
          "Unable to complete the local onboarding sandbox. Please try again.",
        ),
        { status: 502 },
      );
    }
  }

  if (!stripeClient) {
    return NextResponse.json(
      createApiErrorResponse(
        "stripe_not_configured",
        "Stripe is not configured. Set STRIPE_SECRET_KEY to enable hosted checkout.",
      ),
      { status: 503 },
    );
  }

  try {
    const correlatedMetadata = {
      workspaceName: validatedDraft.value.workspaceName,
      workspaceSlug: validatedDraft.value.workspaceSlug,
      workspaceUrl,
      cycle: validatedDraft.value.cycle,
      authSub: identity.subject,
      ...(onboardingSession ? { onboardingSessionId: onboardingSession.id } : {}),
    };

    const checkoutParams = {
      mode: "subscription" as const,
      line_items: [checkoutLineItemFor(validatedDraft.value.cycle, validatedDraft.value.seats)],
      // 14-day free trial — matches the landing page promise.
      subscription_data: {
        trial_period_days: 14,
        metadata: correlatedMetadata,
      },
      // Allow promo codes; never hurts conversion.
      allow_promotion_codes: true,
      customer_email: identity.email,
      client_reference_id: identity.subject,
      success_url: `${baseUrl}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: {
        ...correlatedMetadata,
        seats: String(validatedDraft.value.seats),
      },
    };

    const checkout = onboardingSession
      ? await stripeClient.checkout.sessions.create(checkoutParams, {
          idempotencyKey: onboardingSession.checkoutIdempotencyKey,
        })
      : await stripeClient.checkout.sessions.create(checkoutParams);

    if (!checkout.url || !checkout.id) {
      if (onboardingSession) {
        await recordCheckoutFailure(
          onboardingSession.id,
          "stripe_checkout_failed",
          "Unable to start Stripe checkout right now.",
        );
      }

      return NextResponse.json(
        createApiErrorResponse(
          "stripe_checkout_missing_url",
          "Stripe did not return a checkout URL.",
        ),
        { status: 502 },
      );
    }

    if (onboardingSession) {
      await attachStripeCheckoutSession(onboardingSession.id, checkout.id);
    }

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("[billing/checkout] failed:", error);

    if (onboardingSession) {
      await recordCheckoutFailure(
        onboardingSession.id,
        "stripe_checkout_failed",
        "Unable to start Stripe checkout right now.",
      );
    }

    return NextResponse.json(
      createApiErrorResponse(
        "stripe_checkout_failed",
        "Unable to start Stripe checkout. Please try again.",
      ),
      { status: 502 },
    );
  }
}
