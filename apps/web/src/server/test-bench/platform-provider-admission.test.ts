import assert from "node:assert/strict";
import test from "node:test";
import {PLATFORM_PROVIDER_DAILY_LIMITS,PLATFORM_PROVIDER_RESERVATION_UNITS,
  providersForObservedSource} from "./platform-provider-admission.ts";
import {TestBenchError} from "./definition-contract.ts";

test("PER-1452: platform NIM admission reserves both NIM and shared Jev",()=>{
  assert.deepEqual(providersForObservedSource("platform-nim"),["jev","nim"]);
  assert.deepEqual(providersForObservedSource("workspace-openai"),["jev"]);
  assert.equal(PLATFORM_PROVIDER_DAILY_LIMITS.jev,200);
  assert.equal(PLATFORM_PROVIDER_DAILY_LIMITS.nim,100);
  assert.equal(PLATFORM_PROVIDER_RESERVATION_UNITS,12000);
});
test("PER-1452: unknown execution source cannot bypass shared capacity",()=>{
  assert.throws(()=>providersForObservedSource("untrusted-source" as "platform-nim"),
    (e:unknown)=>e instanceof TestBenchError&&e.code==="test_bench_execution_source_invalid");
});
