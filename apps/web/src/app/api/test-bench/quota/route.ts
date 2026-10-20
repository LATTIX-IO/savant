import {NextResponse} from "next/server";
import {getControlPlaneDatabase} from "@/server/control-plane/database";
import {authorizeTenantRequest} from "@/server/control-plane/tenant-context";
import {gitErrorResponse,gitMeta} from "@/server/git/route-helpers";
import {resolveGitActorForTenant} from "@/server/git/runtime";
import {TestBenchError} from "@/server/test-bench/definition-contract";
import {createObservedRunStore} from "@/server/test-bench/observed-run-store";

/** Active authenticated tenant only; quotas are tenant-scoped read-only
 * admission units, not billing records, API keys or measured provider costs.
 */
export async function GET(request:Request){
  try{
    const tenant=await authorizeTenantRequest(request);
    if(tenant.isDevelopmentFallback)
      throw new TestBenchError("test_bench_persistence_required",503);
    const actor=await resolveGitActorForTenant(tenant);
    const data=await createObservedRunStore(getControlPlaneDatabase()).quota(actor);
    return NextResponse.json({data,meta:gitMeta()},
      {headers:{"Cache-Control":"no-store"}});
  }catch(error){return gitErrorResponse(error);}
}
