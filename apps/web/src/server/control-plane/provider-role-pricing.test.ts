import assert from "node:assert/strict";
import test from "node:test";
import {microUsdAsAdmissionNumber, ProviderRolePricingError,
  quoteProviderCallMicroUsd, type ApprovedRoleRate} from "./provider-role-pricing.ts";

const time=Date.parse("2026-10-22T20:00:00Z");
const rate:ApprovedRoleRate={
  provider:"anthropic",model:"claude-test-v1",revision:"reviewed-2026-10-22",
  status:"approved",sourceSha256:"a".repeat(64),
  approvedAt:"2026-10-21T00:00:00Z",validFrom:"2026-10-21T00:00:00Z",
  validUntil:"2026-11-21T00:00:00Z",
  inputMicroUsdPerMillion:"1000000",
  cacheWriteMicroUsdPerMillion:"1250000",
  cacheReadMicroUsdPerMillion:"100000",
  outputMicroUsdPerMillion:"5000000",fixedMicroUsdPerCall:"100",
};
const quote=(overrides:Partial<Parameters<typeof quoteProviderCallMicroUsd>[0]>={})=>
  quoteProviderCallMicroUsd({rate,provider:rate.provider,model:rate.model,
    revision:rate.revision,maxInputTokens:1000,maxOutputTokens:400,nowMs:time,...overrides});
const denied=(code:string)=>(error:unknown)=>error instanceof ProviderRolePricingError&&error.code===code;

test("PER-1602 conservative price uses highest input cache tier, ceiling and fixed charge",()=>{
  assert.equal(quote(),3350n); // ceil(1250 + 2000) + 100
  assert.equal(microUsdAsAdmissionNumber(quote()),0.00335);
  assert.equal(quote({maxInputTokens:1,maxOutputTokens:1}),107n); // ceil(6.25) + 100
});
test("PER-1602 no unapproved/expired/foreign/unknown rate can authorize egress",()=>{
  for(const candidate of [
    {...rate,status:"draft" as const}, {...rate,status:"revoked" as const},
    {...rate,approvedAt:null},{...rate,approvedAt:"2026-10-23T00:00:00Z"},
    {...rate,validUntil:"2026-10-22T20:00:00Z"},
    {...rate,sourceSha256:"not-approved"},
  ]) assert.throws(()=>quote({rate:candidate}),denied("provider_role_price_unverified"));
  for(const change of [{provider:"openai"},{model:"wrong"},{revision:"unknown"}])
    assert.throws(()=>quote(change),denied("provider_role_price_unverified"));
});
test("PER-1602 malformed amounts, zero-priced contracts and overflow deny",()=>{
  for(const value of ["-1","1.0","1e6","", "10000000000000"])
    assert.throws(()=>quote({rate:{...rate,outputMicroUsdPerMillion:value}}),
      denied("provider_role_price_invalid"));
  assert.throws(()=>quote({rate:{...rate,inputMicroUsdPerMillion:"0",
    cacheWriteMicroUsdPerMillion:"0",cacheReadMicroUsdPerMillion:"0",
    outputMicroUsdPerMillion:"0",fixedMicroUsdPerCall:"0"}}),denied("provider_role_price_invalid"));
});
test("PER-1602 invalid model token allocation denies before any database or network",()=>{
  for(const i of [0,-1,1.5,Number.NaN,900000])
    assert.throws(()=>quote({maxInputTokens:i,maxOutputTokens:400000}),denied("provider_role_price_tokens_invalid"));
  assert.throws(()=>microUsdAsAdmissionNumber(0n),denied("provider_role_price_invalid"));
});
