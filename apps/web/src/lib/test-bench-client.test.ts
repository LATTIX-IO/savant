import assert from "node:assert/strict";
import test from "node:test";
import {
  listPersistedTestBenches,createPersistedTestBench,updatePersistedTestBench,
  archivePersistedTestBench,TestBenchClientError,
} from "./test-bench-client.ts";
import type {TestBenchCase} from "../server/test-bench/definition-contract.ts";
const skillId="team/core+agent",workspaceSlug="workspace-qa";
const uuid="97ee557d-3dc0-4ee1-af29-72fedc58e4d7";
const case1:TestBenchCase={caseId:"case-1",kind:"positive",prompt:"Give concise directions",
 context:null,expectedBehavior:"Provide safe steps"};
const example={id:uuid,skillId,sourceCommitSha:"a".repeat(40),revision:1,name:"Smoke suite",
 cases:[case1],createdAt:"2026-10-12T12:00:00Z",updatedAt:"2026-10-12T12:00:00Z"};
function stub(payload:unknown,status=200,onCall?:(url:string,init:RequestInit)=>void):typeof fetch {
 return async (url,init)=>{
  onCall?.(String(url),init??{});
  return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});
 };
}
test("PER-1422: list is scoped to explicit tenant and admits pinned persisted cases",async()=>{
 const items=await listPersistedTestBenches(skillId,{workspaceSlug,
  fetcher:stub({data:[example]},200,(url,init)=>{
   assert.equal(url,"/api/skills/team%2Fcore%2Bagent/test-bench?workspaceSlug=workspace-qa");
   assert.equal(init.method,"GET");assert.equal(init.credentials,"same-origin");assert.equal(init.cache,"no-store");
  }),
 });
 assert.equal(items.length,1);assert.equal(items[0]?.sourceCommitSha,"a".repeat(40));
});
test("PER-1422: POST/PATCH/DELETE are same-origin, scoped, payload bounded, revisioned",async()=>{
 const id="779d6f61-c5c6-43ed-8c7d-2f230a84eac4";
 const created=await createPersistedTestBench(skillId,{
  name:"Smoke suite",cases:[case1],requestId:id,
 },{workspaceSlug,fetcher:stub({data:example},201,(url,init)=>{
   assert.equal(url,"/api/skills/team%2Fcore%2Bagent/test-bench?workspaceSlug=workspace-qa");
   assert.equal(init.method,"POST");assert.equal(init.mode,"same-origin");
   assert.equal(JSON.parse(String(init.body)).requestId,id);
  })});
 assert.equal(created.id,uuid);
 const updated=await updatePersistedTestBench(skillId,uuid,{
  name:"Smoke suite v2",cases:[case1],expectedRevision:1,
 },{workspaceSlug,fetcher:stub({data:{...example,revision:2,name:"Smoke suite v2"}},200,(url,init)=>{
   assert.equal(url,"/api/skills/team%2Fcore%2Bagent/test-bench/"+uuid+"?workspaceSlug=workspace-qa");
   assert.equal(init.method,"PATCH");assert.equal(JSON.parse(String(init.body)).expectedRevision,1);
  })});
 assert.equal(updated.revision,2);
 await archivePersistedTestBench(skillId,uuid,2,{workspaceSlug,
  fetcher:stub({data:{id:uuid,revision:3,archived:true}},200,(url,init)=>{
   assert.equal(init.method,"DELETE");assert.match(url,/workspaceSlug=workspace-qa$/);
   assert.equal(JSON.parse(String(init.body)).expectedRevision,2);
  }),
 });
});
test("PER-1422: reject foreign-skill, forged SHA, missing slug, failed provider and malformed JSON",async()=>{
 for(const altered of [{...example,skillId:"foreign"},{...example,sourceCommitSha:"main"},
  {...example,sourceCommitSha:"B".repeat(40)},{...example,cases:[{...case1,providerKey:"bad"}]}]){
  await assert.rejects(()=>listPersistedTestBenches(skillId,{workspaceSlug,
   fetcher:stub({data:[altered]})}),TestBenchClientError);
 }
 await assert.rejects(()=>listPersistedTestBenches(skillId,{workspaceSlug,
  fetcher:stub({error:"denied"},403)}),TestBenchClientError);
 let fetchCalled=false;
 await assert.rejects(()=>listPersistedTestBenches(skillId,{workspaceSlug:"../foreign",
  fetcher:async()=>{fetchCalled=true;throw Error("network");}}),TestBenchClientError);
 assert.equal(fetchCalled,false);
 await assert.rejects(()=>archivePersistedTestBench(skillId,uuid,2,{workspaceSlug,
  fetcher:stub({data:{id:uuid,revision:3,archived:false}})}),TestBenchClientError);
});
