import { NextResponse } from "next/server";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { createApiErrorResponse, createControlPlaneMeta } from "@/server/control-plane/control-plane-response";
import { getControlPlaneDatabase } from "@/server/control-plane/database";
import { listReadableIndexedWorkflows } from "@/server/workflows/inventory";
import { CapabilityResolveError } from "@/server/workflows/capability-resolver";

export const dynamic = "force-dynamic";

/** Index-only inventory; each workflow must be opened from Git to verify its current content. */
export async function GET(request: Request) {
  try {
    const context=await authorizeTenantRequest(request);
    const repositoryId=new URL(request.url).searchParams.get("repositoryId")??"";
    const actor={organizationId:context.tenant.organizationId,subject:context.identity?.subject??""};
    const data=await listReadableIndexedWorkflows(getControlPlaneDatabase(),actor,repositoryId);
    return NextResponse.json({data,meta:createControlPlaneMeta("derived-index")},{
      headers:{"Cache-Control":"no-store"},
    });
  }catch(error){
    if(error instanceof TenantContextError||error instanceof CapabilityResolveError){
      return NextResponse.json(createApiErrorResponse(error.code,error.message),{status:error.status});
    }
    throw error;
  }
}
