import {createHash} from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {createRoleBoundAnthropicEvaluationClient,
  type AnthropicEvaluationAuthority} from "./anthropic-role-bound.ts";
import {ProviderRoleAdmissionError} from "../control-plane/provider-role-admission.ts";

const organizationId="11111111-1111-4111-8111-111111111111";
const connectionId="22222222-2222-4222-8222-222222222222";
const model="claude-haiku-5-5";
const secret="sk-ant-TEST_ONLY_KEY_12345";
const fp=createHash("sha256").update(secret,"utf8").digest("hex");
const authority:AnthropicEvaluationAuthority={
  actor:{organizationId,subject:"auth0|member",status:"active",
    permittedRoles:["evaluation-executor"]},
  connection:{id:connectionId,organizationId,provider:"anthropic",status:"active",
    credentialMode:"api-key",secretFingerprint:fp,keyVersion:2,allowedModels:[model]},
  grant:{id:"role-grant",organizationId,connectionId,provider:"anthropic",
    role:"evaluation-executor",model,credentialMode:"api-key",status:"active",
    secretFingerprint:fp,keyVersion:2,verifiedAt:"2026-10-22T19:00:00Z",
    expiresAt:"2099-10-23T20:00:00Z",billingOwner:"qa",pricingRevision:"pricing-v1",
    maxTokensPerCall:10_000,maxEstimatedUsdPerCall:0.20},
  intent:{organizationId,connectionId,provider:"anthropic",role:"evaluation-executor",
    model,secretFingerprint:fp,keyVersion:2,pricingRevision:"pricing-v1",
    estimatedTokens:900,estimatedUsd:0.05},
};
const messages=[{role:"system" as const,content:"System"},
  {role:"user" as const,content:"User"}];
const response=()=>new Response(JSON.stringify({type:"message",role:"assistant",model,
  stop_reason:"end_turn",content:[{type:"text",text:"done"}],
  usage:{input_tokens:12,output_tokens:4}}),{status:200});

test("PER-1602 Anthropic evaluation adapter rechecks authority before each billable call",async()=>{
  let reads=0,calls=0,revoked=false;
  const client=createRoleBoundAnthropicEvaluationClient({model,apiKey:secret,
    loadAuthority:async()=>{reads++;return revoked?{
      ...authority,grant:{...authority.grant!,status:"revoked"}}:authority;},
    fetchImpl:async()=>{calls++;return response();}});
  const result=await client.complete(messages);
  assert.equal(result.content,"done");
  assert.equal(reads,1);assert.equal(calls,1);
  revoked=true;
  await assert.rejects(()=>client.complete(messages),ProviderRoleAdmissionError);
  assert.equal(reads,2);assert.equal(calls,1,"revoked credential cannot make another provider request");
});
test("PER-1602 deny a judge, production grant, cross-tenant actor or model substitution",async()=>{
  const cases:AnthropicEvaluationAuthority[]=[
    {...authority,actor:{...authority.actor!,permittedRoles:["evaluation-judge"]},
      grant:{...authority.grant!,role:"evaluation-judge"},
      intent:{...authority.intent,role:"evaluation-judge"}},
    {...authority,actor:{...authority.actor!,permittedRoles:["production-serving"]},
      grant:{...authority.grant!,role:"production-serving"},
      intent:{...authority.intent,role:"production-serving"}},
    {...authority,actor:{...authority.actor!,organizationId:"foreign"}},
    {...authority,intent:{...authority.intent,model:"unapproved"}},
    {...authority,connection:{...authority.connection!,keyVersion:3}},
  ];
  for(const state of cases){
    let calls=0;
    const client=createRoleBoundAnthropicEvaluationClient({model,apiKey:secret,
      loadAuthority:async()=>state,fetchImpl:async()=>{calls++;return response();}});
    await assert.rejects(()=>client.complete(messages),ProviderRoleAdmissionError);
    assert.equal(calls,0);
  }
});
test("PER-1602 authority store failure denies and never triggers transport",async()=>{
  let calls=0;
  const client=createRoleBoundAnthropicEvaluationClient({model,apiKey:secret,
    loadAuthority:async()=>{throw new Error("authoritative DB unavailable");},
    fetchImpl:async()=>{calls++;return response();}});
  await assert.rejects(()=>client.complete(messages),error=>
    error instanceof ProviderRoleAdmissionError&&
    error.code==="provider_grant_authority_unavailable"&&
    !String(error).includes("authoritative DB unavailable"));
  assert.equal(calls,0);
});

test("PER-1602 different decrypted key cannot spend a valid role grant",async()=>{
  let calls=0;
  const client=createRoleBoundAnthropicEvaluationClient({model,apiKey:"sk-ant-SWAPPED_TEST_KEY_12345",
    loadAuthority:async()=>authority,fetchImpl:async()=>{calls++;return response();}});
  await assert.rejects(()=>client.complete(messages),error=>
    error instanceof ProviderRoleAdmissionError&&
    error.code==="provider_grant_credential_changed");
  assert.equal(calls,0);
});
