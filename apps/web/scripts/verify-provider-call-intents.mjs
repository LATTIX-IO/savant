import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {createObservedProviderCallIntentStore} from "../src/server/test-bench/provider-call-intents.ts";
import {createObservedProviderUsageStore} from "../src/server/test-bench/observed-provider-usage.ts";
import {executeQueuedObservedRun} from "../src/server/test-bench/observed-run-worker.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_PROVIDER_INTENT_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("PER-1457 requires explicit opt-in and isolated loopback PostgreSQL");
process.env.TEST_BENCH_ENCRYPTION_KEY="25".repeat(32);
const sql=postgres(uri,{max:14,prepare:false});
const definitions=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const intents=createObservedProviderCallIntentStore(sql);
const usage=createObservedProviderUsageStore(sql);
const suffix=randomUUID().slice(0,8);
const secret="PRIVATE_PROVIDER_INTENT_TEST_PROMPT";
const cases=[{caseId:"c1",kind:"positive",prompt:secret,context:null,
 expectedBehavior:"answer four"}];
const score={type:"score",score:4,confidence:1,probabilities:{}};
const yes={type:"noul",noul:1};
const answers={
 quality:score,format_compliance:score,grounding_score:score,
 actionability:score,policy_compliance:yes,grounding_relevant:yes,expected_met:yes,
 revisions:{type:"choice",choice:"0",confidence:1,probabilities:{"0":1}},
};
const created=[];
const hasCode=code=>e=>e?.code===code;
async function tenant(label){
 const [org]=await sql`insert into organizations(slug,display_name)
   values(${"call-intents-"+label+"-"+suffix},${"Call Intents "+label}) returning id`;
 created.push(org.id);
 await sql`insert into users(organization_id,external_subject,email,display_name)
  values(${org.id},${"operator-"+label},${"intents-"+label+"-"+suffix+"@example.test"},'Operator')`;
 const skillId="intent-"+label+"-"+suffix;
 const [repo]=await sql`insert into repositories(
  organization_id,provider_type,owner_name,repo_name,default_branch
  ) values(${org.id},'github',${"intent-"+label},${"repo-"+suffix},'main') returning id`;
 await sql`insert into indexed_skills(
  organization_id,repository_id,skill_id,display_name,tier,status,
  source_path,source_commit_sha,content_hash
 ) values (${org.id},${repo.id},${skillId},'Call intent skill','tier1','active',
  ${"skills/"+skillId},${"a".repeat(40)},'hash')`;
 const actor={organizationId:org.id,subject:"operator-"+label,role:"admin"};
 const suite=(await definitions.create(actor,skillId,{
   name:"Provider intent suite",cases,requestId:randomUUID(),
 })).definition;
 return {id:org.id,repoId:repo.id,actor,skillId,suite};
}
async function newRun(tenant){
 const {run}=await runs.start(tenant.actor,tenant.skillId,tenant.suite.id,{
   expectedRevision:1,requestId:randomUUID(),executionSource:"platform-nim",
 });
 const [queued]=await sql`select job_id from test_bench_runs where id=${run.id}`;
 const job={id:queued.job_id,organizationId:tenant.id,repositoryId:tenant.repoId,
  kind:"test_bench_run",dedupeKey:run.id,payload:{runId:run.id},progress:{},attempts:1};
 return {run,job};
}
async function running(tenant){
 const out=await newRun(tenant);
 const began=await runs.beginJob(tenant.id,tenant.repoId,out.run.id,out.job.id,1);
 assert.ok(began);
 return out;
}
const ack=(index,phase,model,promptTokens,completionTokens)=>
 ({index,phase,model,promptTokens,completionTokens});
