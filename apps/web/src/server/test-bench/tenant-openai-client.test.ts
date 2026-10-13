import assert from "node:assert/strict";
import test from "node:test";
import {
  TENANT_OPENAI_CHAT_ENDPOINT,assertValidTenantOpenAiConnection,
  assertPinnedTenantOpenAiConnection,createTenantOpenAiChatClient,
} from "./tenant-openai-client.ts";
import {ObservedEvaluationError} from "./observed-evaluator.ts";

const org="11111111-1111-4111-8111-111111111111";
const connId="22222222-2222-4222-8222-222222222222";
const model="gpt-4o-mini-2024-07-18",secret="sk-PRIVATE_TEST_API_KEY_456789";
const fp="a".repeat(64);
const candidate={
  id:connId,organization_id:org,provider_type:"openai",
  default_model:model,supports_execution:true,is_default_execution:true,
  status:"active",allowed_models:[model],secret_fingerprint:fp,
};
const pinned={
  organization_id:org,execution_source:"workspace-openai" as const,
  execution_connection_id:connId,execution_model_pinned:model,
  execution_secret_fingerprint:fp,
};
const messages=[
 {role:"system" as const,content:"Do not use tools."},
 {role:"user" as const,content:"What is 2+2?"},
];
const response=(overrides:Record<string,unknown>={})=>({
 model,choices:[{message:{content:"4"},finish_reason:"stop"}],
 usage:{prompt_tokens:42,completion_tokens:7},...overrides,
});
const expectFailure=(code:string)=>(error:unknown):boolean=>
 error instanceof ObservedEvaluationError&&error.code===code;
test("PER-1438: only default enabled own-tenant OpenAI connection and allowed model are admissible",()=>{
 assert.deepEqual(assertValidTenantOpenAiConnection(candidate,org),{
  organizationId:org,connectionId:connId,model,fingerprint:fp,
 });
 assert.doesNotThrow(()=>assertPinnedTenantOpenAiConnection(pinned,candidate));
 for(const other of [
  {...candidate,organization_id:"foreign"},
  {...candidate,id:"other-connection"},
  {...candidate,status:"revoked"},
  {...candidate,provider_type:"openai-compatible"},
  {...candidate,provider_type:"anthropic"},
  {...candidate,is_default_execution:false},
  {...candidate,supports_execution:false},
  {...candidate,default_model:"unapproved"},
  {...candidate,allowed_models:["unapproved"]},
  {...candidate,secret_fingerprint:"not-hex"},
  {...candidate,default_model:""},
 ])
  assert.throws(()=>assertValidTenantOpenAiConnection(other,org),
   expectFailure("test_bench_workspace_openai_unavailable"));
 for(const other of [
  {...candidate,secret_fingerprint:"b".repeat(64)},
  {...candidate,default_model:"gpt-changed",allowed_models:[]},
  {...candidate,id:"44444444-4444-4444-8444-444444444444"},
 ])
  assert.throws(()=>assertPinnedTenantOpenAiConnection(pinned,other),ObservedEvaluationError);
});
test("PER-1438: fixed OpenAI origin, one billable call, no redirects, no tools and strict usage",async()=>{
 let count=0;
 const client=createTenantOpenAiChatClient({
  model,apiKey:secret,
  fetchImpl:async(url,init)=>{
   count++;
   assert.equal(url,TENANT_OPENAI_CHAT_ENDPOINT);
   assert.equal(new URL(String(url)).origin,"https://api.openai.com");
   assert.equal(init?.redirect,"error");assert.equal(init?.credentials,"omit");
   assert.equal(init?.method,"POST");assert.equal(init?.cache,"no-store");
   assert.equal((init?.headers as Record<string,string>).authorization,"Bearer "+secret);
   const body=JSON.parse(String(init?.body));
   assert.deepEqual(Object.keys(body).sort(),[
    "max_tokens","messages","model","stream","temperature",
   ]);
   assert.equal(body.max_tokens,400);
   assert.equal(body.model,model);
   assert.deepEqual(body.messages,messages);
   assert.equal(body.stream,false);
   assert.ok(init?.signal,"request is time bounded");
   return new Response(JSON.stringify(response()),{
    status:200,headers:{"content-type":"application/json"},
   });
  },
 });
 const got=await client.complete(messages,{maxTokens:400,temperature:0.2,timeoutMs:15000});
 assert.equal(count,1);assert.equal(got.content,"4");assert.equal(got.model,model);
 assert.equal(got.usage.promptTokens,42);assert.equal(got.usage.completionTokens,7);
 assert.ok(got.latencyMs>=0);
});
test("PER-1438: HTTP 429/500 do not silently retry a paid request or reveal provider response",async()=>{
 for(const status of [401,403,429,500,503]){
  let count=0;
  const client=createTenantOpenAiChatClient({model,apiKey:secret,fetchImpl:async()=>{
   count++;
   return new Response("PRIVATE_SECRET_MIGHT_BE_ECHOED",{status});
  }});
  await assert.rejects(()=>client.complete(messages),
   error=>{
    assert.ok(expectFailure("test_bench_workspace_openai_http_failure")(error));
    assert.doesNotMatch(String(error),/PRIVATE_SECRET|sk-PRIVATE/);
    return true;
   });
  assert.equal(count,1,`no automatic retry for HTTP ${status}`);
 }
});
test("PER-1438: reject forged model/usage, truncated or excessively large JSON outputs",async()=>{
 const bad=[
  response({model:"different-model"}),
  response({usage:null}),
  response({usage:{prompt_tokens:-1,completion_tokens:3}}),
  response({usage:{prompt_tokens:0,completion_tokens:0}}),
  response({choices:[{message:{content:""}}]}),
  response({choices:[{message:{content:"partial but nonempty"},finish_reason:"length"}]}),
  response({choices:[{message:{content:"filtered"},finish_reason:"content_filter"}]}),
  response({choices:[{message:{content:"tools hidden"},finish_reason:"tool_calls"}]}),
  response({choices:[{message:{content:"x".repeat(3001)}}]}),
  response({choices:[{message:{tool_calls:[{function:{name:"secret"}}]}}]}),
 ];
 for(const data of bad){
  const client=createTenantOpenAiChatClient({model,apiKey:secret,
   fetchImpl:async()=>new Response(JSON.stringify(data),{status:200})});
  await assert.rejects(()=>client.complete(messages),
   expectFailure("test_bench_workspace_openai_response_invalid"));
 }
 for(const text of ["{invalid-json",JSON.stringify(response())+"x".repeat(40_000)]){
  const client=createTenantOpenAiChatClient({model,apiKey:secret,
   fetchImpl:async()=>new Response(text,{status:200})});
  await assert.rejects(()=>client.complete(messages),
   error=>error instanceof ObservedEvaluationError&&
    ["test_bench_workspace_openai_response_invalid",
     "test_bench_workspace_openai_request_failed"].includes(error.code));
 }
});
test("PER-1438: unapproved additional tool, endpoint or oversized request never reaches fetch",async()=>{
 let count=0;
 const client=createTenantOpenAiChatClient({model,apiKey:secret,
  fetchImpl:async()=>{count++;throw Error("No call expected");}});
 for(const options of [
  {maxTokens:900},{timeoutMs:16_000},{maxTokens:0},
  {extraBody:{tools:[{type:"function"}]}},
 ]){
  await assert.rejects(()=>client.complete(messages,options),
    expectFailure("test_bench_workspace_openai_request_invalid"));
 }
 await assert.rejects(()=>client.complete([{role:"user",content:"inject"}]),
  expectFailure("test_bench_workspace_openai_request_invalid"));
 assert.equal(count,0);
});
