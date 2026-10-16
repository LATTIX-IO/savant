import assert from "node:assert/strict";
import test from "node:test";
import {TestBenchError} from "./definition-contract.ts";
import {
  monetaryAdmissionRequired,plannedMicroUsd,expectedMonetaryModels,
  PLANNED_INPUT_TOKENS_PER_CALL,PLANNED_OUTPUT_TOKENS_PER_CALL,
} from "./monetary-admission.ts";

const rate={provider_code:"nim" as const,model:"nim-price-test",
 input_micro_usd_per_million:"150000",
 output_micro_usd_per_million:"600000",
 fixed_micro_usd_per_call:"25",
};
const invalid=(code:string)=>(e:unknown)=>e instanceof TestBenchError&&e.code===code;
test("PER-1545: money math uses per-call upward integer rounding, no float leak",()=>{
 assert.equal(PLANNED_INPUT_TOKENS_PER_CALL,32768);
 assert.equal(PLANNED_OUTPUT_TOKENS_PER_CALL,8192);
 // ceil((32768*150000+8192*600000)/1000000)+25=9856 micro-USD.
 assert.equal(plannedMicroUsd(rate,1),9856);
 assert.equal(plannedMicroUsd(rate,2),19712);
 assert.equal(plannedMicroUsd(rate,4),39424);
 assert.equal(plannedMicroUsd({...rate,input_micro_usd_per_million:1,
   output_micro_usd_per_million:0,fixed_micro_usd_per_call:0},1),1);
});
test("PER-1545: reject bad, negative, zero, unbounded or fractional pricing",()=>{
 for(const altered of [
  {...rate,input_micro_usd_per_million:-1},
  {...rate,input_micro_usd_per_million:"1.5"},
  {...rate,output_micro_usd_per_million:Infinity},
  {...rate,fixed_micro_usd_per_call:"1e6"},
  {...rate,model:""},
  {...rate,provider_code:"user-supplied"},
  {...rate,input_micro_usd_per_million:0,
    output_micro_usd_per_million:0,fixed_micro_usd_per_call:0},
  {...rate,fixed_micro_usd_per_call:1000000000001},
 ]){
  assert.throws(()=>plannedMicroUsd(altered as typeof rate,1),
    invalid("test_bench_rate_invalid"));
 }
 for(const cases of [0,-1,1.2,5,Infinity])
  assert.throws(()=>plannedMicroUsd(rate,cases),invalid("test_bench_rate_invalid"));
});
test("PER-1545: BYO OpenAI is never treated as Savant-billed; Jev remains reserved",()=>{
 const env={
  NVIDIA_NIM_API_KEY:"test-nim-only",
  JEV_API_KEY:"test-jev-only",
  NIM_EXECUTION_MODEL:"nim-price-test",JEV_MODEL:"jev-price-test",
 };
 assert.deepEqual(expectedMonetaryModels("platform-nim",env),[
  {provider_code:"jev",model:"jev-price-test"},
  {provider_code:"nim",model:"nim-price-test"},
 ]);
 assert.deepEqual(expectedMonetaryModels("workspace-openai",env),[
  {provider_code:"jev",model:"jev-price-test"},
 ]);
 assert.throws(()=>expectedMonetaryModels("workspace-openai",{
  NVIDIA_NIM_API_KEY:"test-nim-only"}),invalid("test_bench_rate_provider_unavailable"));
 assert.throws(()=>expectedMonetaryModels("platform-nim",{
  JEV_API_KEY:"test-jev-only"}),invalid("test_bench_rate_provider_unavailable"));
 assert.throws(()=>expectedMonetaryModels("remote-origin" as "platform-nim",env),
   invalid("test_bench_rate_provider_unavailable"));
});
test("PER-1545: production cannot disable monetary gate through feature flag",()=>{
 assert.equal(monetaryAdmissionRequired({VERCEL_ENV:"production"}),true);
 assert.equal(monetaryAdmissionRequired({
  VERCEL_ENV:"production",SAVANT_TEST_BENCH_MONETARY_ENFORCE:"0",
 }),true);
 assert.equal(monetaryAdmissionRequired({SAVANT_TEST_BENCH_MONETARY_ENFORCE:"1"}),true);
 assert.equal(monetaryAdmissionRequired({VERCEL_ENV:"preview"}),false);
});
