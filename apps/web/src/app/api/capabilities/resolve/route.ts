import { NextResponse } from "next/server";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { tryRecordAuditEvent } from "@/server/control-plane/audit-events";
import { readWorkflowRequestObject } from "@/server/workflows/request";
import { capabilityResolver } from "@/server/workflows/capability-resolver-runtime";
import { CapabilityResolveError } from "@/server/workflows/capability-resolver";

export const dynamic="force-dynamic";

export async function POST(request:Request){
  let tenant: Awaited<ReturnType<typeof authorizeTenantRequest>>|undefined;
  try{
    tenant=await authorizeTenantRequest(request);
    // Explicit authentication, even when local development fallback is enabled.
    if(!tenant.identity||tenant.isDevelopmentFallback)
      throw new CapabilityResolveError("auth_required",401);
    const body=await readWorkflowRequestObject(request);
    const result=await capabilityResolver.resolve({
      organizationId:tenant.tenant.organizationId,subject:tenant.identity.subject,
    },body.reference);
    await tryRecordAuditEvent({
      organizationId:tenant.tenant.organizationId,actorSubject:tenant.identity.subject,
      category:"repo",action:"capability_reference_resolved",targetType:"capability",
      targetRef:`${result.kind}:${result.reference.artifactId}`,
      payload:{kind:result.kind,repositoryId:result.reference.locator.source==="git"?result.reference.locator.repositoryId:null,
        commitSha:result.reference.locator.source==="git"?result.reference.locator.commitSha:null},
    }).catch(()=>undefined);
    return NextResponse.json({data:result},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const known=error instanceof CapabilityResolveError||error instanceof TenantContextError;
    if(known){
      const failure=error as CapabilityResolveError|TenantContextError;
      // Never echo potentially sensitive provider errors or user-supplied IDs.
      return NextResponse.json(createApiErrorResponse(failure.code,failure.code),{status:failure.status,headers:{"Cache-Control":"no-store"}});
    }
    return NextResponse.json(createApiErrorResponse("capability_resolution_unavailable","capability_resolution_unavailable"),
      {status:503,headers:{"Cache-Control":"no-store"}});
  }
}
