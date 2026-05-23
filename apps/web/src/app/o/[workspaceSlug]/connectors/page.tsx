import { notFound } from "next/navigation";

import { ConnectorsScreen } from "@/components/savant/screens/connectors";
import { isGovernanceFeatureEnabled } from "@/lib/workspace-features";

export const metadata = { title: "Connectors" };

export default function TenantConnectorsPage() {
  if (!isGovernanceFeatureEnabled()) {
    notFound();
  }

  return <ConnectorsScreen />;
}