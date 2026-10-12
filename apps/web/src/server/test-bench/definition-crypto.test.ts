import assert from "node:assert/strict";
import test from "node:test";
import {encryptTestBenchCases,decryptTestBenchCases} from "./definition-crypto.ts";
import {TestBenchError} from "./definition-contract.ts";
const ctx={
 organizationId:"11111111-1111-4111-8111-111111111111",
 definitionId:"22222222-2222-4222-8222-222222222222",
 revision:1,commitSha:"a".repeat(40),
};
const key=Buffer.alloc(32,0x7e).toString("base64url");
const env={TEST_BENCH_ENCRYPTION_KEY:key};
test("PER-1422: AES-GCM encrypted case roundtrip with randomized nonce",()=>{
 const plain=JSON.stringify([{caseId:"x",prompt:"private prompt"}]);
 const a=encryptTestBenchCases(plain,ctx,env);
 const b=encryptTestBenchCases(plain,ctx,env);
 assert.notEqual(a,b);
 assert.doesNotMatch(a,/private prompt/);
 assert.equal(decryptTestBenchCases(a,ctx,env),plain);
 assert.equal(decryptTestBenchCases(b,ctx,env),plain);
});
test("PER-1422: fail-closed tenant, definition, revision, commit and key swaps",()=>{
 const encrypted=encryptTestBenchCases("private data",ctx,env);
 for(const swapped of [
  {...ctx,organizationId:"another"},
  {...ctx,definitionId:"another"},
  {...ctx,revision:2},
  {...ctx,commitSha:"b".repeat(40)},
 ])
  assert.throws(()=>decryptTestBenchCases(encrypted,swapped,env),TestBenchError);
 assert.throws(()=>decryptTestBenchCases(encrypted,ctx,
  {TEST_BENCH_ENCRYPTION_KEY:Buffer.alloc(32,0x5f).toString("base64url")}),TestBenchError);
});
test("PER-1422: tampering, malformed fragments and unavailable keys never return case data",()=>{
 const value=encryptTestBenchCases("secret draft",ctx,env);
 for(const broken of ["","v2:not:valid:stuff","v1:x:y:z",
  value.slice(0,-1)+"a",value.replace(/:[^:]+$/,":abc!"),"A".repeat(32769)]) {
  if(broken===value)continue;
  assert.throws(()=>decryptTestBenchCases(broken,ctx,env),TestBenchError);
 }
 for(const broken of [{},{TEST_BENCH_ENCRYPTION_KEY:"not valid"},
   {TEST_BENCH_ENCRYPTION_KEY:"a".repeat(20)}]){
  assert.throws(()=>encryptTestBenchCases("secret draft",ctx,broken),
   (e:unknown)=>e instanceof TestBenchError&&e.code==="test_bench_key_unconfigured");
  assert.throws(()=>decryptTestBenchCases(value,ctx,broken),TestBenchError);
 }
});
