import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTestBenchCreate,parseTestBenchDraft,parseTestBenchMutation,
  parseTestBenchArchive,parseTestBenchCases,TestBenchError,
} from "./definition-contract.ts";
const requestId="246a7a61-e953-41b5-982c-629c62433a19";
const one={caseId:"login-1",kind:"positive",prompt:"Summarize a safe sample",
  context:null,expectedBehavior:"Stay factual"};
const draft={name:"My QA suite",cases:[one]};
const assertCode=(code:string)=>(e:unknown)=>e instanceof TestBenchError&&e.code===code;

test("PER-1422: normalization and bounded positive examples",()=>{
 const stored=parseTestBenchCreate({...draft,requestId});
 assert.equal(stored.name,"My QA suite");
 assert.equal(stored.cases[0]?.prompt,one.prompt);
 assert.equal(stored.requestId,requestId);
 assert.deepEqual(parseTestBenchDraft({...draft,name:" My QA suite "}),draft);
 assert.deepEqual(parseTestBenchMutation({...draft,expectedRevision:2}),
   {...draft,expectedRevision:2});
 assert.deepEqual(parseTestBenchArchive({expectedRevision:1}),{expectedRevision:1});
 assert.deepEqual(parseTestBenchCases([{...one,context:"Context\nline 2"}]),
   [{...one,context:"Context\nline 2"}]);
});
test("PER-1422: fail closed on malformed cases, unsafe keys and duplicate IDs",()=>{
 const malformed:unknown[]=[
  null,[],Array(9).fill(one),
  [{...one,caseId:"a".repeat(65)}],
  [{...one,caseId:"../etc"}],
  [one,{...one,caseId:"LOGIN-1"}],
  [{...one,kind:"exfiltrate"}],
  [{...one,prompt:""}],
  [{...one,prompt:"a".repeat(2001)}],
  [{...one,expectedBehavior:""}],
  [{...one,context:"b".repeat(1501)}],
  [{...one,prompt:"ok\u0000bad"}],
  [{...one,providerApiKey:"secret"}],
  [JSON.parse('{"caseId":"a","kind":"positive","prompt":"x","expectedBehavior":"y","__proto__":{"isAdmin":true}}')],
 ];
 for(const value of malformed)
  assert.throws(()=>parseTestBenchCases(value),TestBenchError);
 assert.throws(()=>parseTestBenchDraft({...draft,hiddenSecret:"no"}),TestBenchError);
 assert.throws(()=>parseTestBenchDraft({...draft,name:"\u0007"}),TestBenchError);
 assert.throws(()=>parseTestBenchCases(Array.from({length:8},(_,i)=>({
  ...one,caseId:"case-"+i,prompt:"p".repeat(2000),
  expectedBehavior:"e".repeat(1000),context:"c".repeat(1500),
 }))),assertCode("test_bench_case_bytes_exceeded"));
});
test("PER-1422: request IDs and revision CAS preconditions strictly validated",()=>{
 for(const value of ["bad","",123,null,"00000000-0000-0000-0000-000000000000"])
  assert.throws(()=>parseTestBenchCreate({...draft,requestId:value}),TestBenchError);
 for(const expectedRevision of [0,-1,1.5,"1",null,undefined,2_147_483_647])
  assert.throws(()=>parseTestBenchMutation({...draft,expectedRevision}),
   assertCode("test_bench_revision_required"));
 assert.throws(()=>parseTestBenchArchive({expectedRevision:0}),
  assertCode("test_bench_revision_required"));
 assert.throws(()=>parseTestBenchArchive({expectedRevision:1,cases:[one]}),TestBenchError);
});
