import {NextResponse} from "next/server";
import {getControlPlaneDatabase} from "@/server/control-plane/database";
import {assertSameOriginMutationRequest} from "@/server/control-plane/request-security";
import {authorizeTenantRequest} from "@/server/control-plane/tenant-context";
import {gitErrorResponse,gitMeta} from "@/server/git/route-helpers";
import {resolveGitActorForTenant} from "@/server/git/runtime";
import {TestBenchError} from "@/server/test-bench/definition-contract";
import {readBoundedTestBenchBody} from "@/server/test-bench/definition-request";
import {parseObservedComparisonRequest} from "@/server/test-bench/observed-run-comparison-contract";
import {createObservedComparisonStore} from "@/server/test-bench/observed-run-comparison-store";

/** Only metadata about fully observed same-tenant skill runs; no raw cases. */
export async function GET(request:Request,ctx:RouteContext<"/api/skills/[id]/test-bench/compare">){
  try{
    const tenant=await authorizeTenantRequest(request);
    if(tenant.isDevelopmentFallback)
      throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(tenant);
    const {id}=await ctx.params;
    const data=await createObservedComparisonStore(getControlPlaneDatabase()).list(actor,id);
    return NextResponse.json({data,meta:gitMeta()},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
/** Tenant membership, CSRF, no arbitrary provider, model or scoring choice.
 * Real comparison is deterministic and read-only: it NEVER invokes the model.
 */
export async function POST(request:Request,ctx:RouteContext<"/api/skills/[id]/test-bench/compare">){
  try{
    assertSameOriginMutationRequest(request);
    const tenant=await authorizeTenantRequest(request);
    if(tenant.isDevelopmentFallback)
      throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(tenant);
    const {id}=await ctx.params;
    const input=parseObservedComparisonRequest(await readBoundedTestBenchBody(request));
    const data=await createObservedComparisonStore(getControlPlaneDatabase()).compare(
      actor,id,input.baselineRunId,input.candidateRunId,
    );
    return NextResponse.json({data,meta:gitMeta()},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
