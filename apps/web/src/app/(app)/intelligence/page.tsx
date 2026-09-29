import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { IntelligenceScreen } from "@/components/savant/screens/intelligence";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Skill Intelligence" };

export default async function IntelligencePage() {
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, "/intelligence");

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <IntelligenceScreen />;
}
