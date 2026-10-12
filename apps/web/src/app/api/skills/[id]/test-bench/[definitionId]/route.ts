import {NextResponse} from "next/server";
import {getControlPlaneDatabase} from "@/server/control-plane/database";
import {assertSameOriginMutationRequest} from "@/server/control-plane/request-security";
import {authorizeTenantRequest} from "@/server/control-plane/tenant-context";
import {gitErrorResponse,gitMeta} from "@/server/git/route-helpers";
import {resolveGitActorForTenant} from "@/server/git/runtime";
import {
  TestBenchError,parseTestBenchMutation,parseTestBenchArchive,
} from "@/server/test-bench/definition-contract";
import {readBoundedTestBenchBody} from "@/server/test-bench/definition-request";
import {createTestBenchDefinitionStore} from "@/server/test-bench/definition-store";

const route="/api/skills/[id]/test-bench/[definitionId]" as const;
/** Inspect one immutable-source case definition; no execution or scoring. */
export async function GET(request:Request,ctx:RouteContext<typeof route>){
  try{
    const context=await authorizeTenantRequest(request);
    if(context.isDevelopmentFallback)throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(context);
    const {id,definitionId}=await ctx.params;
    const data=await createTestBenchDefinitionStore(getControlPlaneDatabase()).get(actor,id,definitionId);
    return NextResponse.json({data,meta:gitMeta()},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
/** If-Match-style CAS: an outdated editor cannot overwrite a newer revision. */
export async function PATCH(request:Request,ctx:RouteContext<typeof route>){
  try{
    assertSameOriginMutationRequest(request);
    const context=await authorizeTenantRequest(request);
    if(context.isDevelopmentFallback)throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(context);
    const {id,definitionId}=await ctx.params;
    const input=parseTestBenchMutation(await readBoundedTestBenchBody(request));
    const data=await createTestBenchDefinitionStore(getControlPlaneDatabase())
      .update(actor,id,definitionId,input);
    return NextResponse.json({data,meta:gitMeta()},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
/** Soft archive is also CAS guarded and audited in the same transaction. */
export async function DELETE(request:Request,ctx:RouteContext<typeof route>){
  try{
    assertSameOriginMutationRequest(request);
    const context=await authorizeTenantRequest(request);
    if(context.isDevelopmentFallback)throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(context);
    const {id,definitionId}=await ctx.params;
    const {expectedRevision}=parseTestBenchArchive(await readBoundedTestBenchBody(request));
    const data=await createTestBenchDefinitionStore(getControlPlaneDatabase())
      .archive(actor,id,definitionId,expectedRevision);
    return NextResponse.json({data,meta:gitMeta()},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
