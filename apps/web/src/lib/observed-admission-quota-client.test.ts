import assert from "node:assert/strict";
import test from "node:test";
import {DailyQuotaClientError,readObservedDailyQuota} from "./observed-admission-quota-client.ts";

const report={
  utcDay:"2026-10-13",resetAtUtc:"2026-10-14T00:00:00.000Z",
  dailyRunLimit:10,admittedRuns:2,remainingRuns:8,
  dailyNormalizedTokenLimit:120000,reservedNormalizedTokens:24000,
  remainingNormalizedTokens:96000,releasesOnCancel:false,
  accounting:"normalized-admission-reservation",
};
const mocked=(data:unknown,status=200,check?:(url:string,opts:RequestInit)=>void):typeof fetch=>
  async(url,opts)=>{
    check?.(String(url),opts??{});
    return new Response(JSON.stringify({data}),{status});
  };

test("PER-1444: quota client uses exact tenant slug, no-store and same-origin only",async()=>{
  const value=await readObservedDailyQuota("tenant-a",{
    fetcher:mocked(report,200,(url,init)=>{
      assert.equal(url,"/api/test-bench/quota?workspaceSlug=tenant-a");
      assert.equal(init.method,"GET");
      assert.equal(init.mode,"same-origin");
      assert.equal(init.credentials,"same-origin");
      assert.equal(init.cache,"no-store");
      assert.equal((init.headers as Record<string,string>).Accept,"application/json");
      assert.equal(init.body,undefined);
    }),
  });
  assert.equal(value.remainingRuns,8);
  assert.equal(value.releasesOnCancel,false);
});
test("PER-1444: no malformed cross-tenant slug or untrusted quota payload can bypass client guards",async()=>{
  let requests=0;
  const fail:typeof fetch=async()=>{requests++;throw Error("unexpected network");};
  for(const slug of ["","../foreign","tenant/x","SUSPICIOUS","tenant?x=1","a".repeat(81)]){
    await assert.rejects(()=>readObservedDailyQuota(slug,{fetcher:fail}),DailyQuotaClientError);
  }
  assert.equal(requests,0);
  for(const data of [
    null,[],{},
    {...report,admittedRuns:11,remainingRuns:-1},
    {...report,remainingRuns:9},
    {...report,reservedNormalizedTokens:0},
    {...report,dailyNormalizedTokenLimit:999_999},
    {...report,releasesOnCancel:true},
    {...report,accounting:"actual-invoice"},
  ]){
    await assert.rejects(()=>readObservedDailyQuota("tenant-a",{
      fetcher:mocked(data),
    }),DailyQuotaClientError);
  }
  await assert.rejects(()=>readObservedDailyQuota("tenant-a",{
    fetcher:mocked({error:"denied"},403),
  }),DailyQuotaClientError);
});
test("PER-1444: authenticated API and workbench never identify quota as actual provider spending",async()=>{
  const {readFile}=await import("node:fs/promises");
  const route=await readFile(new URL("../app/api/test-bench/quota/route.ts",import.meta.url),"utf8");
  const worker=await readFile(new URL("../server/test-bench/observed-run-store.ts",import.meta.url),"utf8");
  const ui=await readFile(new URL("../components/savant/screens/observed-test-bench-run-panel.tsx",import.meta.url),"utf8");
  assert.match(route,/authorizeTenantRequest\(request\)/);
  assert.match(route,/resolveGitActorForTenant\(tenant\)/);
  assert.match(route,/Cache-Control.*no-store/);
  assert.match(worker,/await reserveDailyAdmission\(tx,actor\.organizationId\)/);
  assert.match(ui,/readObservedDailyQuota/);
  assert.match(ui,/not a provider spend cap/);
  assert.match(ui,/cancellation and failure/i);
  assert.doesNotMatch(route,/NVIDIA_NIM_API_KEY|OPENAI_API_KEY|JEV_API_KEY|req\.body/);
});
