import assert from "node:assert/strict";
import test from "node:test";
import {TestBenchError} from "./definition-contract.ts";
import {parseObservedComparisonRequest} from "./observed-run-comparison-contract.ts";
const a="11111111-1111-4111-8111-111111111111";
const b="22222222-2222-4222-8222-222222222222";
test("PER-1435: compare request is strictly two different immutable run UUIDs",()=>{
 assert.deepEqual(parseObservedComparisonRequest({baselineRunId:a,candidateRunId:b}),
  {baselineRunId:a,candidateRunId:b});
 for(const value of [
  null,{},[],{baselineRunId:a},{candidateRunId:b},
  {baselineRunId:a,candidateRunId:a},
  {baselineRunId:a.toUpperCase(),candidateRunId:a},
  {baselineRunId:"main",candidateRunId:b},
  {baselineRunId:a,candidateRunId:"../foreign"},
  {baselineRunId:a,candidateRunId:b,workspaceSlug:"foreign"},
  {baselineRunId:a,candidateRunId:b,provider:"new-provider"},
  {baselineRunId:a,candidateRunId:b,judge:"skip"},
  {baselineRunId:a,candidateRunId:b,model:"untrusted"},
  {baselineRunId:a,candidateRunId:b,scoreOverride:100},
  {baselineRunId:a,candidateRunId:b,cases:[{prompt:"private"}]},
  {baselineRunId:a,candidateRunId:b,forcePromotion:true},
 ])
  assert.throws(()=>parseObservedComparisonRequest(value),TestBenchError);
});
