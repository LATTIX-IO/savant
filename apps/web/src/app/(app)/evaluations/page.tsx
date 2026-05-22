import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { EvaluationsScreen } from "@/components/savant/screens/evaluations";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Evaluations" };

export default async function EvaluationsPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/evaluations");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <EvaluationsScreen />;
}
