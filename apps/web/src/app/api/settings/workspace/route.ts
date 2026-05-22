import { NextResponse } from "next/server";

import { getWorkspaceSettingsResponse } from "@/server/control-plane/workspace-settings";

export function GET() {
  return NextResponse.json(getWorkspaceSettingsResponse());
}
