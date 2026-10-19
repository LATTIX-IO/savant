import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import postgres from "postgres";
import {reservePlatformProviderAdmission} from "../src/server/test-bench/platform-provider-admission.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_GLOBAL_PROVIDER_ADMISSION_TEST!=="1"||
  process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("PER-1452 requires isolated loopback PostgreSQL and explicit opt-in");
process.env.TEST_BENCH_ENCRYPTION_KEY="23".repeat(32);
const sql=postgres(uri,{max:16,prepare:false});
const definitions=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const createdOrganizations=[];
let originalRows=[];
const today=()=>sql`select (now() at time zone 'UTC')::date as day`;
const total=async(provider)=> {
  const [r]=await sql`
    select admitted_runs::int as n
    from test_bench_platform_provider_daily_admissions
    where provider_code=${provider} and utc_day=(now() at time zone 'UTC')::date
  `;
  return r?.n??0;
};
const denied=e=>e?.code==="test_bench_platform_capacity_exceeded"&&e?.status===429;
try{
  const [now]=await today();
  originalRows=await sql`select provider_code,admitted_runs,reserved_normalized_tokens
    from test_bench_platform_provider_daily_admissions
    where utc_day=${now.day}`;
  const initialJev=await total("jev"),initialNim=await total("nim");
  // Rollback must preserve both shared ledgers even after both writes.
  await assert.rejects(()=>sql.begin(async tx=>{
    await reservePlatformProviderAdmission(tx,"platform-nim");
    throw Error("INTENTIONAL_ROLLBACK");
  }),/INTENTIONAL_ROLLBACK/);
  assert.equal(await total("jev"),initialJev);
  assert.equal(await total("nim"),initialNim);

  await sql.begin(tx=>reservePlatformProviderAdmission(tx,"workspace-openai"));
  assert.equal(await total("jev"),initialJev+1);
  assert.equal(await total("nim"),initialNim,"BYO OpenAI may never reserve platform NIM");

  // Exercise the public run admission path, not just its reservation helper.
  // The durable run, tenant quota, global quota and background job are one TX.
  const suffix=randomUUID().slice(0,8);
  async function tenant(label){
    const [org]=await sql`insert into organizations(slug,display_name)
      values(${"global-admission-"+label+"-"+suffix},${"Global Admission "+label}) returning id`;
    createdOrganizations.push(org.id);
    const skillId="global-cap-"+label+"-"+suffix;
    const [repo]=await sql`insert into repositories(
      organization_id,provider_type,owner_name,repo_name,default_branch)
      values(${org.id},'github',${"global-"+label},${"repo-"+suffix},'main') returning id`;
    await sql`insert into indexed_skills(organization_id,repository_id,skill_id,
      display_name,tier,status,source_path,source_commit_sha,content_hash)
      values(${org.id},${repo.id},${skillId},'Global cap skill','tier1',
        'active',${"skills/"+skillId},${"a".repeat(40)},'hash')`;
    const actor={organizationId:org.id,subject:"owner-"+label,role:"admin"};
    const definition=(await definitions.create(actor,skillId,{
      name:"Shared provider quota",
      cases:[{caseId:"q1",kind:"positive",prompt:"PRIVATE_GLOBAL_QUOTA_CASE",
        context:null,expectedBehavior:"answer safely"}],
      requestId:randomUUID(),
    })).definition;
    return {actor,skillId,definition,organizationId:org.id};
  }
  const a=await tenant("a"),b=await tenant("b");
  const accepted=[];
  for(const entry of [a,b]){
    const requestId=randomUUID();
    const first=await runs.start(entry.actor,entry.skillId,entry.definition.id,{
      expectedRevision:1,requestId,executionSource:"platform-nim",
    });
    assert.equal(first.replayed,false);
    accepted.push({entry,run:first.run,requestId});
    const replay=await runs.start(entry.actor,entry.skillId,entry.definition.id,{
      expectedRevision:1,requestId,executionSource:"platform-nim",
    });
    assert.equal(replay.replayed,true);
    assert.equal(replay.run.id,first.run.id);
    assert.equal((await runs.quota(entry.actor)).admittedRuns,1);
    await runs.cancel(entry.actor,entry.skillId,entry.definition.id,first.run.id,1);
  }
  assert.equal(await total("jev"),initialJev+3);
  assert.equal(await total("nim"),initialNim+2);

  // Saturate NIM, leaving Jev available: NIM denial must rollback Jev.
  await sql`insert into test_bench_platform_provider_daily_admissions
    (provider_code,utc_day,admitted_runs,reserved_normalized_tokens)
    values('nim',${now.day},100,1200000)
    on conflict(provider_code,utc_day) do update set
    admitted_runs=100,reserved_normalized_tokens=1200000`;
  const beforeRejectedJev=await total("jev");
  const [beforeRunCount]=await sql`select count(*)::int as n
    from test_bench_runs where organization_id=${a.organizationId}`;
  const [beforeJobCount]=await sql`select count(*)::int as n
    from background_jobs where organization_id=${a.organizationId}
      and kind='test_bench_run'`;
  await assert.rejects(()=>runs.start(a.actor,a.skillId,a.definition.id,{
    expectedRevision:1,requestId:randomUUID(),executionSource:"platform-nim",
  }),denied);
  assert.equal((await runs.quota(a.actor)).admittedRuns,1);
  const [afterRunCount]=await sql`select count(*)::int as n
    from test_bench_runs where organization_id=${a.organizationId}`;
  const [afterJobCount]=await sql`select count(*)::int as n
    from background_jobs where organization_id=${a.organizationId}
      and kind='test_bench_run'`;
  assert.equal(afterRunCount.n,beforeRunCount.n,"capacity refusal cannot create run");
  assert.equal(afterJobCount.n,beforeJobCount.n,"capacity refusal cannot create job");
  await assert.rejects(()=>sql.begin(tx=>
    reservePlatformProviderAdmission(tx,"platform-nim")),denied);
  assert.equal(await total("jev"),beforeRejectedJev);
  assert.equal(await total("nim"),100);

  // Restore a single NIM slot; cross-connection contenders have one winner.
  await sql`update test_bench_platform_provider_daily_admissions
    set admitted_runs=99,reserved_normalized_tokens=1188000
    where provider_code='nim' and utc_day=${now.day}`;
  const attempts=await Promise.allSettled(Array.from({length:12},
    ()=>sql.begin(tx=>reservePlatformProviderAdmission(tx,"platform-nim"))));
  assert.equal(attempts.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(attempts.filter(x=>x.status==="rejected").length,11);
  assert.ok(attempts.filter(x=>x.status==="rejected").every(x=>denied(x.reason)));
  assert.equal(await total("nim"),100);
  assert.equal(await total("jev"),beforeRejectedJev+1);

  // SQL invariants reject tampering regardless of application assertions.
  await assert.rejects(()=>sql`update test_bench_platform_provider_daily_admissions
    set admitted_runs=101,reserved_normalized_tokens=1212000
    where provider_code='nim' and utc_day=${now.day}`,e=>e?.code==="23514");
  await assert.rejects(()=>sql`update test_bench_platform_provider_daily_admissions
    set admitted_runs=100,reserved_normalized_tokens=0
    where provider_code='nim' and utc_day=${now.day}`,e=>e?.code==="23514");
  await assert.rejects(()=>sql`insert into test_bench_platform_provider_daily_admissions
    (provider_code,utc_day,admitted_runs,reserved_normalized_tokens)
    values('openai',${now.day},1,12000)`,e=>e?.code==="23514");
  await assert.rejects(()=>sql`update test_bench_platform_provider_daily_admissions
    set admitted_runs=-1,reserved_normalized_tokens=-12000
    where provider_code='nim' and utc_day=${now.day}`,e=>e?.code==="23514");
  const [jev]=await sql`select * from test_bench_platform_provider_daily_admissions
    where provider_code='jev' and utc_day=${now.day}`;
  assert.ok(jev);
  assert.deepEqual(Object.keys(jev).sort(),["admitted_runs","provider_code",
    "reserved_normalized_tokens","updated_at","utc_day"].sort());
  // Exhausted judge capacity blocks BYO as well, without consuming NIM units.
  await sql`update test_bench_platform_provider_daily_admissions
    set admitted_runs=200,reserved_normalized_tokens=2400000
    where provider_code='jev' and utc_day=${now.day}`;
  await assert.rejects(()=>sql.begin(tx=>
    reservePlatformProviderAdmission(tx,"workspace-openai")),denied);
  assert.equal(await total("nim"),100);
  assert.equal(await total("jev"),200);
  console.log("PER-1452 PASS: global+tenant+job atomic admission, replay, "+
    "BYO isolation, NIM/Jev refusal, 12-way race, 429, SQL constraints and secrecy");
}finally{
  // CI-only fixture: remove only fixture tenants, restore earlier ledger
  // counters from previous regression suites instead of erasing their data.
  // The extra SAVANT_WORKFLOW_SCHEMA_TEST guard forbids incidental use.
  try{
    for(const orgId of createdOrganizations)
      await sql`delete from organizations where id=${orgId}`;
    await sql`delete from test_bench_platform_provider_daily_admissions
      where utc_day=(now() at time zone 'UTC')::date`;
    for(const original of originalRows)
      await sql`insert into test_bench_platform_provider_daily_admissions(
        provider_code,utc_day,admitted_runs,reserved_normalized_tokens
      ) values(${original.provider_code},(now() at time zone 'UTC')::date,
        ${original.admitted_runs},${original.reserved_normalized_tokens})`;
  }finally{await sql.end();}
}
