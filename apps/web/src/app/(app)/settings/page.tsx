import { SettingsScreen } from "@/components/savant/screens/settings";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { buildWorkspaceSettingsPayload } from "@/server/control-plane/workspace-settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);
  const settings = buildWorkspaceSettingsPayload();

  return <SettingsScreen viewer={viewer} settings={settings} />;
}
