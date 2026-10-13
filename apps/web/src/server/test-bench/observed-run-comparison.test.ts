import assert from "node:assert/strict";
import test from "node:test";
import {DEFAULT_RUBRIC} from "../evaluation/eval-generation.ts";
import {computeScorecard} from "../evaluation/scorecard.ts";
import {TestBenchError} from "./definition-contract.ts";
import {OBSERVED_SCORING_FINGERPRINT} from "./observed-evaluator.ts";
import {compareObservedRuns,type ComparableObservedRun} from "./observed-run-comparison.ts";

const org="11111111-1111-4111-8111-111111111111";
const skill="safe-skill";
const cases=[{caseId:"a1",kind:"positive" as const,prompt:"PRIVATE_TEST_PROMPT",
 context:null,expectedBehavior:"answer accurately"}];
function run(id:string,sha:string,quality=0.75):ComparableObservedRun{
 const samples=[{
  caseId:"a1",kind:"positive" as const,prompt:cases[0]!.prompt,
  quality,formatCompliance:1,policyCompliance:true,groundingRelevant:true,
  groundingScore:quality,actionability:quality,expectedMet:1,verdict:"pass" as const,
  latencyMs:quality===1?32:52,estimatedCostUsd:0.001,humanRevisionCount:0,
  output:"PRIVATE_MODEL_OUTPUT",executionModel:"nim-qa",judgeModel:"jev-qa",
 }];
 return {
  id,organizationId:org,skillId:skill,definitionId:"def-"+id,
  sourceCommitSha:sha,definitionRevision:1,status:"complete",
  expectedCases:1,completedCases:1,cases,samples,
  scorecard:{...computeScorecard(samples,DEFAULT_RUBRIC),
    scoringContract:OBSERVED_SCORING_FINGERPRINT},
  executionModel:"nim-qa",judgeModel:"jev-qa",completedAt:"2026-10-13T09:00:00Z",
  estimatedCostUsd:0.001,totalTokens:240,
  executionSource:"platform-nim",executionConnectionId:null,
  executionSecretFingerprint:null,costAccounting:"platform-estimate",
 };
}
const baseline=run("base","a".repeat(40));
const candidate=run("candidate","b".repeat(40),1);
const rejected=(r:ComparableObservedRun,c:ComparableObservedRun):void=>{
 assert.throws(()=>compareObservedRuns(r,c),
  error=>error instanceof TestBenchError&&error.code==="test_bench_runs_not_comparable");
};
test("PER-1435: valid different-commit observed evidence yields *descriptive* paired deltas only",()=>{
 const result=compareObservedRuns(baseline,candidate);
 assert.equal(result.status,"descriptive_only");
 assert.equal(result.caseCount,1);
 assert.ok(result.overallScoreDelta>0);
 assert.equal(result.cases[0]?.caseId,"a1");
 assert.equal(result.cases[0]?.qualityDeltaPoints,25);
 assert.equal(result.cases[0]?.latencyDeltaMs,-20);
 assert.equal(result.passRateDeltaPercentagePoints,0);
 assert.match(result.limitations,/Not statistically significant/);
 assert.equal(result.baseline.sourceCommitSha,"a".repeat(40));
 assert.equal(result.candidate.sourceCommitSha,"b".repeat(40));
 const serialized=JSON.stringify(result);
 assert.doesNotMatch(serialized,/PRIVATE_TEST_PROMPT|PRIVATE_MODEL_OUTPUT|pValue|confidenceInterval|significant:true/);
});
test("PER-1435: reject same source, same run, cross-tenant/skill and case drift",()=>{
 rejected(baseline,{...candidate,id:baseline.id});
 rejected(baseline,{...candidate,sourceCommitSha:baseline.sourceCommitSha});
 rejected(baseline,{...candidate,sourceCommitSha:"main"});
 rejected(baseline,{...candidate,organizationId:"foreign"});
 rejected(baseline,{...candidate,skillId:"foreign"});
 rejected(baseline,{...candidate,cases:[{...cases[0]!,prompt:"different"}]});
 rejected(baseline,{...candidate,cases:[{...cases[0]!,expectedBehavior:"different"}]});
 rejected(baseline,{...candidate,cases:[{...cases[0]!,context:"different"}]});
 rejected(baseline,{...candidate,cases:[{...cases[0]!,caseId:"b2"}]});
});
test("PER-1435: reject mismatched model, judge, rubric and historical unfingerprinted scorecards",()=>{
 rejected(baseline,{...candidate,executionModel:"other-executor"});
 rejected(baseline,{...candidate,executionSource:"workspace-openai",
   costAccounting:"normalized-qa-proxy",executionConnectionId:"tenant-conn"});
 rejected(baseline,{...candidate,costAccounting:"normalized-qa-proxy"});
 const byok={...baseline,executionSource:"workspace-openai" as const,
   executionConnectionId:"22222222-2222-4222-8222-222222222222",
   executionSecretFingerprint:"a".repeat(64),
   costAccounting:"normalized-qa-proxy" as const};
 rejected(byok,{...candidate,...byok,id:candidate.id,
   sourceCommitSha:candidate.sourceCommitSha,
   executionSecretFingerprint:"b".repeat(64)});
 rejected(baseline,{...candidate,judgeModel:"other-judge"});
 rejected(baseline,{...candidate,scorecard:{...candidate.scorecard,
    scoringContract:"old-unknown-rubric"}});
 rejected({...baseline,scorecard:{...baseline.scorecard,scoringContract:null}},candidate);
 rejected(baseline,{...candidate,scorecard:null});
 rejected(baseline,{...candidate,scorecard:{...candidate.scorecard,overallScore:99}});
});
test("PER-1435: no canceled, partial, forged or invalid metric run can produce a comparison",()=>{
 rejected({...baseline,status:"canceled"},candidate);
 rejected({...baseline,status:"failed"},candidate);
 rejected({...baseline,status:"running"},candidate);
 rejected({...baseline,completedCases:0},candidate);
 rejected({...baseline,samples:[]},candidate);
 rejected({...baseline,totalTokens:0},candidate);
 rejected({...baseline,samples:[{...baseline.samples[0]!,caseId:"forged"}]},candidate);
 rejected({...baseline,samples:[{...baseline.samples[0]!,output:"x".repeat(3000)}]},candidate);
 rejected({...baseline,samples:[{...baseline.samples[0]!,quality:Infinity}]},candidate);
 rejected({...baseline,samples:[{...baseline.samples[0]!,latencyMs:-1}]},candidate);
 rejected({...baseline,samples:[{...baseline.samples[0]!,executionModel:"other"}]},candidate);
 rejected({...baseline,scorecard:{...baseline.scorecard,passCount:0}},candidate);
});
