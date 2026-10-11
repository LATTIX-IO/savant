import assert from "node:assert/strict";
import test from "node:test";
import { evaluateArtifactReadDecision } from "./capability-artifact-access.ts";

test("PER-1201: absent artifact rules inherit separately verified repository access",()=>{
  assert.equal(evaluateArtifactReadDecision({ruleCount:0,allow:false,deny:false}),true);
});
test("PER-1201: existing artifact rules require explicit matched read allow",()=>{
  assert.equal(evaluateArtifactReadDecision({ruleCount:1,allow:false,deny:false}),false);
  assert.equal(evaluateArtifactReadDecision({ruleCount:1,allow:true,deny:false}),true);
});
test("PER-1201: explicit artifact deny overrides user, role or group allow",()=>{
  for (const allow of [false,true]) {
    assert.equal(evaluateArtifactReadDecision({ruleCount:2,allow,deny:true}),false);
  }
});
test("PER-1201: inconsistent or invalid policy evaluation fails closed",()=>{
  for(const input of [
    {ruleCount:-1,allow:true,deny:false},{ruleCount:Number.NaN,allow:true,deny:false},
    {ruleCount:0,allow:true,deny:false},{ruleCount:1,allow:false,deny:true},
  ]) {
    assert.equal(evaluateArtifactReadDecision(input),false);
  }
});
