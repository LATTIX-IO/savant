import type { Route } from "next";
import { redirect } from "next/navigation";

import { OnboardingSuccessState } from "@/components/marketing/onboarding-success-state";
import { Ic } from "@/components/savant/icons";
import { auth0 } from "@/lib/auth0";
import { buildOnboardingStatusView } from "@/lib/onboarding";
import { resolveOnboardingRuntimeAccess } from "@/lib/onboarding-runtime";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { buildTenantAppPath } from "@/lib/tenant-paths";
import { formatWorkspaceUrlForDisplay } from "@/lib/workspace-url";
import { isControlPlaneDatabaseConfigured } from "@/server/control-plane/database";
import { getOnboardingSessionForSubjectByCheckoutSessionId } from "@/server/control-plane/onboarding-store";

export const metadata = { title: "Welcome to Savant" };
export const dynamic = "force-dynamic";

type SuccessSearchParams = {
  session_id?: string;
  sandbox?: string;
  workspace_name?: string;
  workspace_slug?: string;
};

export default async function OnboardingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<SuccessSearchParams>;
}) {
  const { session_id, sandbox, workspace_name, workspace_slug } = await searchParams;

  if (!session_id) {
    redirect("/onboarding" as Route);
  }

  if (isControlPlaneDatabaseConfigured) {
    const session = auth0 ? await auth0.getSession() : null;
    const runtimeAccess = resolveOnboardingRuntimeAccess(session?.user);
    const identity = runtimeAccess.identity;

    if (!identity) {
      const params = new URLSearchParams({
        returnTo: `/onboarding/success?session_id=${encodeURIComponent(session_id)}`,
      });
      redirect(`/signin?${params.toString()}` as Route);
    }

    const onboardingSession = await getOnboardingSessionForSubjectByCheckoutSessionId(
      identity.subject,
      session_id,
    );

    if (!onboardingSession) {
      redirect("/onboarding" as Route);
    }

    return (
      <OnboardingSuccessState
        initialStatus={buildOnboardingStatusView(onboardingSession)}
        isSandbox={runtimeAccess.isSandbox}
        sessionId={session_id}
      />
    );
  }

  const runtimeAccess = resolveOnboardingRuntimeAccess(null);

  // Best-effort: confirm the Stripe session is paid (or in trial). If the
  // webhook hasn't fired yet we still let the user through — the webhook is
  // the source of truth for tenant provisioning.
  const sandboxMode = runtimeAccess.isSandbox || sandbox === "1";
  let workspaceName: string | null = sandboxMode ? workspace_name?.trim() ?? null : null;
  let workspaceSlug: string | null = sandboxMode ? workspace_slug?.trim() ?? null : null;
  if (!sandboxMode && isStripeConfigured && stripe) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      workspaceName = (session.metadata?.workspaceName as string | undefined) ?? null;
      workspaceSlug = (session.metadata?.workspaceSlug as string | undefined) ?? null;
    } catch (error) {
      // Don't block the success page on a Stripe read failure.
      console.error("[onboarding/success] retrieve session failed:", error);
    }
  }

  const workspaceUrl = workspaceSlug ? formatWorkspaceUrlForDisplay(workspaceSlug) : null;
  const dashboardHref = workspaceSlug ? buildTenantAppPath(workspaceSlug, "/dashboard") : "/dashboard";

  return (
    <div className="signup-redirect">
      <div style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 18, alignItems: "center" }}>
        <span
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--moss-soft)",
            color: "var(--moss-deep)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Ic.Check style={{ width: 22, height: 22 }} />
        </span>
        <h1>Workspace ready.</h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-3)", maxWidth: 460 }}>
          {workspaceName ? (
            <>
              <strong style={{ color: "var(--ink)" }}>{workspaceName}</strong> is provisioned and your
              14-day trial has started. Connect a Git repository to ingest your first skills.
            </>
          ) : (
            <>
              Your workspace is provisioned and your 14-day trial has started. Connect a Git
              repository to ingest your first skills.
            </>
          )}
        </p>
        {workspaceUrl ? (
          <code
            className="ref"
            style={{ background: "var(--linen)", padding: "4px 10px", fontSize: 12 }}
          >
            {workspaceUrl}
          </code>
        ) : null}
        {runtimeAccess.isSandbox ? (
          <div className="note" style={{ maxWidth: 460 }}>
            <Ic.Clock className="n-icon" />
            <span>
              Local sandbox mode simulated Auth0 and Stripe for this run. No external billing call was created.
            </span>
          </div>
        ) : null}
        <a href={dashboardHref} className="btn btn-primary btn-lg" style={{ marginTop: 6 }}>
          Open dashboard
          <Ic.ChevR className="b-icon" />
        </a>
      </div>
    </div>
  );
}
