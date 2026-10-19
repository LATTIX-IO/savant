import assert from "node:assert/strict";
import test from "node:test";
import {encryptTestBenchCases,decryptTestBenchCases,testBenchRequestDigest} from "./definition-crypto.ts";
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

test("PER-1422: creation fingerprints are keyed, tenant-separated and do not reveal case prompts",()=>{
 const payload=JSON.stringify({skillId:"skill-1",prompt:"sensitive text"});
 const left=testBenchRequestDigest(payload,ctx.organizationId,env);
 assert.match(left,/^[0-9a-f]{64}$/);
 assert.equal(left,testBenchRequestDigest(payload,ctx.organizationId,env));
 assert.notEqual(left,testBenchRequestDigest(payload,"foreign-organization",env));
 assert.notEqual(left,testBenchRequestDigest(payload,ctx.organizationId,
   {TEST_BENCH_ENCRYPTION_KEY:Buffer.alloc(32,0x39).toString("base64url")}));
 assert.notEqual(left,testBenchRequestDigest(JSON.stringify({skillId:"skill-1",prompt:"changed"}),ctx.organizationId,env));
 assert.doesNotMatch(left,/sensitive text/);
});

test("PER-1425: complete-case receipts have a separate capped encrypted envelope",()=>{
 const observed=JSON.stringify({samples:[{output:"x".repeat(20000)}]});
 const blob=encryptTestBenchCases(observed,ctx,env,65536);
 assert.equal(decryptTestBenchCases(blob,ctx,env,65536),observed);
 assert.throws(()=>decryptTestBenchCases(blob,ctx,env),TestBenchError);
 assert.throws(()=>encryptTestBenchCases(observed,ctx,env),TestBenchError);
 assert.throws(()=>encryptTestBenchCases("y".repeat(65537),ctx,env,65536),TestBenchError);
 assert.throws(()=>decryptTestBenchCases(blob,{...ctx,organizationId:"other"},env,65536),TestBenchError);
});


test("PER-1550: AES v1 legacy reads survive v2 writing and HMAC replay remains stable",()=>{
  const original={TEST_BENCH_ENCRYPTION_KEY:Buffer.alloc(32,0x31).toString("base64url")};
  const migrated={
    TEST_BENCH_ENCRYPTION_KEY:Buffer.alloc(32,0x52).toString("base64url"),
    TEST_BENCH_ENCRYPTION_KEY_ID:"oct2026",
    TEST_BENCH_LEGACY_ENCRYPTION_KEY:original.TEST_BENCH_ENCRYPTION_KEY,
  };
  const value=JSON.stringify([{caseId:"legacy",prompt:"private v1 data"}]);
  const v1=encryptTestBenchCases(value,ctx,original);
  const digestOriginal=testBenchRequestDigest(value,ctx.organizationId,original);
  assert.match(v1,/^v1:/);
  assert.equal(decryptTestBenchCases(v1,ctx,migrated),value);
  assert.equal(testBenchRequestDigest(value,ctx.organizationId,migrated),digestOriginal);
  const v2=encryptTestBenchCases(value,ctx,migrated);
  assert.match(v2,/^v2:oct2026:/);
  assert.equal(decryptTestBenchCases(v2,ctx,migrated),value);
  assert.throws(()=>decryptTestBenchCases(v2,ctx,original),TestBenchError);
  assert.throws(()=>decryptTestBenchCases(v2,{...ctx,organizationId:"other"},migrated),TestBenchError);
  assert.throws(()=>decryptTestBenchCases(v2.replace(":oct2026:",":otherid:"),ctx,migrated),TestBenchError);
});
test("PER-1550: post-rotation previous key can read old v2 without reusing old v1 AES as current",()=>{
  const legacy=Buffer.alloc(32,0x31).toString("base64url");
  const a=Buffer.alloc(32,0x52).toString("base64url");
  const b=Buffer.alloc(32,0x73).toString("base64url");
  const first={
    TEST_BENCH_ENCRYPTION_KEY:a,
    TEST_BENCH_ENCRYPTION_KEY_ID:"oct2026",
    TEST_BENCH_LEGACY_ENCRYPTION_KEY:legacy,
  };
  const after={
    TEST_BENCH_ENCRYPTION_KEY:b,
    TEST_BENCH_ENCRYPTION_KEY_ID:"nov2026",
    TEST_BENCH_LEGACY_ENCRYPTION_KEY:legacy,
    TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:JSON.stringify({oct2026:a}),
  };
  const oldV1=encryptTestBenchCases("v1-data",ctx,{TEST_BENCH_ENCRYPTION_KEY:legacy});
  const previousV2=encryptTestBenchCases("v2-data",ctx,first);
  const newV2=encryptTestBenchCases("v2-new",ctx,after);
  assert.equal(decryptTestBenchCases(oldV1,ctx,after),"v1-data");
  assert.equal(decryptTestBenchCases(previousV2,ctx,after),"v2-data");
  assert.equal(decryptTestBenchCases(newV2,ctx,after),"v2-new");
  assert.throws(()=>decryptTestBenchCases(previousV2,ctx,{
    ...after,TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:"{}",
  }),TestBenchError);
  assert.equal(testBenchRequestDigest("request",ctx.organizationId,first),
    testBenchRequestDigest("request",ctx.organizationId,after));
  assert.throws(()=>encryptTestBenchCases("x",ctx,{
    ...after,TEST_BENCH_LEGACY_ENCRYPTION_KEY:undefined,
  }),e=>e instanceof TestBenchError&&e.code==="test_bench_key_unconfigured");
});
