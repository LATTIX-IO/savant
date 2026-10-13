import assert from "node:assert/strict";
import test from "node:test";
import {
  listObservedTestBenchRuns,startObservedTestBenchRun,cancelObservedTestBenchRun,parseObservedRun,ObservedRunClientError,
} from "./observed-test-bench-runs.ts";
const skillId="team/skill+qa",workspaceSlug="tenant-a";
const definitionId="97ee557d-3dc0-4ee1-af29-72fedc58e4d7";
const runId="779d6f61-c5c6-43ed-8c7d-2f230a84eac4";
const sha="a".repeat(40);
const base={
 id:runId,definitionId,skillId,sourceCommitSha:sha,
 definitionRevision:1,status:"queued",expectedCases:1,completedCases:0,
 samples:[],scorecard:null,totalTokens:0,estimatedCostUsd:0,
 executionModel:null,judgeModel:null,errorCode:null,
 executionSource:"platform-nim",executionModelPinned:null,costAccounting:"platform-estimate",
 createdAt:"2026-10-12T10:00:00Z",updatedAt:"2026-10-12T10:00:00Z",completedAt:null,
};
const one={
 caseId:"case-1",output:"4",latencyMs:25,verdict:"pass",
};
function fake(value:unknown,status=200,onCall?:(url:string,init:RequestInit)=>void):typeof fetch{
 return async (url,init)=>{
  onCall?.(String(url),init??{});
  return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
 };
}
test("PER-1425: GET is tenant-bound, same-origin and no-store",async()=>{
 const value=await listObservedTestBenchRuns(skillId,definitionId,sha,{
  workspaceSlug,fetcher:fake({data:[base]},200,(url,init)=>{
   assert.equal(url,
    "/api/skills/team%2Fskill%2Bqa/test-bench/"+definitionId+"/runs?workspaceSlug=tenant-a");
   assert.equal(init.method,"GET");assert.equal(init.mode,"same-origin");
   assert.equal(init.credentials,"same-origin");assert.equal(init.cache,"no-store");
  }),
 });
 assert.equal(value.length,1);assert.equal(value[0]?.status,"queued");
});
test("PER-1425: POST only claims actual HTTP 202/200 and never sends cases or provider secrets",async()=>{
 const key="7a67bff0-a660-42ab-9247-1befef2b9d55";
 const accepted=await startObservedTestBenchRun(skillId,definitionId,sha,{
  requestId:key,expectedRevision:1,
 },{workspaceSlug,fetcher:fake({data:base},202,(url,init)=>{
  assert.match(url,/workspaceSlug=tenant-a$/);
  assert.equal(init.method,"POST");assert.equal(init.mode,"same-origin");
  const body=JSON.parse(String(init.body));
  assert.deepEqual(body,{requestId:key,expectedRevision:1});
  assert.doesNotMatch(String(init.body),/provider|apiKey|sourceCommitSha|prompt/);
 })});
 assert.equal(accepted.id,runId);
 await assert.rejects(()=>startObservedTestBenchRun(skillId,definitionId,sha,{
  requestId:key,expectedRevision:1,
 },{workspaceSlug,fetcher:fake({data:base},201)}),ObservedRunClientError);
});
test("PER-1425: forged provenance, synthetic results and incomplete scorecards fail validation",()=>{
 for(const bad of [
  {...base,definitionId:"foreign"},
  {...base,skillId:"foreign"},
  {...base,sourceCommitSha:"main"},
  {...base,sourceCommitSha:"b".repeat(40)},
  {...base,status:"published"},
  {...base,expectedCases:9},
  {...base,completedCases:1,samples:[]},
  {...base,scorecard:{overallScore:99}},
  {...base,status:"complete",scorecard:null},
  {...base,status:"complete",completedCases:1,
    samples:[{...one,output:"secret".repeat(400)}],scorecard:{overallScore:99}},
  {...base,status:"failed",completedCases:1,
    samples:[{...one,verdict:"simulated"}]},
 ])assert.throws(()=>parseObservedRun(bad,skillId,definitionId,sha),ObservedRunClientError);
 const complete={...base,status:"complete",completedCases:1,samples:[one],
  scorecard:{overallScore:99},totalTokens:100,estimatedCostUsd:0.00005};
 assert.equal(parseObservedRun(complete,skillId,definitionId,sha).samples[0]?.output,"4");
});
test("PER-1425: invalid tenant and denied request never initiate cross-origin I/O",async()=>{
 let sent=0;
 const fetcher:typeof fetch=async()=>{sent++;throw Error("unexpected outbound call");};
 for(const workspaceSlug of ["","../foreign","BAD","tenant/a","tenant?extra=1"]){
  await assert.rejects(()=>listObservedTestBenchRuns(skillId,definitionId,sha,{
   workspaceSlug,fetcher,
  }),ObservedRunClientError);
 }
 assert.equal(sent,0);
 await assert.rejects(()=>listObservedTestBenchRuns(skillId,definitionId,sha,{
  workspaceSlug:"tenant-a",fetcher:fake({error:"denied"},403),
 }),ObservedRunClientError);
});

