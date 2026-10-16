import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {
 plannedMicroUsd,assertMonetaryExecutionAuthorized,
} from "../src/server/test-bench/monetary-admission.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_MONETARY_ADMISSION_TEST!=="1"||
 process.env.SAVANT_MONETARY_EPHEMERAL_DATABASE!=="1"||
 process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||
 !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
 throw Error("PER-1545 demands explicit ephemeral loopback PostgreSQL fixture approval");
// This creates a deliberately immutable approved rate fixture. Never run on a
// shared database; the ephemeral CI database is destroyed with the job.
process.env.TEST_BENCH_ENCRYPTION_KEY="27".repeat(32);
process.env.NVIDIA_NIM_API_KEY="DUMMY_CI_NONPRODUCTION_ONLY";
process.env.JEV_API_KEY="DUMMY_CI_NONPRODUCTION_ONLY";
process.env.NIM_EXECUTION_MODEL="nim-monetary-fixture";
process.env.JEV_MODEL="jev-monetary-fixture";
process.env.SAVANT_TEST_BENCH_MONETARY_ENFORCE="1";
const sql=postgres(uri,{max:16,prepare:false});
const definitions=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const suffix=randomUUID().slice(0,8);
const id=randomUUID();
const organizations=[];
const hasCode=code=>e=>e?.code===code;
const rates=[
 {provider_code:"nim",model:"nim-monetary-fixture",
  input_micro_usd_per_million:150000,output_micro_usd_per_million:600000,
  fixed_micro_usd_per_call:25},
 {provider_code:"jev",model:"jev-monetary-fixture",
  input_micro_usd_per_million:300000,output_micro_usd_per_million:900000,
  fixed_micro_usd_per_call:70},
];
const reserve=rates.reduce((sum,r)=>sum+plannedMicroUsd(r,1),0);
async function tenant(label){
 const [org]=await sql`insert into organizations(slug,display_name)
  values(${"monetary-"+label+"-"+suffix},${"Monetary "+label}) returning id`;
 organizations.push(org.id);
 const [repo]=await sql`insert into repositories(
  organization_id,provider_type,owner_name,repo_name,default_branch)
  values(${org.id},'github',${"monetary-"+label},${"fixture-"+suffix},'main')
  returning id`;
 const skillId="monetary-"+label+"-"+suffix;
 await sql`insert into indexed_skills(
  organization_id,repository_id,skill_id,display_name,tier,status,
  source_path,source_commit_sha,content_hash
 ) values(${org.id},${repo.id},${skillId},'Monetary fixture',
  'tier1','active',${"skills/"+skillId},${"a".repeat(40)},'hash')`;
 const actor={organizationId:org.id,subject:"admin-"+label,role:"admin"};
 const suite=(await definitions.create(actor,skillId,{
  name:"Conservative cost fixture",requestId:randomUUID(),
  cases:[{caseId:"cost",kind:"positive",prompt:"PRIVATE_MONETARY_TEST_PROMPT",
   context:null,expectedBehavior:"4"}],
 })).definition;
 return {id:org.id,actor,skillId,suite};
}
const start=(t,requestId=randomUUID())=>runs.start(
 t.actor,t.skillId,t.suite.id,{requestId,expectedRevision:1,executionSource:"platform-nim"});
