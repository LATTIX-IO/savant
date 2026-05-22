import { auth0 } from "@/lib/auth0";
import { buildAuthOverview } from "@/lib/auth0-session";
import { OverviewScreen } from "@/components/savant/screens/overview";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const auth = buildAuthOverview(session?.user);

  return <OverviewScreen auth={auth} />;
}
