import { NextResponse } from "next/server";

import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { getWorkspaceSettingsResponseForTenant } from "@/server/control-plane/workspace-settings";

export async function GET(request: Request) {
  try {
    const { tenant } = await authorizeTenantRequest(request);
    return NextResponse.json(
      await getWorkspaceSettingsResponseForTenant({
        organizationId: tenant.organizationId,
        workspaceName: tenant.workspaceName,
        workspaceSlug: tenant.workspaceSlug,
      }),
    );
  } catch (error) {
    if (error instanceof TenantContextError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    throw error;
  }
}
