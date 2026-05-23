import type { Route } from "next";
import { notFound, redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { AuditScreen } from "@/components/savant/screens/audit";
import { isGovernanceFeatureEnabled } from "@/lib/workspace-features";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Audit" };

export default async function AuditPage() {
  if (!isGovernanceFeatureEnabled()) {
    notFound();
  }

  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/audit");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <AuditScreen />;
}
