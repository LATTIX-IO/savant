import assert from "node:assert/strict";
import test from "node:test";
import {
  isActiveLiveEvaluation,loadLiveEvalAutomation,parseLiveEvalAccepted,
  parseLiveEvalAutomation,startLiveEvalAutomation,LiveEvaluationUnavailable,
} from "./live-evaluation-automation.ts";

const skillId="team/core+agent";
const sha="a".repeat(40);
const finished={
  id:"run-1",skillId,status:"needs_review",commitSha:sha,
  createdAt:"2026-10-12T12:00:00Z",completedAt:"2026-10-12T12:30:00Z",
  error:null,rounds:3,scorecard:{overallScore:87.5},
};
const payload={data:{skillId,canGenerate:true,services:{nim:true,jev:true},runs:[finished]}};
function stub(body:unknown,status=200,trace?:(url:string,init:RequestInit)=>void):typeof fetch {
 return async (input,init)=>{
  trace?.(String(input),init ?? {});
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
 };
}
test("PER MVP live eval: tenant-bound persisted runs display real SHA and score",()=>{
 const value=parseLiveEvalAutomation(payload,skillId);
 assert.equal(value.runs[0]?.score,87.5);
 assert.equal(value.runs[0]?.commitSha,sha);
 assert.equal(value.runs[0]?.status,"needs_review");
 assert.equal(value.canGenerate,true);
 assert.equal(isActiveLiveEvaluation("queued"),true);
 assert.equal(isActiveLiveEvaluation("running"),true);
 assert.equal(isActiveLiveEvaluation("needs_review"),false);
});
test("PER MVP live eval: same-origin GET with escaped skill and no-store",async()=>{
 let observed=false;
 const result=await loadLiveEvalAutomation(skillId,{fetcher:stub(payload,200,(url,init)=>{
  observed=true;
  assert.equal(url,"/api/skills/team%2Fcore%2Bagent/automation?skillId=team%2Fcore%2Bagent");
  assert.equal(init.method,"GET");
  assert.equal(init.credentials,"same-origin");
  assert.equal(init.cache,"no-store");
 })});
 assert.equal(observed,true);
 assert.equal(result.runs.length,1);
});
test("PER MVP live eval: POST is same-origin, explicitly accepted and bound to requested skill",async()=>{
 let observed=false;
 const run=await startLiveEvalAutomation(skillId,{fetcher:stub({data:{...finished,status:"queued"}},202,(url,init)=>{
  observed=true;
  assert.equal(url,"/api/skills/team%2Fcore%2Bagent/automation/generate?skillId=team%2Fcore%2Bagent");
  assert.equal(init.method,"POST");
  assert.equal(init.mode,"same-origin");
  assert.equal(init.credentials,"same-origin");
 })});
 assert.equal(observed,true);
 assert.equal(run.status,"queued");
});
test("PER MVP live eval: deny mismatched tenant skill, status injection and forged provenance",()=>{
 const rejected=[
  {...finished,skillId:"foreign"},
  {...finished,status:"publishable"},
  {...finished,commitSha:"main"},
  {...finished,commitSha:"../main"},
  {...finished,commitSha:"A".repeat(40)},
  {...finished,id:""},
 ];
 for(const run of rejected) {
  assert.throws(()=>parseLiveEvalAutomation({data:{...payload.data,runs:[run]}},skillId),
   LiveEvaluationUnavailable);
  assert.throws(()=>parseLiveEvalAccepted({data:run},skillId),
   LiveEvaluationUnavailable);
 }
 assert.throws(()=>parseLiveEvalAutomation({data:{...payload.data,skillId:"foreign"}},skillId),
  LiveEvaluationUnavailable);
 assert.throws(()=>parseLiveEvalAutomation({data:{...payload.data,canGenerate:"yes"}},skillId),
  LiveEvaluationUnavailable);
 assert.throws(()=>parseLiveEvalAutomation({data:{...payload.data,services:{nim:"yes",jev:true}}},skillId),
  LiveEvaluationUnavailable);
 assert.throws(()=>parseLiveEvalAutomation({data:{...payload.data,runs:Array(21).fill(finished)}},skillId),
  LiveEvaluationUnavailable);
});
test("PER MVP live eval: failed requests, unexpected status, missing JSON and invalid IDs fail closed",async()=>{
 await assert.rejects(()=>startLiveEvalAutomation(skillId,{fetcher:stub({data:finished},200)}),LiveEvaluationUnavailable);
 await assert.rejects(()=>startLiveEvalAutomation(skillId,{fetcher:stub({error:"forbidden"},403)}),LiveEvaluationUnavailable);
 await assert.rejects(()=>loadLiveEvalAutomation(skillId,{fetcher:stub({error:"unauthorized"},401)}),LiveEvaluationUnavailable);
 await assert.rejects(()=>loadLiveEvalAutomation(skillId,{fetcher:stub({data:null})}),LiveEvaluationUnavailable);
 await assert.rejects(()=>loadLiveEvalAutomation(" "+skillId,{fetcher:stub(payload)}),LiveEvaluationUnavailable);
 await assert.rejects(()=>loadLiveEvalAutomation("",{fetcher:stub(payload)}),LiveEvaluationUnavailable);
});

test("PER MVP live eval: abort signal is forwarded or explicitly null, never undefined",async()=>{
 const controller=new AbortController();
 await loadLiveEvalAutomation(skillId,{signal:controller.signal,
  fetcher:stub(payload,200,(_url,init)=>{
   assert.equal(init.signal,controller.signal);
  }),
 });
 await startLiveEvalAutomation(skillId,{fetcher:stub({data:{...finished,status:"queued"}},202,(_url,init)=>{
  assert.equal(init.signal,null);
 })});
});
