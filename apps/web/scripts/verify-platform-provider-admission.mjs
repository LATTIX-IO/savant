import assert from "node:assert/strict";
import postgres from "postgres";
import {reservePlatformProviderAdmission} from "../src/server/test-bench/platform-provider-admission.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_GLOBAL_PROVIDER_ADMISSION_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("PER-1452 requires isolated loopback PostgreSQL and explicit opt-in");
const sql=postgres(uri,{max:16,prepare:false});
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

  // Saturate NIM, leaving Jev available: NIM denial must rollback Jev.
  await sql`insert into test_bench_platform_provider_daily_admissions
    (provider_code,utc_day,admitted_runs,reserved_normalized_tokens)
    values('nim',${now.day},100,1200000)
    on conflict(provider_code,utc_day) do update set
    admitted_runs=100,reserved_normalized_tokens=1200000`;
  const beforeRejectedJev=await total("jev");
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
  console.log("PER-1452 PASS: rollback, BYO isolation, NIM/Jev atomicity, "+
    "12-way one-slot race, 429, constraints, metadata-only ledger");
}finally{
  // This script runs against an isolated CI database. Clean up today's rows.
  await sql`delete from test_bench_platform_provider_daily_admissions
    where utc_day=(now() at time zone 'UTC')::date`;
  await sql.end();
}
