import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { ConnectorsScreen } from "@/components/savant/screens/connectors";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Connectors" };

export default async function ConnectorsPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/connectors");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <ConnectorsScreen />;
}
