import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { buildAuthOverview } from "@/lib/auth0-session";
import { getOverviewResponse } from "@/server/control-plane/read-model";
import { OverviewScreen } from "@/components/savant/screens/overview";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/dashboard");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  const auth = buildAuthOverview(session?.user);
  const overview = await getOverviewResponse();

  return <OverviewScreen auth={auth} overview={overview.data} />;
}
