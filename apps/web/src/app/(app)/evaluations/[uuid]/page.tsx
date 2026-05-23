import type { Route } from "next";
import { redirect } from "next/navigation";

import { EvaluationDetailScreen } from "@/components/savant/screens/evaluation-detail";
import { auth0 } from "@/lib/auth0";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";

export const metadata = { title: "Evaluation details" };

export default async function EvaluationDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const session = auth0 ? await auth0.getSession() : null;
  const tenantPath = await resolvePreferredTenantAppPath(session?.user, `/evaluations/${uuid}`);

  if (tenantPath) {
    redirect(tenantPath as Route);
  }

  return <EvaluationDetailScreen evaluationUuid={uuid} />;
}
