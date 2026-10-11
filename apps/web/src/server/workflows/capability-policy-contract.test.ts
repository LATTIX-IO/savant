import assert from "node:assert/strict";
import test from "node:test";
import {
  PolicyAdminError, parsePolicyScope, parsePolicyMutation,
  parsePolicyIfMatch, policyETag, policyMutationDigest,
} from "./capability-policy-contract.ts";

const repositoryId="11111111-1111-4111-8111-111111111111";
const userId="22222222-2222-4222-8222-222222222222";
const scope=()=>({repositoryId,kind:"skill",artifactId:"review/quality"});
const mutation=()=>({...scope(),operation:"grant",effect:"deny",principalType:"user",principalRef:userId,requestId:"33333333-3333-4333-8333-333333333333"});
const code=(name:string)=>(err:unknown)=>err instanceof PolicyAdminError&&err.code===name;
test("PER-1203: policy scope, rule and revision token are deterministic",()=>{
  const valid=parsePolicyMutation(mutation());
  assert.equal(valid.kind,"skill");
  assert.equal(valid.principalRef,userId);
  assert.equal(policyETag(17),'"v17"');
  assert.equal(parsePolicyIfMatch('"v17"'),17);
  assert.equal(policyMutationDigest(valid).length,64);
  assert.equal(policyMutationDigest(valid),policyMutationDigest({...valid}));
});
test("PER-1203: invalid scope denied before any DB access",()=>{
  for(const invalid of [
    {...scope(),repositoryId:"foreign"},{...scope(),kind:"model"},
    {...scope(),artifactId:"../secrets"},{...scope(),artifactId:""},
    {...scope(),organizationId:"tenant-forged"},
    {...scope(),unexpected:"unused"},
  ])assert.throws(()=>parsePolicyScope(invalid),code("invalid_policy_scope"));
});
test("PER-1203: principal, operation, type and spoofed authority validated",()=>{
  for(const invalid of [
    {...mutation(),principalType:"service"},
    {...mutation(),principalRef:"external@example.test"},
    {...mutation(),effect:"execute"},
    {...mutation(),operation:"patch"},
    {...mutation(),requestId:"not-a-uuid"},
    {...mutation(),tenantId:"foreign"},
    {...mutation(),url:"https://example.org/repo"},
    {...mutation(),principalType:"role",principalRef:"admin"},
  ])assert.throws(()=>parsePolicyMutation(invalid),code("invalid_policy_mutation"));
  const role=parsePolicyMutation({...mutation(),principalType:"role",principalRef:"member"});
  assert.equal(role.principalRef,"member");
});
test("PER-1203: revision precondition is mandatory and strict",()=>{
  for(const invalid of [null,undefined,"","*","\"0\"","\"v01\"","\"v-1\"","\"v1\" extra"]) {
    assert.throws(()=>parsePolicyIfMatch(invalid),code("policy_precondition_required"));
  }
  assert.equal(parsePolicyIfMatch('"v0"'),0);
  assert.equal(parsePolicyIfMatch('"v900"'),900);
});
test("PER-1203: content-independent mutation digest separates distinct operations",()=>{
  const item=parsePolicyMutation(mutation());
  const changed=parsePolicyMutation({...mutation(),effect:"allow"});
  assert.notEqual(policyMutationDigest(item),policyMutationDigest(changed));
  assert.notEqual(policyMutationDigest(item),policyMutationDigest({...item,operation:"revoke"}));
});
test("PER-1203: malicious descriptors and exotic prototypes never execute getters",()=>{
  const obj=mutation();
  Object.defineProperty(obj,"extra",{enumerable:true,get(){throw Error("must not run");}});
  assert.throws(()=>parsePolicyMutation(obj),code("invalid_policy_mutation"));
  assert.throws(()=>parsePolicyMutation(Object.assign(Object.create({attack:true}),mutation())),code("invalid_policy_mutation"));
});
