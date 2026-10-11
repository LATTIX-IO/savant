import { NextResponse } from "next/server";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { getControlPlaneDatabase } from "@/server/control-plane/database";
import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { tryRecordAuditEvent } from "@/server/control-plane/audit-events";
import { readWorkflowRequestObject } from "@/server/workflows/request";
import { WorkflowArtifactError } from "@/server/workflows/workflow-artifacts";
import { createCapabilityPolicyAdmin } from "@/server/workflows/capability-policy-admin";
import {
  PolicyAdminError, parsePolicyScope, parsePolicyMutation, parsePolicyIfMatch, policyETag,
} from "@/server/workflows/capability-policy-contract";

export const dynamic = "force-dynamic";

function denied(error:unknown):NextResponse {
  const known=error instanceof PolicyAdminError ||
    error instanceof WorkflowArtifactError || error instanceof TenantContextError;
  const code=known?error.code:"policy_admin_unavailable";
  const status=known?error.status:503;
  return NextResponse.json(createApiErrorResponse(code,code),{
    status,headers:{"Cache-Control":"no-store"},
  });
}
async function authorizedContext(request:Request){
  const tenant=await authorizeTenantRequest(request);
  if(!tenant.identity||tenant.isDevelopmentFallback)throw new PolicyAdminError("auth_required",401);
  return {organizationId:tenant.tenant.organizationId,subject:tenant.identity.subject};
}
/** Admin-only rule inspector. Never exposes hidden artifacts to normal members. */
export async function GET(request:Request){
  try{
    const actor=await authorizedContext(request);
    const params=new URL(request.url).searchParams;
    const scope=parsePolicyScope({
      repositoryId:params.get("repositoryId"),
      kind:params.get("kind"),artifactId:params.get("artifactId"),
    });
    const result=await createCapabilityPolicyAdmin(getControlPlaneDatabase()).list(actor,scope);
    return NextResponse.json({data:result},{headers:{
      "Cache-Control":"no-store","ETag":policyETag(result.revision),
    }});
  }catch(error){return denied(error);}
}
/** Grant or revoke read ACL with required revision CAS and UUID idempotency key. */
export async function POST(request:Request){
  let actor:Awaited<ReturnType<typeof authorizedContext>>|undefined;
  try{
    actor=await authorizedContext(request);
    const body=await readWorkflowRequestObject(request);
    const input=parsePolicyMutation(body);
    const expected=parsePolicyIfMatch(request.headers.get("if-match"));
    const result=await createCapabilityPolicyAdmin(getControlPlaneDatabase()).mutate(actor,input,expected);
    return NextResponse.json({data:result},{
      status:result.changed&&!result.replayed?201:200,
      headers:{"Cache-Control":"no-store","ETag":policyETag(result.revision)},
    });
  }catch(error){
    if(actor){
      const code=error instanceof PolicyAdminError||error instanceof WorkflowArtifactError?
        error.code:"policy_admin_unavailable";
      await tryRecordAuditEvent({
        organizationId:actor.organizationId,actorSubject:actor.subject,
        category:"repo",action:"artifact_policy_mutation_rejected",
        targetType:"capability",targetRef:"redacted",payload:{code},
      }).catch(()=>undefined);
    }
    return denied(error);
  }
}
