import type { Route } from "next";
import { notFound, redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { PoliciesScreen } from "@/components/savant/screens/policies";
import { isGovernanceFeatureEnabled } from "@/lib/workspace-features";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Policies" };

export default async function PoliciesPage() {
  if (!isGovernanceFeatureEnabled()) {
    notFound();
  }

  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/policies");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <PoliciesScreen />;
}
