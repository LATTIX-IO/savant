import assert from "node:assert/strict";
import test from "node:test";
import type {ChatClient,JudgeClient,JevAnswer} from "../ai/clients.ts";
import {
  executeObservedCases,ObservedEvaluationError,MAX_OBSERVED_CASES,
} from "./observed-evaluator.ts";
import type {TestBenchCase} from "./definition-contract.ts";

const cases:TestBenchCase[]=[
  {caseId:"case-1",kind:"positive",prompt:"What is 2 + 2?",context:null,expectedBehavior:"Answer 4"},
  {caseId:"case-2",kind:"edge",prompt:"Explain 2 + 2 briefly",context:"Return only one sentence",expectedBehavior:"Answer 4"},
];
const score=(n=4):JevAnswer=>({type:"score",score:n,probabilities:{},confidence:1});
const bin=(n=1):JevAnswer=>({type:"noul",noul:n});
const answers:Record<string,JevAnswer>={
  quality:score(),format_compliance:score(),grounding_score:score(),
  actionability:score(),policy_compliance:bin(),grounding_relevant:bin(),
  expected_met:bin(),revisions:{type:"choice",choice:"0",confidence:1,probabilities:{"0":1}},
};
function mocks(overrides?:{completion?:string;judge?:Record<string,JevAnswer>;nimTokens?:number;jevTokens?:number}):{
  executor:ChatClient;judge:JudgeClient;counts:{nim:number;jev:number};
}{
 const counts={nim:0,jev:0};
 return {
  counts,
  executor:{model:"nim-test",async complete(messages,options){
    counts.nim++;
    assert.equal(options?.timeoutMs,15_000);assert.equal(options?.maxTokens,400);
    assert.equal(messages[1]?.role,"user");
    return {
      content:overrides?.completion??"4",model:"nim-test",
      latencyMs:24,finishReason:"stop",reasoningChars:0,
      usage:{promptTokens:overrides?.nimTokens??75,completionTokens:20},
    };
  }},
  judge:{model:"jev-test",async ask(_state,questions,options){
    counts.jev++;
    assert.equal(options?.timeoutMs,10_000);
    assert.ok(questions.expected_met);
    return {
      model:"jev-test",answers:overrides?.judge??answers,
      usage:{inputTokens:overrides?.jevTokens??70,outputTokens:12},latencyMs:14,
    };
  }},
 };
}
test("PER-1425: real executor/Jev calls produce observed per-case metrics, not synthetic values",async()=>{
 const x=mocks(),progress:number[]=[];
 const result=await executeObservedCases({
  skillName:"calc",instructions:"Answer precisely.",cases,clients:x,
  onCase:async(_sample,index)=>{progress.push(index);},
 });
 assert.equal(x.counts.nim,2);assert.equal(x.counts.jev,2);
 assert.deepEqual(progress,[1,2]);
 assert.equal(result.samples.length,2);
 assert.equal(result.samples[0]?.output,"4");
 assert.equal(result.samples[0]?.latencyMs,24);
 assert.equal(result.samples[0]?.verdict,"pass");
 assert.equal(result.samples[1]?.kind,"edge");
 assert.equal(result.totalTokens,354);
 assert.ok(result.estimatedCostUsd>0);
 assert.equal(result.scorecard.sampleCount,2);
 assert.equal(result.scorecard.passCount,2);
});
test("PER-1425: reject absent/invalid judge verdicts and model usage before any scorecard",async()=>{
 for(const altered of [
  {...answers,quality:undefined},
  {...answers,quality:score(5)},
  {...answers,format_compliance:{type:"choice",choice:"2",confidence:1,probabilities:{}}},
  {...answers,expected_met:bin(1.2)},
  {...answers,revisions:{type:"choice",choice:"7",confidence:1,probabilities:{}}},
 ] as Array<Record<string,JevAnswer>>){
  const x=mocks({judge:altered});
  await assert.rejects(()=>executeObservedCases({skillName:"calc",instructions:"Be accurate",cases:[cases[0]!],clients:x}),
    ObservedEvaluationError);
  assert.equal(x.counts.nim,1);assert.equal(x.counts.jev,1);
 }
 for(const x of [mocks({nimTokens:0,completion:""}),mocks({completion:"x".repeat(3001)})]){
  await assert.rejects(()=>executeObservedCases({skillName:"calc",instructions:"Do this",cases:[cases[0]!],clients:x}),
    ObservedEvaluationError);
 }
});
test("PER-1425: admission and token/cost budgets fail closed",async()=>{
 const one=mocks();
 for(const list of [[],Array(MAX_OBSERVED_CASES+1).fill(cases[0]!)]){
  await assert.rejects(()=>executeObservedCases({skillName:"calc",instructions:"Act",cases:list,clients:one}),
    ObservedEvaluationError);
 }
 assert.equal(one.counts.nim,0);
 await assert.rejects(()=>executeObservedCases({
  skillName:"calc",instructions:"x".repeat(12_100),cases:[cases[0]!],clients:one,
 }),ObservedEvaluationError);
 assert.equal(one.counts.nim,0);
 const limited=mocks();
 await assert.rejects(()=>executeObservedCases({
  skillName:"calc",instructions:"Act",cases,clients:limited,maxTokens:30,
 }),ObservedEvaluationError);
 assert.equal(limited.counts.nim,1);assert.equal(limited.counts.jev,0);
});
test("PER-1425: provider failure never fills unexecuted case results",async()=>{
 const x=mocks();let calls=0;const seen:string[]=[];
 const failing:ChatClient={
  model:x.executor.model,async complete(messages,options){
    calls++;
    if(calls===2)throw Error("provider down");
    return x.executor.complete(messages,options);
  },
 };
 await assert.rejects(()=>executeObservedCases({
  skillName:"calc",instructions:"Act",cases,clients:{executor:failing,judge:x.judge},
  onCase:async s=>{seen.push(s.caseId);},
 }),/provider down/);
 assert.deepEqual(seen,["case-1"]);
});