const dayCount=async org=>{
 const [row]=await sql`select coalesce(sum(reserved_micro_usd),0)::bigint as n
   from test_bench_tenant_monetary_days
   where organization_id=${org} and utc_day=(now() at time zone 'UTC')::date`;
 return Number(row.n);
};
const monthCount=async org=>{
 const [row]=await sql`select coalesce(sum(reserved_micro_usd),0)::bigint as n
   from test_bench_tenant_monetary_months
   where organization_id=${org}
     and utc_month=date_trunc('month',now() at time zone 'UTC')::date`;
 return Number(row.n);
};
const noAcceptedRun=async org=>{
 const [r]=await sql`select count(*)::int as n from test_bench_runs
   where organization_id=${org}`;
 assert.equal(r.n,0);
 const [q]=await sql`select count(*)::int as n from background_jobs
   where organization_id=${org} and kind='test_bench_run'`;
 assert.equal(q.n,0);
 assert.equal(await dayCount(org),0);
 assert.equal(await monthCount(org),0);
};
try{
 const a=await tenant("a"),b=await tenant("b");
 // 1: no rate cards exist, denial precedes every queued job or quota.
 await assert.rejects(()=>start(a),hasCode("test_bench_rate_unavailable"));
 await noAcceptedRun(a);
 await sql`insert into test_bench_provider_rate_cards(
   id,version,status,source_uri,source_sha256,valid_from)
  values(${id},${"ci-only-"+suffix},'draft',
  'https://example.invalid/pricing/ci-only',${"c".repeat(64)},now()-interval '1 day')`;
 for(const rate of rates)
  await sql`insert into test_bench_provider_rate_entries(
    rate_card_id,provider_code,model,input_micro_usd_per_million,
    output_micro_usd_per_million,fixed_micro_usd_per_call
  ) values(${id},${rate.provider_code},${rate.model},
    ${rate.input_micro_usd_per_million},${rate.output_micro_usd_per_million},
    ${rate.fixed_micro_usd_per_call})`;
 await assert.rejects(()=>start(a),hasCode("test_bench_rate_unavailable"));
 await noAcceptedRun(a);
 await sql`update test_bench_provider_rate_cards set
   status='approved',active=true,approved_by='ci-isolated-fixture',approved_at=now()
   where id=${id}`;
 await assert.rejects(()=>start(a),hasCode("test_bench_monetary_entitlement_unavailable"));
 await noAcceptedRun(a);
 // Approved rates cannot be edited, backfilled or removed.
 await assert.rejects(()=>sql`update test_bench_provider_rate_entries
   set input_micro_usd_per_million=1 where rate_card_id=${id}`,
   e=>e?.code==="P0001");
 await assert.rejects(()=>sql`update test_bench_provider_rate_cards
   set source_sha256=${"d".repeat(64)} where id=${id}`,e=>e?.code==="P0001");
 await assert.rejects(()=>sql`insert into test_bench_provider_rate_entries(
    rate_card_id,provider_code,model,input_micro_usd_per_million,
    output_micro_usd_per_million,fixed_micro_usd_per_call
   ) values(${id},'openai','unexpected',1,1,0)`,e=>e?.code==="P0001");
 await assert.rejects(()=>sql`insert into test_bench_provider_rate_cards(
   id,version,status,active,source_uri,source_sha256,valid_from,approved_by,approved_at)
  values(${randomUUID()},'second-active',
    'approved',true,'https://example.invalid/rates',${"b".repeat(64)},
    now()-interval '1 day','forged',now())`,e=>e?.code==="23505");
 // Per-tenant scope: only one run allowed for A. Twelve contenders
 // share one remaining *monetary* reservation, without double spending.
 await sql`insert into test_bench_tenant_monetary_policies(
   organization_id,enabled,daily_limit_micro_usd,monthly_limit_micro_usd)
   values(${a.id},true,${reserve},${reserve})`;
 const requestIds=Array.from({length:12},()=>randomUUID());
 const attempts=await Promise.allSettled(requestIds.map(req=>start(a,req)));
 const winners=attempts.map((v,i)=>({v,req:requestIds[i]}))
  .filter(x=>x.v.status==="fulfilled");
 assert.equal(winners.length,1);
 assert.ok(attempts.filter(x=>x.status==="rejected").every(x=>
  hasCode("test_bench_monetary_capacity_exceeded")(x.reason)));
 const accepted=winners[0].v.value;
 assert.equal(accepted.run.rateCardId,id);
 assert.equal(accepted.run.monetaryReservationMicroUsd,reserve);
 assert.equal(await dayCount(a.id),reserve);
 assert.equal(await monthCount(a.id),reserve);
 assert.equal((await runs.quota(a.actor)).admittedRuns,1);
 const replay=await start(a,winners[0].req);
 assert.equal(replay.replayed,true);assert.equal(replay.run.id,accepted.run.id);
 assert.equal(await dayCount(a.id),reserve);
 assert.equal(await monthCount(a.id),reserve);
 await runs.cancel(a.actor,a.skillId,a.suite.id,accepted.run.id,1);
 assert.equal(await dayCount(a.id),reserve,"cancellation cannot refund unknown charges");
 await assert.rejects(()=>start(a),hasCode("test_bench_monetary_capacity_exceeded"));
 // Other tenant has no policy and cannot spend from A or consume its ledger.
 await assert.rejects(()=>start(b),hasCode("test_bench_monetary_entitlement_unavailable"));
 await noAcceptedRun(b);
 await sql`insert into test_bench_tenant_monetary_policies(
   organization_id,enabled,daily_limit_micro_usd,monthly_limit_micro_usd)
   values(${b.id},true,${reserve*2},${reserve*2})`;
 const bRun=await start(b);
 assert.equal(bRun.run.monetaryReservationMicroUsd,reserve);
 assert.equal(await dayCount(a.id),reserve);
 assert.equal(await dayCount(b.id),reserve);
 // Monthly exhaustion rolls back an otherwise valid daily reservation.
 await sql`update test_bench_tenant_monetary_months
  set reserved_micro_usd=${reserve*2}
  where organization_id=${b.id}
    and utc_month=date_trunc('month',now() at time zone 'UTC')::date`;
 await assert.rejects(()=>start(b),hasCode("test_bench_monetary_capacity_exceeded"));
 assert.equal(await dayCount(b.id),reserve);
 assert.equal(await monthCount(b.id),reserve*2);
 assert.equal((await runs.quota(b.actor)).admittedRuns,1);
 // Operator revocation, model drift or missing policy blocks execution.
 const [saved]=await sql`select organization_id,rate_card_id,reserved_micro_usd,
  execution_model_pinned,judge_model_pinned,execution_source
  from test_bench_runs where id=${bRun.run.id}`;
 await assertMonetaryExecutionAuthorized(sql,saved);
 await assert.rejects(()=>assertMonetaryExecutionAuthorized(sql,saved,{
  NVIDIA_NIM_API_KEY:"test",JEV_API_KEY:"test",
  NIM_EXECUTION_MODEL:"changed",JEV_MODEL:"jev-monetary-fixture",
  SAVANT_TEST_BENCH_MONETARY_ENFORCE:"1",
 }),hasCode("test_bench_monetary_model_changed"));
 await sql`update test_bench_tenant_monetary_policies set enabled=false
  where organization_id=${b.id}`;
 await assert.rejects(()=>assertMonetaryExecutionAuthorized(sql,saved),
  hasCode("test_bench_monetary_entitlement_revoked"));
 // Guard physical DB invariants independent of TS math.
 await assert.rejects(()=>sql`update test_bench_tenant_monetary_days
  set reserved_micro_usd=-1 where organization_id=${a.id}`,
  e=>e?.code==="23514");
 await assert.rejects(()=>sql`update test_bench_tenant_monetary_policies
  set monthly_limit_micro_usd=0 where organization_id=${a.id}`,
  e=>e?.code==="23514");
 await assert.rejects(()=>sql`update test_bench_runs
  set reserved_micro_usd=0 where id=${bRun.run.id}`,e=>e?.code==="23514");
 // Price versions rotate without mutating old contracts or invalidating the
 // price pinned on an already admitted run.
 const successor=randomUUID();
 await sql`insert into test_bench_provider_rate_cards(
   id,version,status,source_uri,source_sha256,valid_from
 ) values (${successor},${"ci-successor-"+suffix},'draft',
   'https://example.invalid/pricing/ci-successor',${"e".repeat(64)},
   now()-interval '1 hour')`;
 for(const rate of rates)
   await sql`insert into test_bench_provider_rate_entries(
    rate_card_id,provider_code,model,input_micro_usd_per_million,
    output_micro_usd_per_million,fixed_micro_usd_per_call
   ) values(${successor},${rate.provider_code},${rate.model},
     ${rate.input_micro_usd_per_million},${rate.output_micro_usd_per_million},
     ${rate.fixed_micro_usd_per_call})`;
 await sql`update test_bench_provider_rate_cards set
   status='approved',approved_by='ci-successor-review',approved_at=now()
   where id=${successor}`;
 await sql.begin(async tx=>{
   await tx`update test_bench_provider_rate_cards set active=false where id=${id}`;
   await tx`update test_bench_provider_rate_cards set active=true where id=${successor}`;
 });
 const [active]=await sql`select id from test_bench_provider_rate_cards
   where active=true and status='approved'`;
 assert.equal(active.id,successor);
 await sql`update test_bench_tenant_monetary_policies set enabled=true
  where organization_id=${b.id}`;
 await assertMonetaryExecutionAuthorized(sql,saved);
 const [original]=await sql`select status,active from test_bench_provider_rate_cards
    where id=${id}`;
 assert.equal(original.status,"approved");
 assert.equal(original.active,false);
 const metadata=JSON.stringify(await sql`select organization_id,reserved_micro_usd
   from test_bench_tenant_monetary_days where organization_id in (${a.id},${b.id})`)+
  JSON.stringify(await sql`select payload_redacted from audit_events
   where organization_id in (${a.id},${b.id})`);
 for(const leak of ["PRIVATE_MONETARY_TEST_PROMPT","DUMMY_CI_NONPRODUCTION_ONLY"])
  assert.ok(!metadata.includes(leak),"no secrets/prompts in budget/audit");
 console.log(JSON.stringify({monetaryAdmission:"passed",tests:[
  "no active card/draft/unentitled actor fails before a run or quota",
  "approved card immutable, single active contract and historical rate rotation",
  "12 concurrent one-slot admissions have exactly one winner",
  "idempotent replay and no-refund cancellation",
  "tenant budgets isolated and month rejection rolls back day budget",
  "revocation and model drift prevent paid egress",
  "DB integrity and metadata-only audit",
 ]}));
}finally{
 // The approved fake rate contract is deliberately immutable. This script
 // MUST run only in the disposable CI database, never in a shared instance.
 for(const org of organizations)
  await sql`delete from organizations where id=${org}`;
 await sql.end({timeout:5});
}
