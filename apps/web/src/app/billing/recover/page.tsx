import type { Route } from "next";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { normalizeWorkspaceSlug } from "@/lib/onboarding";
import { BillingPortalButton } from "@/components/savant/billing-portal-button";
import { NOINDEX_METADATA } from "@/lib/seo-metadata";

export const metadata = { ...NOINDEX_METADATA, title: "Restore your subscription" };
export const dynamic = "force-dynamic";

export default async function BillingRecoveryPage({ searchParams }: { searchParams: Promise<{ workspaceSlug?: string }> }) {
  const params = await searchParams;
  const workspaceSlug = params.workspaceSlug;
  if (!workspaceSlug || normalizeWorkspaceSlug(workspaceSlug) !== workspaceSlug) redirect("/onboarding" as Route);
  const session = auth0 ? await auth0.getSession() : null;
  if (!session?.user) {
    redirect((`/signin?returnTo=${encodeURIComponent(`/billing/recover?workspaceSlug=${workspaceSlug}`)}`) as Route);
  }
  return <main style={{ maxWidth: 660, margin: "10vh auto", padding: 32, lineHeight: 1.6 }}>
    <h1 style={{ fontSize: 28, marginBottom: 12 }}>Subscription action required</h1>
    <p>Your workspace is protected while its subscription is inactive. A workspace owner or administrator can update the payment method and view billing details securely in Stripe.</p>
    <BillingPortalButton workspaceSlug={workspaceSlug} />
    <p style={{ marginTop: 26 }}>If your subscription was fully canceled, contact support to reactivate it. Your workspace data has not been deleted.</p>
    <a href="/">Return to Savant</a>
  </main>;
}