try{
 const a=await tenant("a"),b=await tenant("b");
 const first=await running(a);
 assert.equal((await runs.get(a.actor,a.skillId,a.suite.id,first.run.id)).unconfirmedProviderCalls,0);
 await assert.rejects(()=>intents.record(b.id,first.run.id,first.job.id,
  {index:1,phase:"executor"}),hasCode("test_bench_provider_intent_run_unavailable"));
 await assert.rejects(()=>intents.record(a.id,first.run.id,randomUUID(),
  {index:1,phase:"executor"}),hasCode("test_bench_provider_intent_run_unavailable"));
 for(const bad of [
  {index:0,phase:"executor"},{index:5,phase:"executor"},{index:1,phase:"tool"},
  {index:1,phase:"unknown"},{index:1.5,phase:"executor"},
 ]){
  await assert.rejects(()=>intents.record(a.id,first.run.id,first.job.id,bad),
    hasCode("test_bench_provider_intent_invalid"));
 }
 await assert.rejects(()=>intents.record(a.id,first.run.id,first.job.id,
  {index:1,phase:"judge"}),hasCode("test_bench_provider_intent_executor_unacknowledged"));
 await assert.rejects(()=>intents.record(a.id,first.run.id,first.job.id,
  {index:2,phase:"executor"}),hasCode("test_bench_provider_intent_out_of_order"));

 // Exactly one worker may commit a given phase intent. 11 loser callbacks
 // refuse the external request before any provider I/O.
 const contenders=await Promise.allSettled(Array.from({length:12},
  ()=>intents.record(a.id,first.run.id,first.job.id,{index:1,phase:"executor"})));
 assert.equal(contenders.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(contenders.filter(x=>x.status==="rejected").length,11);
 assert.ok(contenders.filter(x=>x.status==="rejected").every(x=>
  hasCode("test_bench_provider_intent_replayed")(x.reason)));
 assert.equal((await runs.get(a.actor,a.skillId,a.suite.id,first.run.id)).unconfirmedProviderCalls,1);
 await usage.record(a.id,first.run.id,first.job.id,ack(1,"executor","nim-test",65,15));
 let snapshot=await runs.get(a.actor,a.skillId,a.suite.id,first.run.id);
 assert.equal(snapshot.unconfirmedProviderCalls,0);
 assert.equal(snapshot.observedUsageReceipts,1);
 assert.deepEqual(await usage.record(a.id,first.run.id,first.job.id,
  ack(1,"executor","nim-test",65,15)),{recorded:false});
 assert.equal((await runs.get(a.actor,a.skillId,a.suite.id,first.run.id)).unconfirmedProviderCalls,0);
 await intents.record(a.id,first.run.id,first.job.id,{index:1,phase:"judge"});
 assert.equal((await runs.get(a.actor,a.skillId,a.suite.id,first.run.id)).unconfirmedProviderCalls,1);
 await usage.record(a.id,first.run.id,first.job.id,ack(1,"judge","jev-test",40,10));
 assert.equal((await runs.get(a.actor,a.skillId,a.suite.id,first.run.id)).unconfirmedProviderCalls,0);
 // Finish the first active definition before opening another attempt.
 await runs.cancel(a.actor,a.skillId,a.suite.id,first.run.id,1);

 // Cancellation of an already dispatched request cannot refund or assume
 // billable amount is zero. Legitimate ACK after cancellation resolves pending.
 const canceled=await running(a);
 await intents.record(a.id,canceled.run.id,canceled.job.id,{index:1,phase:"executor"});
 const canceledResult=await runs.cancel(a.actor,a.skillId,a.suite.id,canceled.run.id,1);
 assert.equal(canceledResult.run.unconfirmedProviderCalls,1);
 assert.equal(canceledResult.run.status,"canceled");
 await assert.rejects(()=>intents.record(a.id,canceled.run.id,canceled.job.id,
  {index:1,phase:"judge"}),hasCode("test_bench_provider_intent_run_not_active"));
 await usage.record(a.id,canceled.run.id,canceled.job.id,ack(1,"executor","nim-test",70,20));
 snapshot=await runs.get(a.actor,a.skillId,a.suite.id,canceled.run.id);
 assert.equal(snapshot.status,"canceled");
 assert.equal(snapshot.unconfirmedProviderCalls,0);
 assert.equal(snapshot.observedExecutorTokens,90);
 assert.equal(snapshot.scorecard,null);

 // Test the actual worker call path with a provider timeout: egress starts
 // only after its intent exists, and an uncertain response leaves it pending.
 const timeout=await newRun(a);let timeoutCalls=0,judgeCalls=0;
 const outcome=await executeQueuedObservedRun({
  sql,job:timeout.job,queue:{release:async()=>{throw Error("unexpected release");}},
  deadline:Date.now()+230000,
  readInstructions:async()=> "Only answer with 4.",
  clients:()=>({
   executor:{model:"nim-test",async complete(){
    timeoutCalls++;
    const [pending]=await sql`select count(*)::int as n
      from test_bench_provider_call_intents
      where run_id=${timeout.run.id} and phase='executor'`;
    assert.equal(pending.n,1,"pre-egress intent must be durable before model call");
    throw Error("PRIVATE_PROVIDER_TIMEOUT_ERROR");
   }},
   judge:{model:"jev-test",async ask(){
    judgeCalls++;throw Error("judge must not be called");
   }},
  }),
 });
 assert.equal(outcome,"done");assert.equal(timeoutCalls,1);assert.equal(judgeCalls,0);
 snapshot=await runs.get(a.actor,a.skillId,a.suite.id,timeout.run.id);
 assert.equal(snapshot.status,"failed");assert.equal(snapshot.scorecard,null);
 assert.equal(snapshot.unconfirmedProviderCalls,1);
 assert.equal(snapshot.observedUsageReceipts,0);
 assert.equal(snapshot.observedExecutorTokens,0);

 // Successful real worker acknowledges the two metadata-only intents.
 const complete=await newRun(b);
 const finishedResult=await executeQueuedObservedRun({
  sql,job:complete.job,queue:{release:async()=>{throw Error("unexpected release");}},
  deadline:Date.now()+230000,
  readInstructions:async()=> "Only answer with 4.",
  clients:()=>({
   executor:{model:"nim-test",async complete(){
    return {content:"4",model:"nim-test",latencyMs:14,
      usage:{promptTokens:65,completionTokens:15},
      finishReason:"stop",reasoningChars:0};
   }},
   judge:{model:"jev-test",async ask(){
    return {model:"jev-test",usage:{inputTokens:40,outputTokens:10},
      latencyMs:12,answers};
   }},
  }),
 });
 assert.equal(finishedResult,"done");
 snapshot=await runs.get(b.actor,b.skillId,b.suite.id,complete.run.id);
 assert.equal(snapshot.status,"complete");assert.equal(snapshot.unconfirmedProviderCalls,0);
 assert.equal(snapshot.observedUsageReceipts,2);
 assert.equal(snapshot.totalTokens,130);
 const confirmed=await sql`select phase,provider_code,acknowledged_at
   from test_bench_provider_call_intents
   where organization_id=${b.id} and run_id=${complete.run.id}`;
 assert.equal(confirmed.length,2);
 assert.ok(confirmed.every(row=>row.acknowledged_at!==null));
 assert.deepEqual(confirmed.map(row=>row.provider_code).sort(),["jev","nim"]);

 // Foreign actor cannot query intent state through the tenant-scoped run API.
 await assert.rejects(()=>runs.get(b.actor,a.skillId,a.suite.id,timeout.run.id),
  hasCode("test_bench_run_not_found"));
 await assert.rejects(()=>sql`insert into test_bench_provider_call_intents(
  organization_id,run_id,job_id,case_index,phase,provider_code
 ) values (${b.id},${timeout.run.id},${timeout.job.id},1,'judge','jev')`,
  e=>e?.code==="23503");
 const unused=await newRun(b);
 await assert.rejects(()=>sql`insert into test_bench_provider_call_intents(
  organization_id,run_id,job_id,case_index,phase,provider_code
 ) values (${b.id},${unused.run.id},${unused.job.id},1,'judge','nim')`,
  e=>e?.code==="23514");
 await assert.rejects(()=>sql`insert into test_bench_provider_call_intents(
  organization_id,run_id,job_id,case_index,phase,provider_code
 ) values (${b.id},${unused.run.id},${unused.job.id},5,'executor','nim')`,
  e=>e?.code==="23514");
 await assert.rejects(()=>sql`insert into test_bench_provider_call_intents(
  organization_id,run_id,job_id,case_index,phase,provider_code,
  recorded_at,acknowledged_at
 ) values (${b.id},${unused.run.id},${unused.job.id},1,'executor','nim',
   now(),'2000-01-01T00:00:00Z')`,e=>e?.code==="23514");
 const rows=await sql`select organization_id,run_id,job_id,
  case_index,phase,provider_code,recorded_at,acknowledged_at
  from test_bench_provider_call_intents where organization_id in (${a.id},${b.id})`;
 const audits=JSON.stringify(await sql`select payload_redacted from audit_events
   where organization_id in (${a.id},${b.id})
     and target_type='test_bench_run'`);
 const all=JSON.stringify(rows)+audits;
 for(const leak of [secret,"PRIVATE_PROVIDER_TIMEOUT_ERROR","sk-PRIVATE_TOKEN", "PRIVATE_REAL_MODEL_OUTPUT"]){
  assert.ok(!all.includes(leak),"no case/model/provider/secret leakage into dispatch ledger or audit");
 }
 console.log(JSON.stringify({providerCallIntents:"passed",checks:[
  "pre-egress intent identity and ordering fail closed",
  "12-way duplicate dispatch intent race allows only one",
  "exact ACK idempotency and pending count resolution",
  "cancellation after egress leaves pending until real late ACK",
  "timeout failed run keeps unknown external side-effect intent",
  "complete worker has exactly two provider acknowledged intents and score",
  "foreign tenant read and FK substitution denied",
  "invalid provider/phase, index, timestamp database CHECK denied",
  "metadata-only stored intents and redacted audit",
 ]}));
}finally{
 for(const id of created)await sql`delete from organizations where id=${id}`;
 await sql.end({timeout:5});
}
