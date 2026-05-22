import { OverviewScreen } from "@/components/savant/screens/overview";
import { auth0 } from "@/lib/auth0";
import { buildAuthOverview } from "@/lib/auth0-session";
import { getOverviewResponse } from "@/server/control-plane/read-model";
import { resolveTenantMembershipForUser } from "@/server/control-plane/tenant-context";
import { buildPublicAuthSettings } from "@/server/control-plane/workspace-settings";

export const metadata = { title: "Dashboard" };

export default async function TenantDashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = auth0 ? await auth0.getSession() : null;
  const auth = buildAuthOverview(session?.user);
  const authStatus = buildPublicAuthSettings().status;
  const tenantContext = await resolveTenantMembershipForUser(session?.user, workspaceSlug);
  const overview = await getOverviewResponse(tenantContext);

  return <OverviewScreen auth={auth} authStatus={authStatus} overview={overview.data} />;
}