import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {reserveDailyAdmission} from "../src/server/test-bench/observed-admission-quota.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_DAILY_QUOTA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("Test Bench quota tests require explicit opt-in and isolated loopback PostgreSQL");
process.env.TEST_BENCH_ENCRYPTION_KEY="19".repeat(32);
const sql=postgres(uri,{max:12,prepare:false});
const store=createObservedRunStore(sql),definitions=createTestBenchDefinitionStore(sql);
const suffix=randomUUID().slice(0,8),sha="a".repeat(40),
 secretText="PRIVATE_QUOTA_TEST_CASE_PROMPT";
const caseSet=[{caseId:"case-1",kind:"positive",
 prompt:secretText,context:null,expectedBehavior:"answer four"}];
const hasCode=(code,status)=>error=>
 error?.code===code&&(status===undefined||error.status===status);
const orgIds=[];
async function tenant(label){
 const [org]=await sql`insert into organizations(slug,display_name)
  values(${"daily-quota-"+label+"-"+suffix},${"Daily quota "+label}) returning id`;
 orgIds.push(org.id);
 const skillId="quota-"+label+"-"+suffix;
 const [repo]=await sql`insert into repositories(
  organization_id,provider_type,owner_name,repo_name,default_branch
 ) values (${org.id},'github',${"quota-"+label},${"repo-"+suffix},'main') returning id`;
 await sql`insert into indexed_skills(
   organization_id,repository_id,skill_id,display_name,tier,status,
   source_path,source_commit_sha,content_hash
 ) values(${org.id},${repo.id},${skillId},'Daily quota skill','tier1','active',
  ${"skills/"+skillId},${sha},'hash')`;
 const actor={organizationId:org.id,subject:"owner-"+label,role:"admin"};
 const definition=(await definitions.create(actor,skillId,{
  name:"Saved daily quota cases",cases:caseSet,requestId:randomUUID(),
 })).definition;
 return {id:org.id,repoId:repo.id,actor,skillId,definition};
}
try{
 const a=await tenant("a"),b=await tenant("b");
 const first=await store.quota(a.actor);
 assert.equal(first.dailyRunLimit,10);
 assert.equal(first.remainingRuns,10);
 assert.equal(first.reservedNormalizedTokens,0);
 assert.equal(first.remainingNormalizedTokens,120000);
 assert.equal(first.accounting,"normalized-admission-reservation");
 assert.equal(first.releasesOnCancel,false);
 assert.equal(Date.parse(first.resetAtUtc)-Date.parse(first.utcDay+"T00:00:00.000Z"),86400000);
 assert.deepEqual((await store.quota(b.actor)).remainingRuns,10);

 // Save and queue rollback are a single SQL transaction. A rejected TX
 // cannot consume even one admission unit or create a ghost job.
 await assert.rejects(()=>sql.begin(async tx=>{
   await reserveDailyAdmission(tx,a.id);
   throw Error("FORCED_ROLLBACK_NO_QUOTA_LEAK");
 }),/FORCED_ROLLBACK_NO_QUOTA_LEAK/);
 assert.equal((await store.quota(a.actor)).admittedRuns,0);
 await assert.rejects(()=>store.start(a.actor,a.skillId,a.definition.id,{
   expectedRevision:2,requestId:randomUUID(),
 }),hasCode("test_bench_revision_conflict"));
 assert.equal((await store.quota(a.actor)).admittedRuns,0);

 const requestId=randomUUID();
 const firstRun=(await store.start(a.actor,a.skillId,a.definition.id,{
   requestId,expectedRevision:1,executionSource:"platform-nim",
 })).run;
 const replay=await store.start(a.actor,a.skillId,a.definition.id,{
   requestId,expectedRevision:1,executionSource:"platform-nim",
 });
 assert.equal(replay.replayed,true);
 assert.equal(replay.run.id,firstRun.id);
 assert.equal((await store.quota(a.actor)).admittedRuns,1);
 await store.cancel(a.actor,a.skillId,a.definition.id,firstRun.id,1);
 assert.equal((await store.quota(a.actor)).admittedRuns,1,
   "canceled provider work cannot be refunded in the conservative quota");

 // Ten simultaneous admissions across separate PG connections cannot create
 // more than the existing two-active limit OR leak additional reservations.
 const concurrent=await Promise.allSettled(Array.from({length:12},()=>store.start(
   a.actor,a.skillId,a.definition.id,
   {requestId:randomUUID(),expectedRevision:1,executionSource:"platform-nim"},
 )));
 const successes=concurrent.filter(x=>x.status==="fulfilled").map(x=>x.value.run);
 assert.equal(successes.length,2);
 assert.equal(concurrent.filter(x=>x.status==="rejected").length,10);
 assert.equal((await store.quota(a.actor)).admittedRuns,3);
 assert.equal((await store.quota(a.actor)).reservedNormalizedTokens,36000);
 for(const run of successes)
   await store.cancel(a.actor,a.skillId,a.definition.id,run.id,1);

 // Fill the rest with terminal runs. No cancellation, failure, or repeated
 // admission can sneak through once the daily limit is reached.
 for(let admitted=3;admitted<10;admitted++){
   const {run}=await store.start(a.actor,a.skillId,a.definition.id,{
     requestId:randomUUID(),expectedRevision:1,executionSource:"platform-nim",
   });
   await store.cancel(a.actor,a.skillId,a.definition.id,run.id,1);
 }
 const full=await store.quota(a.actor);
 assert.equal(full.admittedRuns,10);
 assert.equal(full.remainingRuns,0);
 assert.equal(full.reservedNormalizedTokens,120000);
 assert.equal(full.remainingNormalizedTokens,0);
 await assert.rejects(()=>store.start(a.actor,a.skillId,a.definition.id,{
   requestId:randomUUID(),expectedRevision:1,executionSource:"platform-nim",
 }),hasCode("test_bench_daily_quota_exceeded",429));
 const fullReplay=await store.start(a.actor,a.skillId,a.definition.id,{
   requestId,expectedRevision:1,executionSource:"platform-nim",
 });
 assert.equal(fullReplay.replayed,true);
 assert.equal(fullReplay.run.id,firstRun.id);
 assert.equal((await store.quota(a.actor)).admittedRuns,10);

 // The limit is genuinely per-tenant. A foreign actor cannot reserve against
 // or inspect tenant A, and tenant B's first admission remains available.
 assert.equal((await store.quota(b.actor)).admittedRuns,0);
 await assert.rejects(()=>store.start(b.actor,a.skillId,a.definition.id,{
   requestId:randomUUID(),expectedRevision:1,
 }),hasCode("test_bench_not_found",404));
 assert.equal((await store.quota(b.actor)).admittedRuns,0);
 await assert.rejects(()=>store.start({
   ...a.actor,subject:"unprivileged-member",role:"member",
 },a.skillId,a.definition.id,{requestId:randomUUID(),expectedRevision:1}));
 assert.equal((await store.quota(a.actor)).admittedRuns,10);
 const isolated=await store.start(b.actor,b.skillId,b.definition.id,{
   requestId:randomUUID(),expectedRevision:1,executionSource:"platform-nim",
 });
 assert.equal(isolated.run.status,"queued");
 assert.equal((await store.quota(b.actor)).admittedRuns,1);
 await store.cancel(b.actor,b.skillId,b.definition.id,isolated.run.id,1);

 // Raw SQL cannot modify a quota row into an over-limit or inconsistent
 // state, regardless of application checks.
 await assert.rejects(()=>sql`
   update test_bench_daily_admissions set admitted_runs=11,
     reserved_normalized_tokens=132000 where organization_id=${a.id}
 `,error=>error?.code==="23514");
 await assert.rejects(()=>sql`
   update test_bench_daily_admissions set admitted_runs=10,
     reserved_normalized_tokens=0 where organization_id=${a.id}
 `,error=>error?.code==="23514");
 const [ledger]=await sql`select admitted_runs,reserved_normalized_tokens
   from test_bench_daily_admissions where organization_id=${a.id}`;
 assert.equal(ledger.admitted_runs,10);
 assert.equal(ledger.reserved_normalized_tokens,120000);

 const [runCount]=await sql`select count(*)::int as n from test_bench_runs
   where organization_id=${a.id}`;
 assert.equal(runCount.n,10);
 const [jobCount]=await sql`select count(*)::int as n from background_jobs
   where organization_id=${a.id} and kind='test_bench_run'`;
 assert.equal(jobCount.n,10);
 const events=JSON.stringify(await sql`select action,payload_redacted
   from audit_events where organization_id=${a.id} and target_type='test_bench_run'`);
 const queued=JSON.stringify(await sql`select payload from background_jobs
   where organization_id=${a.id} and kind='test_bench_run'`);
 for(const contents of [events,queued]){
   assert.ok(!contents.includes(secretText),"case prompts must not leak into audit or jobs");
   assert.ok(!contents.includes("sk-PRIVATE"),"provider keys must not leak");
 }
 console.log(JSON.stringify({tenantDailyAdmission:"passed",checks:[
  "database UTC day and fixed normalized reservation contract",
  "failed transaction and rejected source never reserve",
  "idempotent replay consumes no additional units",
  "12-way concurrency obeys 2 active and exact reservations",
  "10 terminal runs exhausted 120000 normalized units",
  "eleventh refused HTTP 429; replay at full cap succeeds",
  "cancel does not refund uncertain provider side effects",
  "cross-tenant and nonwriter requests cannot allocate against victim",
  "DB check constraints refuse overdraw/inconsistent ledger",
  "no plaintext cases or credentials in queue/audit",
 ]}));
}finally{
 for(const id of orgIds)await sql`delete from organizations where id=${id}`;
 await sql.end({timeout:5});
}