test("PER-1429: cancellation before the first case prevents all provider egress",async()=>{
 const stub=mocks();
 await assert.rejects(()=>executeObservedCases({
  skillName:"calc",instructions:"Only arithmetic",cases,clients:stub,
  beforeCase:async()=>{throw new ObservedEvaluationError("test_bench_run_cancelled");},
 }),error=>error instanceof ObservedEvaluationError&&error.code==="test_bench_run_cancelled");
 assert.equal(stub.counts.nim,0);assert.equal(stub.counts.jev,0);
});
test("PER-1429: cancellation after NIM prevents Jev judging and score publication",async()=>{
 const stub=mocks();
 const published:string[]=[];
 await assert.rejects(()=>executeObservedCases({
  skillName:"calc",instructions:"Only arithmetic",cases,clients:stub,
  beforeJudge:async()=>{throw new ObservedEvaluationError("test_bench_run_cancelled");},
  onCase:async sample=>{published.push(sample.caseId);},
 }),error=>error instanceof ObservedEvaluationError&&error.code==="test_bench_run_cancelled");
 assert.equal(stub.counts.nim,1);assert.equal(stub.counts.jev,0);
 assert.deepEqual(published,[]);
});
test("PER-1429: cancellation between cases retains only real observations and avoids later costs",async()=>{
 const stub=mocks(),seen:string[]=[];
 await assert.rejects(()=>executeObservedCases({
  skillName:"calc",instructions:"Only arithmetic",cases,clients:stub,
  beforeCase:async index=>{
   if(index===2)throw new ObservedEvaluationError("test_bench_run_cancelled");
  },
  onCase:async sample=>{seen.push(sample.caseId);},
 }),error=>error instanceof ObservedEvaluationError&&error.code==="test_bench_run_cancelled");
 assert.deepEqual(seen,["case-1"]);
 assert.equal(stub.counts.nim,1);assert.equal(stub.counts.jev,1);
});
