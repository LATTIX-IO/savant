import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {createObservedProviderUsageStore} from "../src/server/test-bench/observed-provider-usage.ts";
import {executeQueuedObservedRun} from "../src/server/test-bench/observed-run-worker.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_PROVIDER_USAGE_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("PER-1447 requires explicit opt-in and isolated loopback PostgreSQL");
process.env.TEST_BENCH_ENCRYPTION_KEY="21".repeat(32);
const sql=postgres(uri,{max:10,prepare:false});
const definitions=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const usageStore=createObservedProviderUsageStore(sql);
const suffix=randomUUID().slice(0,8),sha="a".repeat(40);
const skillId="usage-"+suffix,secretPrompt="PRIVATE_USAGE_PROMPT_NOT_LOGGABLE";
const cases=[{caseId:"first",kind:"positive",prompt:secretPrompt,
 context:null,expectedBehavior:"Answer four"}];
const score={type:"score",score:4,probabilities:{},confidence:1};
const yes={type:"noul",noul:1};
const answers={
 quality:score,format_compliance:score,grounding_score:score,
 actionability:score,policy_compliance:yes,grounding_relevant:yes,expected_met:yes,
 revisions:{type:"choice",choice:"0",confidence:1,probabilities:{"0":1}},
};
let orgId=null,otherId=null;
const hasCode=(code)=>error=>error?.code===code;
function jobPayload(row,organizationId,repositoryId){
 return {id:row.id,organizationId,repositoryId,kind:"test_bench_run",
  dedupeKey:row.runId,payload:{runId:row.runId},progress:{},attempts:1};
}
try{
 const [org]=await sql`insert into organizations(slug,display_name)
  values(${"provider-usage-a-"+suffix},'Provider Usage A') returning id`;
 const [other]=await sql`insert into organizations(slug,display_name)
  values(${"provider-usage-b-"+suffix},'Provider Usage B') returning id`;
 orgId=org.id;otherId=other.id;
 await sql`insert into users(organization_id,external_subject,email,display_name)
  values(${orgId},'owner',${"usage-"+suffix+"@example.test"},'Usage owner')`;
 const [repo]=await sql`insert into repositories(
  organization_id,provider_type,owner_name,repo_name,default_branch)
  values(${orgId},'github','usage-test',${"repo-"+suffix},'main') returning id`;
 await sql`insert into indexed_skills(
  organization_id,repository_id,skill_id,display_name,tier,status,
  source_path,source_commit_sha,content_hash)
  values(${orgId},${repo.id},${skillId},'Provider usage','tier1','active',
   ${"skills/"+skillId},${sha},'hash')`;
 const admin={organizationId:orgId,subject:"owner",role:"admin"};
 const suite=(await definitions.create(admin,skillId,{
  name:"Observed token receipt suite",cases,requestId:randomUUID(),
 })).definition;

 async function newRun(){
   const {run}=await runs.start(admin,skillId,suite.id,{
     expectedRevision:1,requestId:randomUUID(),
   });
   const [job]=await sql`select id from background_jobs
     where id=(select job_id from test_bench_runs where id=${run.id})`;
   return {run,job:jobPayload({id:job.id,runId:run.id},orgId,repo.id)};
 }
 async function worker(job,options){
   let executorCalls=0,judgeCalls=0;
   const result=await executeQueuedObservedRun({
    sql,job,queue:{release:async()=>{throw Error("unexpected release");}},
    deadline:Date.now()+230000,
    readInstructions:async()=> "Answer the case with the number four.",
    clients:()=>({
      executor:{model:"nim-usage-test",async complete(){
        executorCalls++;
        if(options?.cancelOnExecutor){
          const canceled=await runs.cancel(admin,skillId,suite.id,job.payload.runId,1);
          assert.equal(canceled.run.status,"canceled");
        }
        return {content:"PRIVATE_REAL_MODEL_OUTPUT",model:"nim-usage-test",
          latencyMs:15,usage:{promptTokens:80,completionTokens:20},
          finishReason:"stop",reasoningChars:0};
      }},
      judge:{model:"jev-usage-test",async ask(){
        judgeCalls++;
        if(options?.failJudge)throw Error("PRIVATE_PROVIDER_ERROR_NOT_LOGGABLE");
        return {model:"jev-usage-test",latencyMs:10,
         usage:{inputTokens:65,outputTokens:15},answers};
      }},
    }),
   });
   assert.equal(result,"done");
   return {executorCalls,judgeCalls};
 }

 // 1. During a remote request, cancellation marks run terminal. The provider
 // can still finish and report tokens. Save those even though no score exists.
 const canceled=await newRun();
 const canceledCounts=await worker(canceled.job,{cancelOnExecutor:true});
 assert.deepEqual(canceledCounts,{executorCalls:1,judgeCalls:0});
 const canceledRun=await runs.get(admin,skillId,suite.id,canceled.run.id);
 assert.equal(canceledRun.status,"canceled");
 assert.equal(canceledRun.scorecard,null);
 assert.equal(canceledRun.totalTokens,0,
  "legacy final-run aggregate is not a partial token meter");
 assert.equal(canceledRun.observedExecutorTokens,100);
 assert.equal(canceledRun.observedJudgeTokens,0);
 assert.equal(canceledRun.observedUsageReceipts,1);
 assert.equal(canceledRun.completedCases,0);
 const [canceledReceipt]=await sql`select case_index,phase,model,
  prompt_tokens,completion_tokens from test_bench_provider_usage_receipts
  where organization_id=${orgId} and run_id=${canceled.run.id}`;
 assert.equal(canceledReceipt.phase,"executor");
 assert.equal(canceledReceipt.prompt_tokens,80);
 assert.equal(canceledReceipt.completion_tokens,20);
 assert.equal(canceledReceipt.model,"nim-usage-test");

 // 2. Same ACK retry is harmless, conflicting receipt is a hard failure.
 const same={index:1,phase:"executor",model:"nim-usage-test",
  promptTokens:80,completionTokens:20};
 assert.deepEqual(await usageStore.record(orgId,canceled.run.id,canceled.job.id,same),
   {recorded:false});
 await assert.rejects(()=>usageStore.record(orgId,canceled.run.id,canceled.job.id,{
   ...same,completionTokens:21,
 }),hasCode("test_bench_usage_receipt_conflict"));
 assert.equal((await runs.get(admin,skillId,suite.id,canceled.run.id)).observedExecutorTokens,100);
 await assert.rejects(()=>usageStore.record(otherId,canceled.run.id,canceled.job.id,same),
   hasCode("test_bench_usage_run_unavailable"));
 await assert.rejects(()=>sql`insert into test_bench_provider_usage_receipts(
  organization_id,run_id,case_index,phase,model,prompt_tokens,completion_tokens
 ) values (${otherId},${canceled.run.id},1,'judge','jev',5,5)`,
   e=>e?.code==="23503");
 for(const faulty of [
  {...same,index:0},{...same,index:5},{...same,phase:"tools"},
  {...same,promptTokens:-1},{...same,completionTokens:0,promptTokens:0},
  {...same,model:""},{...same,model:"x".repeat(170)},
 ]){
  await assert.rejects(()=>usageStore.record(orgId,canceled.run.id,canceled.job.id,faulty),
   hasCode("test_bench_usage_receipt_invalid"));
 }

 // 3. Fully executed run acknowledges exactly one NIM and one Jev receipt.
 const completed=await newRun();
 assert.deepEqual(await worker(completed.job),
   {executorCalls:1,judgeCalls:1});
 const finished=await runs.get(admin,skillId,suite.id,completed.run.id);
 assert.equal(finished.status,"complete");
 assert.equal(finished.observedExecutorTokens,100);
 assert.equal(finished.observedJudgeTokens,80);
 assert.equal(finished.observedUsageReceipts,2);
 assert.equal(finished.totalTokens,180);
 assert.equal(finished.scorecard.sampleCount,1);

 // 4. Judge transport failure retains already acknowledged executor usage,
 // but NEVER invents any judge cost or aggregate score.
 const failed=await newRun();
 assert.deepEqual(await worker(failed.job,{failJudge:true}),
   {executorCalls:1,judgeCalls:1});
 const failure=await runs.get(admin,skillId,suite.id,failed.run.id);
 assert.equal(failure.status,"failed");
 assert.equal(failure.observedExecutorTokens,100);
 assert.equal(failure.observedJudgeTokens,0);
 assert.equal(failure.observedUsageReceipts,1);
 assert.equal(failure.scorecard,null);
 assert.equal(failure.totalTokens,0);

 // 5. Repeated same valid receipt while running may race through multiple
 // workers and still generate only one ledger entry and counter increment.
 const pending=await newRun();
 const initiated=await runs.beginJob(orgId,repo.id,pending.run.id,pending.job.id,1);
 assert.ok(initiated);
 const receipt={index:1,phase:"executor",model:"nim-usage-test",
   promptTokens:20,completionTokens:5};
 const identical=await Promise.all(Array.from({length:10},()=>usageStore.record(
   orgId,pending.run.id,pending.job.id,receipt)));
 assert.equal(identical.filter(x=>x.recorded).length,1);
 assert.equal((await runs.get(admin,skillId,suite.id,pending.run.id)).observedExecutorTokens,25);
 assert.equal((await runs.get(admin,skillId,suite.id,pending.run.id)).observedUsageReceipts,1);
 // A case may carry a real encrypted sample, yet scoring is forbidden if
 // its judge phase lacks a durable usage ACK. The attempted completion
 // rolls back without a partial scorecard.
 await runs.recordCase(initiated.row,finished.samples[0],1,[]);
 await assert.rejects(()=>runs.complete(initiated.row,{
  samples:finished.samples,scorecard:finished.scorecard,
  totalTokens:180,estimatedCostUsd:0.0001,
  executionModel:"nim-usage-test",judgeModel:"jev-usage-test",
 }),hasCode("test_bench_usage_evidence_incomplete"));
 const unscored=await runs.get(admin,skillId,suite.id,pending.run.id);
 assert.equal(unscored.status,"running");
 assert.equal(unscored.scorecard,null);
 assert.equal(unscored.observedUsageReceipts,1);
 await runs.cancel(admin,skillId,suite.id,pending.run.id,1);

 const rows=await sql`select model,phase,prompt_tokens,completion_tokens
  from test_bench_provider_usage_receipts where organization_id=${orgId}`;
 assert.equal(rows.length,5);
 const allEvents=JSON.stringify(await sql`select payload_redacted from audit_events
  where organization_id=${orgId} and target_type='test_bench_run'`);
 const allReceipts=JSON.stringify(rows);
 const allJobs=JSON.stringify(await sql`select payload from background_jobs
  where organization_id=${orgId} and kind='test_bench_run'`);
 for(const material of [allEvents,allReceipts,allJobs]){
  for(const secret of [secretPrompt,"PRIVATE_REAL_MODEL_OUTPUT",
    "PRIVATE_PROVIDER_ERROR_NOT_LOGGABLE","sk-PROVIDER-SECRET"]){
   assert.ok(!material.includes(secret),"usage evidence must be metadata-only");
  }
 }
 console.log(JSON.stringify({providerUsageEvidence:"passed",checks:[
  "canceled in-flight NIM response retained provider-reported executor tokens",
  "canceled run has no completed case or aggregate score",
  "exact duplicate receipt idempotency and altered duplicate denial",
  "foreign tenant FK and malformed usage rejection",
  "complete run persisted separate executor+Jev receipts",
  "failed judge retained executor ACK without fabricated judge tokens",
  "ten concurrent identical receipts inserted only once",
  "complete score refused without every durable executor/Jev receipt",
  "metadata-only receipts, queue and audit are secret-free",
 ]}));
}finally{
 if(orgId)await sql`delete from organizations where id=${orgId}`;
 if(otherId)await sql`delete from organizations where id=${otherId}`;
 await sql.end({timeout:5});
}
