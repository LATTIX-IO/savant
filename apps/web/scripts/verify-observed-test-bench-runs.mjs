import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {executeQueuedObservedRun} from "../src/server/test-bench/observed-run-worker.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_OBSERVED_TEST_BENCH_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("Observed runs must use isolated opt-in loopback PostgreSQL");
process.env.TEST_BENCH_ENCRYPTION_KEY="12".repeat(32);
const sql=postgres(uri,{max:8,prepare:false});
const store=createObservedRunStore(sql),defs=createTestBenchDefinitionStore(sql);
const suffix=randomUUID().slice(0,8),commitA="a".repeat(40),commitB="b".repeat(40);
const skillId="observed-"+suffix,requestId=randomUUID();
const cases=[{caseId:"safe-1",kind:"positive",prompt:"What is 2+2?",
  context:null,expectedBehavior:"Answer four"}];
const fakeAnswers={
 quality:{type:"score",score:4,probabilities:{},confidence:1},
 format_compliance:{type:"score",score:4,probabilities:{},confidence:1},
 policy_compliance:{type:"noul",noul:1},grounding_relevant:{type:"noul",noul:1},
 grounding_score:{type:"score",score:4,probabilities:{},confidence:1},
 actionability:{type:"score",score:4,probabilities:{},confidence:1},
 expected_met:{type:"noul",noul:1},
 revisions:{type:"choice",choice:"0",confidence:1,probabilities:{"0":1}},
};
let orgId=null,foreignId=null;
try{
 const [org]=await sql`insert into organizations(slug,display_name)
  values(${"observed-a-"+suffix},'Observed A') returning id`;
 const [foreign]=await sql`insert into organizations(slug,display_name)
  values(${"observed-b-"+suffix},'Observed B') returning id`;
 orgId=org.id;foreignId=foreign.id;
 await sql`insert into users(organization_id,external_subject,email,display_name)
   values(${orgId},'owner',${"owner-"+suffix+"@example.test"},'Original test-run initiator')`;
 const [repo]=await sql`insert into repositories
  (organization_id,provider_type,owner_name,repo_name,default_branch)
  values(${orgId},'github','observed-test',${"repo-"+suffix},'main') returning id`;
 await sql`insert into indexed_skills
  (organization_id,repository_id,skill_id,display_name,tier,status,source_path,source_commit_sha,content_hash)
  values(${orgId},${repo.id},${skillId},'Observed','tier1','active',
    ${"skills/"+skillId},${commitA},'hash')`;
 const actor={organizationId:orgId,subject:"owner",role:"admin"};
 const member={...actor,role:"member"};
 const outsider={organizationId:foreignId,subject:"outsider",role:"admin"};
 const suite=(await defs.create(actor,skillId,{
  name:"Observed smoke",cases,requestId:randomUUID(),
 })).definition;
 const first=await store.start(actor,skillId,suite.id,{expectedRevision:1,requestId});
 assert.equal(first.replayed,false);
 assert.equal(first.run.status,"queued");
 assert.equal(first.run.sourceCommitSha,commitA);
 assert.deepEqual(first.run.samples,[]);
 const replay=await store.start(actor,skillId,suite.id,{expectedRevision:1,requestId});
 assert.equal(replay.replayed,true);assert.equal(replay.run.id,first.run.id);
 await assert.rejects(()=>store.start(actor,skillId,suite.id,{
  expectedRevision:2,requestId,
 }),e=>e?.code==="test_bench_run_request_conflict");
 await assert.rejects(()=>store.start(member,skillId,suite.id,{
  expectedRevision:1,requestId:randomUUID(),
 }),e=>e?.code==="PERMISSION_DENIED");
 await assert.rejects(()=>store.start(outsider,skillId,suite.id,{
  expectedRevision:1,requestId:randomUUID(),
 }),e=>e?.code==="test_bench_not_found");
 await assert.rejects(()=>store.start(actor,skillId,suite.id,{
  expectedRevision:1,requestId:randomUUID(),
 }),e=>e?.code==="test_bench_run_already_active"||
        e?.code==="test_bench_tenant_capacity_exceeded");
 assert.deepEqual(await store.list(outsider,skillId,suite.id),[]);
 await assert.rejects(()=>store.get(outsider,skillId,suite.id,first.run.id),
  e=>e?.code==="test_bench_run_not_found");

 const [raw]=await sql`select snapshot_ciphertext,results_ciphertext,job_id,
  source_commit_sha from test_bench_runs where id=${first.run.id}`;
 assert.equal(raw.source_commit_sha,commitA);
 assert.match(raw.snapshot_ciphertext,/^v1:/);
 assert.equal(raw.results_ciphertext,null);
 assert.ok(!raw.snapshot_ciphertext.includes(cases[0].prompt));
 const [job]=await sql`select * from background_jobs where id=${raw.job_id}`;
 assert.equal(job.kind,"test_bench_run");
 assert.deepEqual(job.payload,{runId:first.run.id});
 assert.ok(!JSON.stringify(job).includes(cases[0].prompt));

 // Queue-time snapshot remains A even if index and definition are edited to B.
 await sql`update indexed_skills set source_commit_sha=${commitB},last_indexed_at=now()
  where organization_id=${orgId} and skill_id=${skillId}`;
 const updated=await defs.update(actor,skillId,suite.id,{
  name:"Edited after queue",cases:[{...cases[0],prompt:"Changed in revision 2"}],
  expectedRevision:1,
 });
 assert.equal(updated.revision,2);assert.equal(updated.sourceCommitSha,commitA);
 let calls=0;let gitCommitObserved=null;
 const clients={
  executor:{model:"NIM-mock",async complete(_messages,options){
   calls++;assert.equal(options.timeoutMs,15000);
   return {content:"4",model:"NIM-mock",latencyMs:19,
     usage:{promptTokens:80,completionTokens:20},
     finishReason:"stop",reasoningChars:0};
  }},
  judge:{model:"Jev-mock",async ask(_state,_questions,options){
   assert.equal(options.timeoutMs,10000);
   return {model:"Jev-mock",answers:fakeAnswers,
     usage:{inputTokens:80,outputTokens:20},latencyMs:10};
  }},
 };
 const result=await executeQueuedObservedRun({
   sql,job:{id:job.id,organizationId:orgId,repositoryId:repo.id,
     kind:"test_bench_run",dedupeKey:first.run.id,payload:{runId:first.run.id},
     progress:{},attempts:1},
   queue:{release:async()=>{throw Error("unexpected release");}},
   deadline:Date.now()+230000,
   readInstructions:async(_tenant,_repo,path,sha)=>{
    assert.equal(path,"skills/"+skillId);
    gitCommitObserved=sha;
    return "Return the correct arithmetic result";
   },
   clients:()=>clients,
 });
 assert.equal(result,"done");assert.equal(calls,1);
 assert.equal(gitCommitObserved,commitA,"must execute admission-time SHA");
 const completed=await store.get(actor,skillId,suite.id,first.run.id);
 assert.equal(completed.status,"complete");
 assert.equal(completed.completedCases,1);
 assert.equal(completed.scorecard.sampleCount,1);
 assert.equal(completed.samples[0].output,"4");
 assert.equal(completed.samples[0].verdict,"pass");
 assert.ok(completed.estimatedCostUsd>=0);
 const [observedRaw]=await sql`select snapshot_ciphertext,results_ciphertext,scorecard,
  completed_cases from test_bench_runs where id=${first.run.id}`;
 assert.match(observedRaw.results_ciphertext,/^v1:/);
 assert.ok(!observedRaw.results_ciphertext.includes(cases[0].prompt));
 assert.ok(!observedRaw.results_ciphertext.includes("NIM-mock"));
 assert.equal(observedRaw.completed_cases,1);

 // Fresh run: uncertain retry must fail closed without a second paid call.
 const unsafe=await store.start(actor,skillId,suite.id,{
  expectedRevision:2,requestId:randomUUID(),
 });
 const [recoverJob]=await sql`select * from background_jobs
  where id=(select job_id from test_bench_runs where id=${unsafe.run.id})`;
 const outcome=await executeQueuedObservedRun({
  sql,job:{id:recoverJob.id,organizationId:orgId,repositoryId:repo.id,
   kind:"test_bench_run",dedupeKey:unsafe.run.id,
   payload:{runId:unsafe.run.id},progress:{},attempts:2},
  queue:{release:async()=>{throw Error("unexpected");}},
  deadline:Date.now()+230000,
  readInstructions:async()=>{throw Error("must never read source on retry");},
  clients:()=>{throw Error("must never call provider on retry");},
 });
 assert.equal(outcome,"done");
 const failed=await store.get(actor,skillId,suite.id,unsafe.run.id);
 assert.equal(failed.status,"failed");assert.equal(failed.scorecard,null);
 assert.equal(failed.errorCode,"test_bench_unconfirmed_provider_retry");
 assert.equal(calls,1);

 // A valid first attempt MUST refuse provider egress if the initiator was
 // offboarded after admission but before the worker claimed the job.
 const revoked=await store.start(actor,skillId,suite.id,{
   expectedRevision:2,requestId:randomUUID(),
 });
 await sql`update users set status='disabled' where organization_id=${orgId} and external_subject='owner'`;
 const [revokedJob]=await sql`select * from background_jobs
   where id=(select job_id from test_bench_runs where id=${revoked.run.id})`;
 const refused=await executeQueuedObservedRun({
   sql,job:{id:revokedJob.id,organizationId:orgId,repositoryId:repo.id,
     kind:"test_bench_run",dedupeKey:revoked.run.id,
     payload:{runId:revoked.run.id},progress:{},attempts:1},
   queue:{release:async()=>{throw Error("unexpected");}},
   deadline:Date.now()+230000,
   readInstructions:async()=>{throw Error("revoked operator must not read sources");},
   clients:()=>{throw Error("revoked operator must not invoke model");},
 });
 assert.equal(refused,"done");
 const rejected=await store.get(actor,skillId,suite.id,revoked.run.id);
 assert.equal(rejected.status,"failed");
 assert.equal(rejected.errorCode,"test_bench_actor_revoked");
 assert.equal(calls,1);
 const logs=JSON.stringify(await sql`select payload_redacted from audit_events
  where organization_id=${orgId} and target_type='test_bench_run'`);
 assert.ok(!logs.includes(cases[0].prompt));
 assert.ok(!logs.includes("Changed in revision 2"));
 assert.ok(!logs.includes("NIM-mock"));
 console.log(JSON.stringify({observedRuns:"passed",assertions:[
  "exactly-once admission","cross-tenant read/write denial","role refusal",
  "encrypted queue snapshot","immutable revision A after index B",
  "observed NIM and Jev output persisted encrypted","complete scorecard only after observation",
  "unsafe retry fails before provider IO","revoked operator denied before egress",
  "metadata-only audited events",
 ]}));
}finally{
 if(orgId)await sql`delete from organizations where id=${orgId}`;
 if(foreignId)await sql`delete from organizations where id=${foreignId}`;
 await sql.end({timeout:5});
}
