import { notFound } from "next/navigation";

import { PoliciesScreen } from "@/components/savant/screens/policies";
import { isGovernanceFeatureEnabled } from "@/lib/workspace-features";

export const metadata = { title: "Policies" };

export default function TenantPoliciesPage() {
  if (!isGovernanceFeatureEnabled()) {
    notFound();
  }

  return <PoliciesScreen />;
}