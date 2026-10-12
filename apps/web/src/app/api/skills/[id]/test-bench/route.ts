import {NextResponse} from "next/server";
import {getControlPlaneDatabase} from "@/server/control-plane/database";
import {assertSameOriginMutationRequest} from "@/server/control-plane/request-security";
import {authorizeTenantRequest} from "@/server/control-plane/tenant-context";
import {gitErrorResponse,gitMeta} from "@/server/git/route-helpers";
import {resolveGitActorForTenant} from "@/server/git/runtime";
import {TestBenchError,parseTestBenchCreate} from "@/server/test-bench/definition-contract";
import {readBoundedTestBenchBody} from "@/server/test-bench/definition-request";
import {createTestBenchDefinitionStore} from "@/server/test-bench/definition-store";

/** Encrypted persistent case definitions only; never execute saved drafts here. */
export async function GET(request:Request,ctx:RouteContext<"/api/skills/[id]/test-bench">){
  try{
    const context=await authorizeTenantRequest(request);
    if(context.isDevelopmentFallback)throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(context);
    const {id}=await ctx.params;
    const data=await createTestBenchDefinitionStore(getControlPlaneDatabase()).list(actor,id);
    return NextResponse.json({data,meta:gitMeta()},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
export async function POST(request:Request,ctx:RouteContext<"/api/skills/[id]/test-bench">){
  try{
    assertSameOriginMutationRequest(request);
    const context=await authorizeTenantRequest(request);
    if(context.isDevelopmentFallback)throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(context);
    const {id}=await ctx.params;
    const input=parseTestBenchCreate(await readBoundedTestBenchBody(request));
    const result=await createTestBenchDefinitionStore(getControlPlaneDatabase()).create(actor,id,input);
    return NextResponse.json({data:result.definition,meta:gitMeta()},
      {status:result.replayed?200:201,headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
