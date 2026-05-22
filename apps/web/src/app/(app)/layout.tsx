import type { ReactNode } from "react";

import { SavantShell } from "@/components/savant/app-shell";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = auth0 ? await auth0.getSession() : null;

  const viewer = buildAuthViewer(session?.user);

  return <SavantShell viewer={viewer}>{children}</SavantShell>;
}
