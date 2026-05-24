import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth0";
import { buildOnboardingStatusView } from "@/lib/onboarding";
import { resolveOnboardingRuntimeAccess } from "@/lib/onboarding-runtime";
import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { isControlPlaneDatabaseConfigured } from "@/server/control-plane/database";
import {
  getOnboardingSessionForSubjectByCheckoutSessionId,
  getOnboardingSessionForSubjectById,
} from "@/server/control-plane/onboarding-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isControlPlaneDatabaseConfigured) {
    return NextResponse.json(
      createApiErrorResponse(
        "onboarding_persistence_unconfigured",
        "DATABASE_URL must be configured before onboarding status can be checked.",
      ),
      { status: 503 },
    );
  }

  const session = auth0 ? await auth0.getSession() : null;
  const identity = resolveOnboardingRuntimeAccess(session?.user).identity;

  if (!identity) {
    return NextResponse.json(
      createApiErrorResponse("auth_required", "Login before checking onboarding status."),
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const stripeCheckoutSessionId = url.searchParams.get("session_id")?.trim();
  const onboardingSessionId = url.searchParams.get("onboarding_session_id")?.trim();
  if (!stripeCheckoutSessionId && !onboardingSessionId) {
    return NextResponse.json(
      createApiErrorResponse(
        "onboarding_lookup_required",
        "Query parameter 'session_id' or 'onboarding_session_id' is required.",
      ),
      { status: 400 },
    );
  }

  const onboardingSession = (
    stripeCheckoutSessionId
      ? await getOnboardingSessionForSubjectByCheckoutSessionId(
          identity.subject,
          stripeCheckoutSessionId,
        )
      : null
  ) ?? (
    onboardingSessionId
      ? await getOnboardingSessionForSubjectById(identity.subject, onboardingSessionId)
      : null
  );

  if (!onboardingSession) {
    return NextResponse.json(
      createApiErrorResponse("onboarding_session_not_found", "Onboarding session was not found."),
      { status: 404 },
    );
  }

  return NextResponse.json({
    data: buildOnboardingStatusView(onboardingSession),
    meta: createControlPlaneMeta("database"),
  });
}
