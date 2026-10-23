import {NextResponse} from "next/server";
import {authorizeTenantRequest,TenantContextError} from "@/server/control-plane/tenant-context";
import {createApiErrorResponse,createControlPlaneMeta} from "@/server/control-plane/control-plane-response";
import {describeEnterpriseProviderPreflight} from "@/lib/enterprise-provider-catalog";
/** Read-only tenant-authorized catalog. It does not look up or grant provider credentials. */
export async function GET(request:Request){
 try{
  const context=await authorizeTenantRequest(request);
  if(!context.identity || context.isDevelopmentFallback)
   return NextResponse.json(createApiErrorResponse("enterprise_ai_auth_required","Authenticated workspace membership required."),{status:401});
  return NextResponse.json({data:describeEnterpriseProviderPreflight(),meta:createControlPlaneMeta("derived-index")});
 }catch(error){
  if(error instanceof TenantContextError)
   return NextResponse.json(createApiErrorResponse(error.code,error.message),{status:error.status});
  throw error;
 }
}
