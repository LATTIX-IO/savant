import assert from "node:assert/strict";
import test from "node:test";
import {
  AiServiceError,createJevClient,createNimChatClient,
  type ChatMessage,type FetchLike,
} from "../ai/clients.ts";
import {executeObservedCases,ObservedEvaluationError} from "./observed-evaluator.ts";
import {createSingleAttemptObservedJudge} from "./observed-run-worker.ts";
import type {TestBenchCase} from "./definition-contract.ts";

const nimConfig={
  apiKey:"sk-NEVER_LOGGED_NIM",baseUrl:"https://nim.example.test/v1",
  generationModel:"nim-test",executionModel:"nim-test",extraBody:{},
};
const jevConfig={
  apiKey:"sk-NEVER_LOGGED_JEV",baseUrl:"https://jev.example.test/v1",
  model:"jev-test",
};
const messages:ChatMessage[]=[
  {role:"system",content:"Give a concise answer."},
  {role:"user",content:"What is two plus two?"},
];
const cases:TestBenchCase[]=[{caseId:"one",kind:"positive",prompt:"2+2?",
  context:null,expectedBehavior:"4"}];
const nimResponse=(choices:unknown=[{
  finish_reason:"stop",message:{content:"4"},
}])=>({
  model:"nim-test",choices,usage:{prompt_tokens:80,completion_tokens:20},
});
const jevResponse=(answers:unknown={})=>({
  model:"jev-test",answers,usage:{input_tokens:60,output_tokens:10},
});
const json=(v:unknown)=>new Response(JSON.stringify(v),{
  status:200,headers:{"content-type":"application/json"},
});

test("PER-1453: hosted paid NIM and Jev HTTP 408/429/503, network and invalid JSON are single attempt",async()=>{
  for(const service of ["nim","jev"] as const){
    for(const status of [408,429,503]){
      let count=0;
      const fake:FetchLike=async(_url,init)=>{
        count++;
        assert.equal(init?.method,"POST");
        assert.equal(init?.redirect,"error");
        assert.equal(init?.credentials,"omit");
        assert.equal(init?.cache,"no-store");
        return new Response("PRIVATE_PROVIDER_FAILURE",{status});
      };
      const client=service==="nim"
        ?createNimChatClient(nimConfig,"nim-test",fake,{singleAttempt:true})
        :createJevClient(jevConfig,fake,{singleAttempt:true});
      await assert.rejects(async()=>{
        if(service==="nim")
          await (client as ReturnType<typeof createNimChatClient>).complete(messages);
        else
          await (client as ReturnType<typeof createJevClient>).ask({},{});
      },e=>{
        assert.ok(e instanceof AiServiceError);
        assert.doesNotMatch(String(e),/sk-NEVER_LOGGED/);
        return true;
      });
      assert.equal(count,1,service+" "+status+" must not retry");
    }
    for(const kind of ["network","bad-json"]){
      let count=0;
      const fake:FetchLike=async()=>{
        count++;
        if(kind==="network")throw Error("PRIVATE_NETWORK_SECRET");
        return new Response("{not-valid-json",{status:200});
      };
      const client=service==="nim"
        ?createNimChatClient(nimConfig,"nim-test",fake,{singleAttempt:true})
        :createJevClient(jevConfig,fake,{singleAttempt:true});
      await assert.rejects(async()=>{
        if(service==="nim")
          await (client as ReturnType<typeof createNimChatClient>).complete(messages);
        else
          await (client as ReturnType<typeof createJevClient>).ask({},{});
      },AiServiceError);
      assert.equal(count,1,service+" "+kind+" must not retry");
    }
  }
});

test("PER-1453: default adapters stay strict; evidence mode returns only genuine bad-output usage",async()=>{
  const n=createNimChatClient(nimConfig,"nim-test",
    async()=>json(nimResponse([{finish_reason:"length",message:{content:""}}])),
    {singleAttempt:true});
  await assert.rejects(()=>n.complete(messages),AiServiceError);
  const reply=await n.complete(messages,{usageEvidenceMode:true});
  assert.equal(reply.content,"");
  assert.equal(reply.finishReason,"length");
  assert.deepEqual(reply.usage,{promptTokens:80,completionTokens:20});

  const j=createJevClient(jevConfig,async()=>json(jevResponse()),{singleAttempt:true});
  const questions={quality:{type:"score" as const,instructions:"Score",criteria:[]}};
  await assert.rejects(()=>j.ask({},questions),AiServiceError);
  const partial=await j.ask({},questions,{usageEvidenceMode:true});
  assert.deepEqual(partial.answers,{});
  assert.deepEqual(partial.usage,{inputTokens:60,outputTokens:10});
});

