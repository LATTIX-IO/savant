import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { AuditScreen } from "@/components/savant/screens/audit";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Audit" };

export default async function AuditPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/audit");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <AuditScreen />;
}
