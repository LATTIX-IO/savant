import {NextResponse} from "next/server";
import {readAiServiceConfig} from "@/server/ai/clients";
import {getControlPlaneDatabase} from "@/server/control-plane/database";
import {assertSameOriginMutationRequest} from "@/server/control-plane/request-security";
import {authorizeTenantRequest} from "@/server/control-plane/tenant-context";
import {gitErrorResponse,gitMeta} from "@/server/git/route-helpers";
import {resolveGitActorForTenant} from "@/server/git/runtime";
import {kickBackgroundJobs} from "@/server/jobs/runner";
import {TestBenchError} from "@/server/test-bench/definition-contract";
import {readBoundedTestBenchBody} from "@/server/test-bench/definition-request";
import {createObservedRunStore} from "@/server/test-bench/observed-run-store";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseObservedRunAdmission(value:unknown):{requestId:string;expectedRevision:number}{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new TestBenchError("test_bench_run_request_invalid",422);
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==2||Object.keys(row).some(k=>k!=="requestId"&&k!=="expectedRevision")||
    typeof row.requestId!=="string"||!UUID.test(row.requestId)||
    !Number.isSafeInteger(row.expectedRevision)||
    (row.expectedRevision as number)<1)
    throw new TestBenchError("test_bench_run_request_invalid",422);
  return {requestId:row.requestId,expectedRevision:row.expectedRevision as number};
}
/** Read encrypted, observed run receipts. This does not infer missing scores. */
export async function GET(request:Request,ctx:RouteContext<"/api/skills/[id]/test-bench/[definitionId]/runs">){
  try{
    const tenant=await authorizeTenantRequest(request);
    if(tenant.isDevelopmentFallback)throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(tenant);
    const {id,definitionId}=await ctx.params;
    const data=await createObservedRunStore(getControlPlaneDatabase()).list(actor,id,definitionId);
    return NextResponse.json({data,meta:gitMeta()},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
/** Enqueues a *real* provider call only after bounded schema, role and tenant gates. */
export async function POST(request:Request,ctx:RouteContext<"/api/skills/[id]/test-bench/[definitionId]/runs">){
  try{
    assertSameOriginMutationRequest(request);
    const tenant=await authorizeTenantRequest(request);
    if(tenant.isDevelopmentFallback)throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(tenant);
    const {id,definitionId}=await ctx.params;
    const input=parseObservedRunAdmission(await readBoundedTestBenchBody(request));
    const provider=readAiServiceConfig();
    if(!provider.nim||!provider.jev)
      throw new TestBenchError("test_bench_provider_unconfigured",503);
    const result=await createObservedRunStore(getControlPlaneDatabase())
      .start(actor,id,definitionId,input);
    if(!result.replayed)await kickBackgroundJobs();
    return NextResponse.json({data:result.run,meta:gitMeta()},
      {status:result.replayed?200:202,headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
