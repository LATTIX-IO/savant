import { SettingsScreen } from "@/components/savant/screens/settings";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { resolveTenantMembershipForUser } from "@/server/control-plane/tenant-context";
import { buildWorkspaceSettingsPayloadForTenant } from "@/server/control-plane/workspace-settings";

export const metadata = { title: "Settings" };

export default async function TenantSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);
  const tenantContext = await resolveTenantMembershipForUser(session?.user, workspaceSlug);
  const settings = await buildWorkspaceSettingsPayloadForTenant({
    organizationId: tenantContext.tenant.organizationId,
    workspaceName: tenantContext.tenant.workspaceName,
    workspaceSlug: tenantContext.tenant.workspaceSlug,
  });

  return <SettingsScreen viewer={viewer} settings={settings} />;
}