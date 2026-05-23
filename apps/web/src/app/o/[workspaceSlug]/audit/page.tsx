import { notFound } from "next/navigation";

import { AuditScreen } from "@/components/savant/screens/audit";
import { isGovernanceFeatureEnabled } from "@/lib/workspace-features";

export const metadata = { title: "Audit" };

export default function TenantAuditPage() {
  if (!isGovernanceFeatureEnabled()) {
    notFound();
  }

  return <AuditScreen />;
}