import {NextResponse} from "next/server";
import {getControlPlaneDatabase} from "@/server/control-plane/database";
import {authorizeTenantRequest} from "@/server/control-plane/tenant-context";
import {gitErrorResponse,gitMeta} from "@/server/git/route-helpers";
import {resolveGitActorForTenant} from "@/server/git/runtime";
import {TestBenchError} from "@/server/test-bench/definition-contract";
import {createObservedRunStore} from "@/server/test-bench/observed-run-store";
/** Only the authenticated owning workspace can retrieve observed case evidence. */
export async function GET(request:Request,
  ctx:RouteContext<"/api/skills/[id]/test-bench/[definitionId]/runs/[runId]">){
  try{
    const tenant=await authorizeTenantRequest(request);
    if(tenant.isDevelopmentFallback)
      throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(tenant);
    const {id,definitionId,runId}=await ctx.params;
    const data=await createObservedRunStore(getControlPlaneDatabase())
      .get(actor,id,definitionId,runId);
    return NextResponse.json({data,meta:gitMeta()},
      {headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
