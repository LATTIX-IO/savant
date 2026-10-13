import assert from "node:assert/strict";
import test from "node:test";
import {
  listComparableObservedRuns,compareCompletedObservedRuns,
  parseObservedComparison,ComparisonClientError,
} from "./observed-run-comparison-client.ts";
const a="11111111-1111-4111-8111-111111111111";
const b="22222222-2222-4222-8222-222222222222";
const def="33333333-3333-4333-8333-333333333333";
const base={id:a,definitionId:def,sourceCommitSha:"a".repeat(40),
 completedAt:"2026-10-13T14:30:00.000Z",executionModel:"nim",judgeModel:"jev",
 caseCount:1,overallScore:70};
const cand={...base,id:b,sourceCommitSha:"b".repeat(40),overallScore:90};
const report={
 status:"descriptive_only",caseCount:1,baseline:base,candidate:cand,
 overallScoreDelta:20,passRateDeltaPercentagePoints:0,
 meanLatencyDeltaMs:-20,estimatedCostDeltaUsd:0,
 cases:[{caseId:"a1",baselineVerdict:"pass",candidateVerdict:"pass",
  qualityDeltaPoints:25,latencyDeltaMs:-20}],
 limitations:"Not statistically significant; chat-only descriptive comparison, no approval.",
};
function fake(data:unknown,status=200,check?:(url:string,init:RequestInit)=>void):typeof fetch{
 return async (url,init)=>{
  check?.(String(url),init??{});
  return new Response(JSON.stringify({data}),{status,headers:{"content-type":"application/json"}});
 };
}
test("PER-1435: tenant-scoped GET returns only completed run metadata",async()=>{
 const items=await listComparableObservedRuns("dir/qa+skill",{
  workspaceSlug:"tenant-a",fetcher:fake([base,cand],200,(url,init)=>{
   assert.equal(url,"/api/skills/dir%2Fqa%2Bskill/test-bench/compare?workspaceSlug=tenant-a");
   assert.equal(init.method,"GET");
   assert.equal(init.credentials,"same-origin");
   assert.equal(init.mode,"same-origin");
   assert.equal(init.cache,"no-store");
  }),
 });
 assert.equal(items.length,2);
 assert.equal(items[0]?.sourceCommitSha,"a".repeat(40));
});
test("PER-1435: POST sends ONLY two run UUIDs and verifies ordered provenance",async()=>{
 const result=await compareCompletedObservedRuns("skill",a,b,{
  workspaceSlug:"tenant-a",fetcher:fake(report,200,(url,init)=>{
   assert.equal(url,"/api/skills/skill/test-bench/compare?workspaceSlug=tenant-a");
   assert.equal(init.method,"POST");
   assert.equal(init.credentials,"same-origin");assert.equal(init.mode,"same-origin");
   assert.deepEqual(JSON.parse(String(init.body)),{baselineRunId:a,candidateRunId:b});
   assert.doesNotMatch(String(init.body),/prompt|output|apiKey|provider|sourceCommitSha/);
  }),
 });
 assert.equal(result.overallScoreDelta,20);
 assert.equal(result.cases[0]?.latencyDeltaMs,-20);
});
test("PER-1435: forged results, invalid case metrics and false significance claims rejected",()=>{
 for(const value of [
  {...report,status:"statistically_significant"},
  {...report,limitations:"Proven statistically significant."},
  {...report,baseline:{...base,id:"foreign"}},
  {...report,candidate:{...cand,sourceCommitSha:base.sourceCommitSha}},
  {...report,candidate:{...cand,executionModel:"different"}},
  {...report,caseCount:5},
  {...report,cases:[]},
  {...report,overallScoreDelta:Infinity},
  {...report,cases:[{...report.cases[0],qualityDeltaPoints:200}]},
  {...report,cases:[{...report.cases[0],latencyDeltaMs:NaN}]},
  {...report,cases:[{...report.cases[0],candidateVerdict:"simulated"}]},
 ])
  assert.throws(()=>parseObservedComparison(value,a,b),ComparisonClientError);
});
test("PER-1435: invalid workspace IDs and error response do not initiate further I/O",async()=>{
 let sent=0;
 const fetcher:typeof fetch=async()=>{sent++;throw Error("unexpected network");};
 for(const workspaceSlug of ["","../foreign","BAD","tenant/x","a?b"]){
  await assert.rejects(()=>listComparableObservedRuns("skill",{
   workspaceSlug,fetcher,
  }),ComparisonClientError);
 }
 await assert.rejects(()=>compareCompletedObservedRuns("skill",a,a,{
  workspaceSlug:"tenant-a",fetcher,
 }),ComparisonClientError);
 assert.equal(sent,0);
 await assert.rejects(()=>compareCompletedObservedRuns("skill",a,b,{
  workspaceSlug:"tenant-a",fetcher:fake({error:"denied"},404),
 }),ComparisonClientError);
});
