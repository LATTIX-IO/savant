import { NextResponse } from "next/server";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { createApiErrorResponse, createControlPlaneMeta } from "@/server/control-plane/control-plane-response";
import { getSkillAssetResponse, SkillAssetError } from "@/server/control-plane/skill-assets";
import { CapabilityResolveError } from "@/server/workflows/capability-resolver";
import { GitProviderError } from "@/server/git/errors";

export const dynamic="force-dynamic";

/** Actual ACL-authorized Git content at an indexed immutable commit.
 * Missing/unsupported/non-text assets fail rather than falling back to demos.
 * Select one observed file using ?path=...; no arbitrary repo file proxy. */
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){
  try{
    const tenant=await authorizeTenantRequest(request);
    const {id}=await ctx.params;
    const url=new URL(request.url);
    if(url.searchParams.getAll("path").length>1){
      return NextResponse.json(createApiErrorResponse("invalid_asset_selection","Select one file."),{
        status:400,headers:{"Cache-Control":"no-store"},
      });
    }
    const requestedPath=url.searchParams.has("path")?url.searchParams.get("path"):null;
    const data=await getSkillAssetResponse(id,tenant,requestedPath);
    return NextResponse.json({data,meta:createControlPlaneMeta("git")},{
      headers:{"Cache-Control":"private, no-store"},
    });
  }catch(error){
    if(error instanceof TenantContextError||error instanceof SkillAssetError
      ||error instanceof CapabilityResolveError||error instanceof GitProviderError){
      return NextResponse.json(createApiErrorResponse(error.code,error.message),{
        status:error.status,headers:{"Cache-Control":"private, no-store"},
      });
    }
    throw error;
  }
}