test("PER-1429: cancel exact run with same-origin credentials and no secret-bearing payload",async()=>{
 const canceled={...base,status:"canceled",canceledAt:"2026-10-13T10:00:00Z",
  canceledBy:"member-subject",completedAt:"2026-10-13T10:00:00Z"};
 const result=await cancelObservedTestBenchRun(skillId,definitionId,sha,runId,1,{
  workspaceSlug,fetcher:fake({data:canceled},202,(url,init)=>{
   assert.equal(url,
    "/api/skills/team%2Fskill%2Bqa/test-bench/"+definitionId+
    "/runs/"+runId+"/cancel?workspaceSlug=tenant-a");
   assert.equal(init.method,"POST");assert.equal(init.mode,"same-origin");
   assert.equal(init.credentials,"same-origin");assert.equal(init.cache,"no-store");
   assert.deepEqual(JSON.parse(String(init.body)),{expectedRevision:1});
   assert.doesNotMatch(String(init.body),/token|case|provider|apiKey|sourceCommitSha/);
  }),
 });
 assert.equal(result.status,"canceled");assert.equal(result.canceledBy,"member-subject");
 await assert.rejects(()=>cancelObservedTestBenchRun(skillId,definitionId,sha,runId,1,{
  workspaceSlug,fetcher:fake({data:{...canceled,status:"complete"}},200),
 }),ObservedRunClientError);
 await assert.rejects(()=>cancelObservedTestBenchRun(skillId,definitionId,sha,"../foreign",1,{
  workspaceSlug,fetcher:async()=>{throw Error("network must not occur");},
 }),ObservedRunClientError);
});
test("PER-1429: reject forged canceled responses lacking terminal provenance or carrying scores",()=>{
 for(const altered of [
  {...base,status:"canceled",canceledAt:null,canceledBy:"owner"},
  {...base,status:"canceled",canceledAt:"not a date",canceledBy:"owner"},
  {...base,status:"canceled",canceledAt:"2026-10-13T10:00:00Z",canceledBy:null},
  {...base,status:"canceled",canceledAt:"2026-10-13T10:00:00Z",canceledBy:"owner",scorecard:{overallScore:100}},
 ])assert.throws(()=>parseObservedRun(altered,skillId,definitionId,sha),ObservedRunClientError);
});

test("PER-1438: client labels the workspace provider explicitly and never carries secrets",async()=>{
 const key="7a67bff0-a660-42ab-9247-1befef2b9d55";
 const accepted=await startObservedTestBenchRun(skillId,definitionId,sha,{
  requestId:key,expectedRevision:1,executionSource:"workspace-openai",
 },{workspaceSlug,fetcher:fake({data:{...base,executionSource:"workspace-openai",
  executionModelPinned:"gpt-4o-mini-2024-07-18",costAccounting:"normalized-qa-proxy"}},202,
  (_url,init)=>{
   assert.deepEqual(JSON.parse(String(init.body)),{
    requestId:key,expectedRevision:1,executionSource:"workspace-openai",
   });
   assert.doesNotMatch(String(init.body),/apiKey|credential|tenantId|baseUrl|secret|model|token/);
  })});
 assert.equal(accepted.executionSource,"workspace-openai");
 assert.equal(accepted.costAccounting,"normalized-qa-proxy");
 for(const forged of [
  {...base,executionSource:"workspace-openai",costAccounting:"platform-estimate",
    executionModelPinned:"gpt-4o-mini-2024-07-18"},
  {...base,executionSource:"workspace-openai",costAccounting:"normalized-qa-proxy",
    executionModelPinned:null},
  {...base,executionSource:"malicious-host"},
  {...base,costAccounting:"normalized-qa-proxy"},
 ])assert.throws(()=>parseObservedRun(forged,skillId,definitionId,sha),ObservedRunClientError);
});