test("PER-1453: real NIM adapter retains usage for empty or truncated completion; never calls Jev",async()=>{
  for(const [reason,content] of [["stop",""],["length","partial"]] as const){
    let executorCalls=0,judgeCalls=0;
    const seen:string[]=[];
    const nim=createNimChatClient(nimConfig,"nim-test",async()=>{
      executorCalls++;
      return json(nimResponse([{finish_reason:reason,message:{content}}]));
    },{singleAttempt:true});
    const jev=createJevClient(jevConfig,async()=>{
      judgeCalls++;
      throw Error("Jev must not be contacted");
    },{singleAttempt:true});
    await assert.rejects(()=>executeObservedCases({
      skillName:"example",instructions:"Answer faithfully.",cases,
      clients:{executor:nim,judge:jev},
      onUsage:async receipt=>{seen.push(receipt.phase+":"+String(receipt.promptTokens+receipt.completionTokens));},
    }),e=>e instanceof ObservedEvaluationError&&e.code==="test_bench_model_output_invalid");
    assert.equal(executorCalls,1);assert.equal(judgeCalls,0);
    assert.deepEqual(seen,["executor:100"]);
  }
});

test("PER-1453: real Jev adapter returns malformed judge answers for usage ACK, then refuses score",async()=>{
  let nimCalls=0,jevCalls=0;
  const seen:string[]=[];
  const nim=createNimChatClient(nimConfig,"nim-test",async()=>{
    nimCalls++;return json(nimResponse());
  },{singleAttempt:true});
  const judge=createJevClient(jevConfig,async()=>{
    jevCalls++;return json(jevResponse({}));
  },{singleAttempt:true});
  await assert.rejects(()=>executeObservedCases({
    skillName:"example",instructions:"Answer faithfully.",cases,
    clients:{executor:nim,judge},onUsage:async r=>{seen.push(r.phase);},
  }),e=>e instanceof ObservedEvaluationError&&e.code==="test_bench_judge_binary_invalid");
  assert.equal(nimCalls,1);assert.equal(jevCalls,1);
  assert.deepEqual(seen,["executor","judge"]);
});

test("PER-1453: invalid or absent provider usage is never converted to a receipt",async()=>{
  let judgeCalls=0,receipts=0;
  const nim=createNimChatClient(nimConfig,"nim-test",async()=>
    json({...nimResponse(),usage:{prompt_tokens:0,completion_tokens:0}}),
  {singleAttempt:true});
  const judge=createJevClient(jevConfig,async()=>{
    judgeCalls++;return json(jevResponse());
  },{singleAttempt:true});
  await assert.rejects(()=>executeObservedCases({
    skillName:"example",instructions:"Answer.",cases,clients:{executor:nim,judge},
    onUsage:async()=>{receipts++;},
  }),e=>e instanceof ObservedEvaluationError&&e.code==="test_bench_provider_usage_missing");
  assert.equal(receipts,0);assert.equal(judgeCalls,0);
});


test("PER-1453: malformed and oversized NIM text is dropped but positive usage is retained",async()=>{
 for(const raw of [101,{"message":"do not trust"}, "x".repeat(3_201)]){
  const c=createNimChatClient(nimConfig,"nim-test",async()=>
    json(nimResponse([{finish_reason:"stop",message:{content:raw}}])),
  {singleAttempt:true});
  const out=await c.complete(messages,{usageEvidenceMode:true});
  assert.equal(out.content,"");
  assert.deepEqual(out.usage,{promptTokens:80,completionTokens:20});
 }
});

test("PER-1453 regression: production Test Bench judge factory never repeats a paid request",async()=>{
 let calls=0;
 const judge=createSingleAttemptObservedJudge(jevConfig,async(_url,options)=>{
  calls++;
  assert.equal(options?.redirect,"error");
  return new Response("PROVIDER_503_PAYLOAD",{status:503});
 });
 await assert.rejects(()=>judge.ask({skill:"test"},{quality:{
  type:"score",instructions:"Assess",criteria:[],
 }}),AiServiceError);
 assert.equal(calls,1,"platform NIM and BYO OpenAI must share the single-attempt judge factory");
});
