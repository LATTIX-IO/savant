import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { ReleasesScreen } from "@/components/savant/screens/releases";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Releases" };

export default async function ReleasesPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/releases");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <ReleasesScreen />;
}
