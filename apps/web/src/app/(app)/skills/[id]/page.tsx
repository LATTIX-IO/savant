import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { SkillScreen } from "@/components/savant/screens/skill";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, `/skills/${id}`);

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <SkillScreen skillId={id} />;
}
