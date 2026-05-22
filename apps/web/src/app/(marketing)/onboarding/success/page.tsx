import { redirect } from "next/navigation";

import { Ic } from "@/components/savant/icons";
import { isStripeConfigured, stripe } from "@/lib/stripe";

export const metadata = { title: "Welcome to Savant" };
export const dynamic = "force-dynamic";

type SuccessSearchParams = {
  session_id?: string;
};

export default async function OnboardingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<SuccessSearchParams>;
}) {
  const { session_id } = await searchParams;

  if (!session_id) {
    redirect("/onboarding");
  }

  // Best-effort: confirm the Stripe session is paid (or in trial). If the
  // webhook hasn't fired yet we still let the user through — the webhook is
  // the source of truth for tenant provisioning.
  let workspaceName: string | null = null;
  let workspaceSlug: string | null = null;
  if (isStripeConfigured && stripe) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      workspaceName = (session.metadata?.workspaceName as string | undefined) ?? null;
      workspaceSlug = (session.metadata?.workspaceSlug as string | undefined) ?? null;
    } catch (error) {
      // Don't block the success page on a Stripe read failure.
      console.error("[onboarding/success] retrieve session failed:", error);
    }
  }

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
        {workspaceSlug ? (
          <code
            className="ref"
            style={{ background: "var(--linen)", padding: "4px 10px", fontSize: 12 }}
          >
            {workspaceSlug}.savant.app
          </code>
        ) : null}
        <a href="/dashboard" className="btn btn-primary btn-lg" style={{ marginTop: 6 }}>
          Open dashboard
          <Ic.ChevR className="b-icon" />
        </a>
      </div>
    </div>
  );
}
