import type { Route } from "next";
import { redirect } from "next/navigation";

import { SettingsScreen } from "@/components/savant/screens/settings";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";
import { buildWorkspaceSettingsPayload } from "@/server/control-plane/workspace-settings";

export const metadata = { title: "Settings" };

// Deep-link parameters (e.g. the Source control OAuth return) survive the redirect into the tenant path.
const FORWARDED_QUERY_KEYS = ["section", "git_status", "git_error", "git_provider", "git_connection", "git_resyncing"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/settings");

  if (tenantPath) {
    const params = await searchParams;
    const forwarded = new URLSearchParams();
    for (const key of FORWARDED_QUERY_KEYS) {
      const value = params[key];
      if (typeof value === "string" && value.length <= 200) {
        forwarded.set(key, value);
      }
    }
    const query = forwarded.toString();
    redirect((query && !tenantPath.includes("?") ? `${tenantPath}?${query}` : tenantPath) as Route);
  }

  const viewer = buildAuthViewer(session?.user);
  const settings = buildWorkspaceSettingsPayload();

  return <SettingsScreen viewer={viewer} settings={settings} />;
}
