import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { RepositoriesScreen } from "@/components/savant/screens/repositories";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Repositories" };

export default async function RepositoriesPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/repositories");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <RepositoriesScreen />;
}
