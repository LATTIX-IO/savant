import assert from "node:assert/strict";
import test from "node:test";
import {TestBenchError} from "./definition-contract.ts";
import {
 providerForIntent,validateObservedProviderIntent,
} from "./provider-call-intents.ts";

test("PER-1457: provider for a call intent is server-derived from pinned source and phase",()=>{
 assert.equal(providerForIntent("executor","platform-nim"),"nim");
 assert.equal(providerForIntent("executor","workspace-openai"),"openai");
 assert.equal(providerForIntent("judge","platform-nim"),"jev");
 assert.equal(providerForIntent("judge","workspace-openai"),"jev");
 for(const source of ["user-endpoint","arbitrary-host",""]){
  assert.throws(()=>providerForIntent("executor",source as "platform-nim"),
    e=>e instanceof TestBenchError&&e.code==="test_bench_provider_intent_invalid");
 }
 assert.throws(()=>providerForIntent("tools" as "judge","platform-nim"),
  e=>e instanceof TestBenchError&&e.code==="test_bench_provider_intent_invalid");
});
test("PER-1457: no forged phase, index, extra case or tool dispatch intent",()=>{
 assert.doesNotThrow(()=>validateObservedProviderIntent({index:1,phase:"executor"}));
 assert.doesNotThrow(()=>validateObservedProviderIntent({index:4,phase:"judge"}));
 for(const bad of [
  {index:0,phase:"executor"},{index:5,phase:"judge"},
  {index:NaN,phase:"executor"},{index:1.5,phase:"judge"},
  {index:1,phase:"network"},{index:1,phase:"mcp"},
  {index:1,phase:"tool"},{index:-2,phase:"executor"},
  null,
 ]){
  assert.throws(()=>validateObservedProviderIntent(
    bad as {index:number;phase:"executor"|"judge"}),
   e=>e instanceof TestBenchError&&e.code==="test_bench_provider_intent_invalid");
 }
});
