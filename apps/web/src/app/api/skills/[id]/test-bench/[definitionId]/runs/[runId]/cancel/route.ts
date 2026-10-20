import {NextResponse} from "next/server";
import {getControlPlaneDatabase} from "@/server/control-plane/database";
import {assertSameOriginMutationRequest} from "@/server/control-plane/request-security";
import {authorizeTenantRequest} from "@/server/control-plane/tenant-context";
import {gitErrorResponse,gitMeta} from "@/server/git/route-helpers";
import {resolveGitActorForTenant} from "@/server/git/runtime";
import {TestBenchError} from "@/server/test-bench/definition-contract";
import {readBoundedTestBenchBody} from "@/server/test-bench/definition-request";
import {parseObservedCancelRequest} from "@/server/test-bench/observed-run-contract";
import {createObservedRunStore} from "@/server/test-bench/observed-run-store";

/** Explicit tenant- and role-authorized cancellation; does not claim an
 * in-flight third-party inference request can be physically interrupted.
 */
export async function POST(
  request:Request,
  ctx:RouteContext<"/api/skills/[id]/test-bench/[definitionId]/runs/[runId]/cancel">,
){
  try{
    assertSameOriginMutationRequest(request);
    const tenant=await authorizeTenantRequest(request);
    if(tenant.isDevelopmentFallback)
      throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(tenant);
    const {id,definitionId,runId}=await ctx.params;
    const input=parseObservedCancelRequest(await readBoundedTestBenchBody(request));
    const result=await createObservedRunStore(getControlPlaneDatabase())
      .cancel(actor,id,definitionId,runId,input.expectedRevision);
    return NextResponse.json({data:result.run,meta:gitMeta()},
      {status:result.replayed?200:202,headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
