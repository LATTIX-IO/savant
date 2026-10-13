import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {executeQueuedObservedRun} from "../src/server/test-bench/observed-run-worker.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_OBSERVED_CANCELLATION_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("Isolated loopback PostgreSQL and explicit cancellation-test opt-in required");
process.env.TEST_BENCH_ENCRYPTION_KEY="13".repeat(32);
const sql=postgres(uri,{max:8,prepare:false});
const store=createObservedRunStore(sql),defs=createTestBenchDefinitionStore(sql);
const suffix=randomUUID().slice(0,8),sha="a".repeat(40);
const skillId="cancel-"+suffix,sourcePath="skills/"+skillId;
const cases=[
 {caseId:"one",kind:"positive",prompt:"Return one",context:null,expectedBehavior:"Return one"},
 {caseId:"two",kind:"edge",prompt:"Return two",context:null,expectedBehavior:"Return two"},
];
const answers={
 quality:{type:"score",score:4,probabilities:{},confidence:1},
 format_compliance:{type:"score",score:4,probabilities:{},confidence:1},
 policy_compliance:{type:"noul",noul:1},
 grounding_relevant:{type:"noul",noul:1},
 grounding_score:{type:"score",score:4,probabilities:{},confidence:1},
 actionability:{type:"score",score:4,probabilities:{},confidence:1},
 expected_met:{type:"noul",noul:1},
 revisions:{type:"choice",choice:"0",confidence:1,probabilities:{"0":1}},
};
const hasCode=(code)=>e=>e?.code===code;
let organizationId=null,foreignId=null;
try{
 const [org]=await sql`insert into organizations(slug,display_name)
  values(${"cancel-a-"+suffix},'Cancel Test A') returning id`;
 const [foreign]=await sql`insert into organizations(slug,display_name)
  values(${"cancel-b-"+suffix},'Cancel Test B') returning id`;
 organizationId=org.id;foreignId=foreign.id;
 await sql`insert into users(organization_id,external_subject,email,display_name)
  values(${organizationId},'owner',${"owner-"+suffix+"@example.test"},'Run owner')`;
 const [repo]=await sql`insert into repositories(
   organization_id,provider_type,owner_name,repo_name,default_branch)
  values(${organizationId},'github','cancel-test',${"repo-"+suffix},'main') returning id`;
 await sql`insert into indexed_skills(
  organization_id,repository_id,skill_id,display_name,tier,status,
  source_path,source_commit_sha,content_hash)
  values(${organizationId},${repo.id},${skillId},'Cancel','tier1','active',
    ${sourcePath},${sha},'hash')`;
 const admin={organizationId,subject:"owner",role:"admin"};
 const member={...admin,role:"member"};
 const outsider={organizationId:foreignId,subject:"intruder",role:"admin"};
 const def=(await defs.create(admin,skillId,{
  name:"Cancel scenarios",cases,requestId:randomUUID(),
 })).definition;

 // 1. Queued cancellation withdraws background work in one transaction.
 const queued=(await store.start(admin,skillId,def.id,{
  requestId:randomUUID(),expectedRevision:1,
 })).run;
 await assert.rejects(()=>store.cancel(member,skillId,def.id,queued.id,1),
  hasCode("PERMISSION_DENIED"));
 await assert.rejects(()=>store.cancel(outsider,skillId,def.id,queued.id,1),
  hasCode("test_bench_run_not_found"));
 await assert.rejects(()=>store.cancel(admin,skillId,def.id,queued.id,2),
  hasCode("test_bench_revision_conflict"));
 const canceled=await store.cancel(admin,skillId,def.id,queued.id,1);
 assert.equal(canceled.replayed,false);
 assert.equal(canceled.run.status,"canceled");
 assert.equal(canceled.run.canceledBy,"owner");
 assert.ok(canceled.run.canceledAt);
 assert.equal(canceled.run.scorecard,null);
 assert.deepEqual(canceled.run.samples,[]);
 const again=await store.cancel(admin,skillId,def.id,queued.id,1);
 assert.equal(again.replayed,true);
 assert.equal(again.run.canceledAt,canceled.run.canceledAt);
 const [stoppedJob]=await sql`select * from background_jobs
  where id=(select job_id from test_bench_runs where id=${queued.id})`;
 assert.equal(stoppedJob.status,"failed");
 assert.equal((await store.beginJob(organizationId,repo.id,queued.id,stoppedJob.id,1)),null);
 await assert.rejects(()=>store.cancel(admin,skillId,"a".repeat(36),queued.id,1),
  hasCode("test_bench_run_not_found"));
 assert.deepEqual(await store.list(outsider,skillId,def.id),[]);

 // 2. Cancellation during a real model call stops the next Jev call, while
 // retaining only completed observed cases and never generating a scorecard.
 const run=(await store.start(admin,skillId,def.id,{
  requestId:randomUUID(),expectedRevision:1,
 })).run;
 const [job]=await sql`select * from background_jobs
  where id=(select job_id from test_bench_runs where id=${run.id})`;
 let nimCalls=0,jevCalls=0;
 const result=await executeQueuedObservedRun({
  sql,job:{id:job.id,organizationId,repositoryId:repo.id,
   kind:"test_bench_run",dedupeKey:run.id,
   payload:{runId:run.id},progress:{},attempts:1},
  queue:{release:async()=>{throw Error("no release expected");}},
  deadline:Date.now()+230000,
  readInstructions:async(_org,_repo,_path,commit)=>{
   assert.equal(commit,sha);return "Respond with the requested number";
  },
  clients:()=>({
   executor:{model:"nim-test",async complete(){
    nimCalls++;
    if(nimCalls===2){
     const terminal=await store.cancel(admin,skillId,def.id,run.id,1);
     assert.equal(terminal.run.status,"canceled");
    }
    return {content:String(nimCalls),model:"nim-test",latencyMs:15,
      usage:{promptTokens:75,completionTokens:20},
      finishReason:"stop",reasoningChars:0};
   }},
   judge:{model:"jev-test",async ask(){
    jevCalls++;
    return {model:"jev-test",answers,usage:{inputTokens:75,outputTokens:20},latencyMs:10};
   }},
  }),
 });
 assert.equal(result,"done");
 assert.equal(nimCalls,2,"an already-started NIM request can complete");
 assert.equal(jevCalls,1,"no Jev request after cancellation");
 const partial=await store.get(admin,skillId,def.id,run.id);
 assert.equal(partial.status,"canceled");
 assert.equal(partial.completedCases,1);
 assert.equal(partial.samples.length,1);
 assert.equal(partial.samples[0].output,"1");
 assert.equal(partial.scorecard,null);
 assert.equal(partial.canceledBy,"owner");
 const [raw]=await sql`select snapshot_ciphertext,results_ciphertext,scorecard
  from test_bench_runs where id=${run.id}`;
 assert.match(raw.snapshot_ciphertext,/^v1:/);
 assert.match(raw.results_ciphertext,/^v1:/);
 assert.ok(!raw.results_ciphertext.includes(cases[0].prompt));
 assert.ok(!raw.results_ciphertext.includes('"output":"1"'));
 assert.equal(raw.scorecard,null);
 await assert.rejects(()=>store.cancel(admin,skillId,def.id,run.id,2),
  hasCode("test_bench_revision_conflict"));

 // 3. Late completion after cancellation is blocked by status CAS.
 const conflict=(await store.start(admin,skillId,def.id,{
  requestId:randomUUID(),expectedRevision:1,
 })).run;
 const [conflictJob]=await sql`select * from background_jobs
  where id=(select job_id from test_bench_runs where id=${conflict.id})`;
 const claimed=await store.beginJob(organizationId,repo.id,conflict.id,conflictJob.id,1);
 assert.ok(claimed);
 const fakeSample={caseId:"one",prompt:cases[0].prompt,quality:1,
  formatCompliance:1,policyCompliance:true,groundingRelevant:false,groundingScore:1,
  actionability:1,latencyMs:10,estimatedCostUsd:0.0001,humanRevisionCount:0,
  verdict:"pass",kind:"positive",expectedMet:1,output:"real model result",
  executionModel:"test-model",judgeModel:"test-judge"};
 await store.recordCase(claimed.row,fakeSample,1,[]);
 await store.cancel(admin,skillId,def.id,conflict.id,1);
 await assert.rejects(()=>store.recordCase(claimed.row,{
  ...fakeSample,caseId:"two",
 },2,[fakeSample]),hasCode("test_bench_progress_conflict"));
 await assert.rejects(()=>store.complete(claimed.row,{
  samples:[fakeSample,{...fakeSample,caseId:"two"}],scorecard:{overallScore:100},
  totalTokens:500,estimatedCostUsd:0.001,executionModel:"test-model",judgeModel:"test-judge",
 }),hasCode("test_bench_progress_conflict"));
 assert.equal((await store.get(admin,skillId,def.id,conflict.id)).status,"canceled");
 assert.equal(await store.isRunning(organizationId,conflict.id,conflictJob.id),false);

 const actions=await sql`select action,payload_redacted from audit_events
  where organization_id=${organizationId} and target_type='test_bench_run'`;
 assert.equal(actions.filter(x=>x.action==="test_bench_run_canceled").length,3);
 const receipts=JSON.stringify(actions);
 for(const candidate of [cases[0].prompt,cases[1].prompt,"real model result"])
  assert.ok(!receipts.includes(candidate),"audit must not leak private case text");
 console.log(JSON.stringify({cancelObservedRuns:"passed",checks:[
  "role-and-foreign-tenant-denial","stale-revision-denial","idempotent-cancel-audit",
  "queued-job-claim-blocked","cancel-during-NIM-no-followup-Jev",
  "encrypted-partial-case","terminal-compare-and-swap",
  "no-post-cancel-scorecard","no-plaintext-audit",
 ]}));
}finally{
 if(organizationId)await sql`delete from organizations where id=${organizationId}`;
 if(foreignId)await sql`delete from organizations where id=${foreignId}`;
 await sql.end({timeout:5});
}
