import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { CatalogScreen } from "@/components/savant/screens/catalog";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Skills" };

export default async function SkillsPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/skills");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <CatalogScreen />;
}
