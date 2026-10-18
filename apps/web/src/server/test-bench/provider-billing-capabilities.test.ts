import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {TestBenchError} from "./definition-contract.ts";
import {
  BILLING_API_EVIDENCE,inspectPublishedApiContract,
  denyUnsupportedProviderSettlement,
} from "./provider-billing-capabilities.ts";

const denied=(code:string)=>(e:unknown)=>
  e instanceof TestBenchError&&e.code===code;
const openApi={
  openapi:"3.1.0",
  paths:{
    "/v1/models":{get:{responses:{200:{description:"model catalogue"}}}},
    "/v1/systemone":{post:{responses:{200:{description:"typed answer"}}}},
  },
};
const raw=Buffer.from(JSON.stringify(openApi),"utf8");

test("PER-1549: the exact first-party NIM/Jev endpoints are pinned but NOT billing sources",()=>{
  assert.equal(BILLING_API_EVIDENCE.nim.inferenceOrigin,"https://integrate.api.nvidia.com");
  assert.equal(BILLING_API_EVIDENCE.nim.inferencePath,"/v1/chat/completions");
  assert.equal(BILLING_API_EVIDENCE.jev.inferenceOrigin,"https://api.typesafe.ai");
  assert.equal(BILLING_API_EVIDENCE.jev.inferencePath,"/v1/systemone");
  for(const provider of ["nim","jev"] as const){
    assert.equal(BILLING_API_EVIDENCE[provider].billingExport,"not_verified");
    assert.equal(BILLING_API_EVIDENCE[provider].invoiceRequestIdJoin,"not_verified");
    assert.equal(BILLING_API_EVIDENCE[provider].financialConfirmationAllowed,false);
    assert.throws(()=>denyUnsupportedProviderSettlement(provider),
      denied("test_bench_provider_invoice_authentication_unavailable"));
  }
});
test("PER-1549: inspect official TypeSafe OpenAPI without promoting vendor billing status",()=>{
  const report=inspectPublishedApiContract({
    provider:"jev",sourceUrl:"https://api.typesafe.ai/openapi.json",rawBytes:raw,
  });
  assert.equal(report.sourceSha256,createHash("sha256").update(raw).digest("hex"));
  assert.deepEqual(report.documentedPaths,["/v1/models","/v1/systemone"]);
  assert.equal(report.billingEndpointAttested,false);
  assert.equal(report.requestIdJoinAttested,false);
  assert.equal(report.actualChargeMicroUsd,null);
});
test("PER-1549: an injected billing path or request-id field is NEVER financial attestation",()=>{
  const altered=Buffer.from(JSON.stringify({
    ...openApi,paths:{...openApi.paths,
      "/v1/billing/export":{get:{responses:{200:{description:"fake"}}}},
    },claim:{verified:true,invoiceRequestId:"user-supplied-id",bill:"1500"},
  }));
  const proof=inspectPublishedApiContract({
    provider:"jev",sourceUrl:"https://api.typesafe.ai/openapi.json",rawBytes:altered,
  });
  assert.ok(proof.documentedPaths.includes("/v1/billing/export"));
  assert.equal(proof.billingEndpointAttested,false);
  assert.equal(proof.requestIdJoinAttested,false);
  assert.equal(proof.actualChargeMicroUsd,null);
});
test("PER-1549: unsupported providers, mirrors and redirects do not establish provenance",()=>{
  assert.throws(()=>inspectPublishedApiContract({
    provider:"nim",sourceUrl:BILLING_API_EVIDENCE.nim.publicReference,rawBytes:raw,
  }),denied("test_bench_nim_export_contract_undocumented"));
  for(const origin of [
    "https://jev-api.org/v1/systemone",
    "https://api.typesafe.ai.evil.example/openapi.json",
    "http://api.typesafe.ai/openapi.json",
    "https://api.typesafe.ai/openapi.json?source=fake",
    "https://docs.typesafe.ai/api",
  ]){
    assert.throws(()=>inspectPublishedApiContract({
      provider:"jev",sourceUrl:origin,rawBytes:raw,
    }),denied("test_bench_billing_documentation_invalid"));
  }
  assert.throws(()=>denyUnsupportedProviderSettlement("openai" as "jev"),
    denied("test_bench_billing_provider_invalid"));
});
test("PER-1549: reject malformed, enormous, or invalid UTF-8 documentation bodies",()=>{
  for(const bytes of [new Uint8Array(),new Uint8Array(262145),Buffer.from([0xc3,0x28]),
    Buffer.from("[1,2]"),Buffer.from('{"paths":{"x":{}}}'),
    Buffer.from('{"paths":true}')]){
    assert.throws(()=>inspectPublishedApiContract({
      provider:"jev",sourceUrl:BILLING_API_EVIDENCE.jev.publicReference,rawBytes:bytes,
    }),denied("test_bench_billing_documentation_invalid"));
  }
});
