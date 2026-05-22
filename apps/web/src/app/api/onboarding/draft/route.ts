import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth0";
import {
  buildOnboardingStatusView,
  validateOnboardingDraftInput,
} from "@/lib/onboarding";
import { resolveOnboardingRuntimeAccess } from "@/lib/onboarding-runtime";
import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { isControlPlaneDatabaseConfigured } from "@/server/control-plane/database";
import {
  OnboardingStoreError,
  saveOnboardingDraft,
} from "@/server/control-plane/onboarding-store";
import { readJsonObject } from "@/server/control-plane/request-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createStoreErrorResponse(error: unknown) {
  if (error instanceof OnboardingStoreError) {
    return NextResponse.json(
      createApiErrorResponse(error.code, error.message),
      { status: error.status },
    );
  }

  throw error;
}

export async function PUT(request: Request) {
  if (!isControlPlaneDatabaseConfigured) {
    return NextResponse.json(
      createApiErrorResponse(
        "onboarding_persistence_unconfigured",
        "DATABASE_URL must be configured before onboarding progress can be saved.",
      ),
      { status: 503 },
    );
  }

  const session = auth0 ? await auth0.getSession() : null;
  const identity = resolveOnboardingRuntimeAccess(session?.user).identity;

  if (!identity) {
    return NextResponse.json(
      createApiErrorResponse("auth_required", "Sign in with Auth0 before saving onboarding progress."),
      { status: 401 },
    );
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json(
      createApiErrorResponse("invalid_json", "Request body must be a JSON object."),
      { status: 400 },
    );
  }

  const validated = validateOnboardingDraftInput({
    workspaceName: body.workspaceName,
    workspaceSlug: body.workspaceSlug,
    cycle: body.cycle,
    seats: body.seats,
  });

  if (!validated.ok) {
    return NextResponse.json(
      createApiErrorResponse(validated.code, validated.message),
      { status: 400 },
    );
  }

  try {
    const saved = await saveOnboardingDraft(identity, validated.value);

    return NextResponse.json({
      data: buildOnboardingStatusView(saved),
      meta: createControlPlaneMeta("database"),
    });
  } catch (error) {
    return createStoreErrorResponse(error);
  }
}
