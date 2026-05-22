import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { PoliciesScreen } from "@/components/savant/screens/policies";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Policies" };

export default async function PoliciesPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/policies");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <PoliciesScreen />;
}
