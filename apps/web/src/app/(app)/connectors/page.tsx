import type { Route } from "next";
import { notFound, redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { ConnectorsScreen } from "@/components/savant/screens/connectors";
import { isGovernanceFeatureEnabled } from "@/lib/workspace-features";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Connectors" };

export default async function ConnectorsPage() {
  if (!isGovernanceFeatureEnabled()) {
    notFound();
  }

  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/connectors");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <ConnectorsScreen />;
}
