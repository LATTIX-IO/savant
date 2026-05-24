import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0, isAuth0Configured } from "@/lib/auth0";
import { buildAuthStatusHref } from "@/lib/auth0-config";
import {
  buildSignupHrefForOnboarding,
  buildOnboardingReturnToPath,
  resolveOnboardingRuntimeAccess,
  shouldRedirectOnboardingToAuthStatus,
  shouldRedirectOnboardingToSignup,
} from "@/lib/onboarding-runtime";
import { buildOnboardingSuccessPath, normalizeWorkspaceSlug, shouldResumeOnboardingCheckout } from "@/lib/onboarding";
import { stripePricingTableId, stripePublishableKey } from "@/lib/stripe";
import { buildTenantAppPath } from "@/lib/tenant-paths";
import { OnboardingWizard } from "@/components/marketing/onboarding-wizard";
import { isControlPlaneDatabaseConfigured } from "@/server/control-plane/database";
import {
  getOnboardingStateForSubject,
  markOnboardingCanceled,
} from "@/server/control-plane/onboarding-store";

export const metadata = {
  title: "Set up your workspace",
};

type OnboardingSearchParams = {
  cycle?: string;
  seats?: string;
  cancelled?: string;
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<OnboardingSearchParams>;
}) {
  const params = await searchParams;
  const session = auth0 ? await auth0.getSession() : null;
  const runtimeAccess = resolveOnboardingRuntimeAccess(session?.user);
  const viewer = runtimeAccess.viewer;
  const identity = runtimeAccess.identity;
  const wasCancelled = params.cancelled === "1";

  if (shouldRedirectOnboardingToSignup({
    hasIdentity: Boolean(identity),
    isSandbox: runtimeAccess.isSandbox,
    isAuth0Configured,
  })) {
    redirect(buildSignupHrefForOnboarding(params) as Route);
  }

  if (shouldRedirectOnboardingToAuthStatus({
    hasIdentity: Boolean(identity),
    isSandbox: runtimeAccess.isSandbox,
    isAuth0Configured,
  })) {
    redirect(
      buildAuthStatusHref({
        source: "onboarding",
        returnTo: buildOnboardingReturnToPath(params),
      }) as Route,
    );
  }

  let restoredDraft = null;
  if (identity && isControlPlaneDatabaseConfigured) {
    const onboardingState = await getOnboardingStateForSubject(identity.subject);

    if (wasCancelled && onboardingState.currentSession?.status === "checkout_pending") {
      onboardingState.currentSession = await markOnboardingCanceled(onboardingState.currentSession.id);
    }

    if (onboardingState.provisionedTenant) {
      redirect(buildTenantAppPath(onboardingState.provisionedTenant.workspaceSlug, "/dashboard") as Route);
    }

    if (
      !wasCancelled
      && onboardingState.currentSession
      && shouldResumeOnboardingCheckout(onboardingState.currentSession.status)
    ) {
      redirect(
        buildOnboardingSuccessPath({
          sessionId: onboardingState.currentSession.stripeCheckoutSessionId,
          onboardingSessionId: onboardingState.currentSession.id,
        }) as Route,
      );
    }

    restoredDraft = onboardingState.currentSession;
  }

  const initialCycle = params.cycle === "monthly"
    ? "monthly"
    : restoredDraft?.cycle ?? "annual";
  const initialSeats = (() => {
    const n = Number(params.seats);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(500, Math.floor(n));
    }

    return restoredDraft?.seats ?? 5;
  })();
  const initialWorkspaceName = restoredDraft?.workspaceName
    ?? (viewer.isAuthenticated
      ? `${viewer.displayName.replace(/\s+/g, " ").trim()}'s workspace`
      : "");
  const initialWorkspaceSlug = restoredDraft?.workspaceSlug
    ?? (viewer.isAuthenticated
      ? normalizeWorkspaceSlug(viewer.displayName) ?? "workspace"
      : "");
  const publishableKey = stripePublishableKey();
  const pricingTableId = stripePricingTableId();

  return (
    <OnboardingWizard
      initialCycle={initialCycle}
      initialSeats={initialSeats}
      initialWorkspaceName={initialWorkspaceName}
      initialWorkspaceSlug={initialWorkspaceSlug}
      initialOnboardingSessionId={restoredDraft?.id ?? null}
      canPersistDraft={Boolean(identity && isControlPlaneDatabaseConfigured)}
      hasPersistedDraft={Boolean(restoredDraft)}
      isSandbox={runtimeAccess.isSandbox}
      wasCancelled={wasCancelled}
      viewerEmail={viewer.email}
      stripePricingTableId={pricingTableId}
      stripePublishableKey={publishableKey}
    />
  );
}
