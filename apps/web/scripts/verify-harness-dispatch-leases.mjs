import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { createHarnessReservationStore } from "../src/server/harness/invocation-reservations.ts";
import { createHarnessDispatchLeaseQueue, HarnessDispatchError } from "../src/server/harness/dispatch-leases.ts";
const url=process.env.DATABASE_URL;
if(!url || process.env.SAVANT_HARNESS_SCHEMA_TEST!=="1" ||
  !["localhost","127.0.0.1","::1"].includes(new URL(url).hostname))
  throw Error("Isolated local PostgreSQL opt-in is required.");
const sql=postgres(url,{max:12,prepare:false});
const id=randomUUID().slice(0,8);
const now={at:new Date("2026-10-12T12:00:00.000Z")};
let tenant=null,foreign=null;
const caps={
  protocol:{major:1,minor:0},adapterId:"sandbox-adapter",
  features:{execute:true,observe:true,cancel:true,events:true},
  coverage:{execution:"partial",observation:"partial"},
  limits:{maxConcurrency:4,maxDurationMs:60000,maxCostUsd:1},
};
function request(tenantId,runId){
  return {tenantId,adapterId:"sandbox-adapter",actor:"test-operator",runId,
    traceId:"trace-"+runId,idempotencyKey:"idem-"+runId,
    specVersionHash:"a".repeat(64),testSuiteHash:"b".repeat(64),
    inputRef:"fixture-golden",budget:{maxDurationMs:60000,maxCostUsd:0.25},
    capture:{level:"metadata",retentionDays:7,residency:"us-east-1"},
  };
}
async function denied(code,fn){
  await assert.rejects(fn,e=>e instanceof HarnessDispatchError&&e.code===code);
}
try{
  const [first]=await sql`insert into organizations(slug,display_name)
    values(${"lease-a-"+id},'Lease A') returning id`;
  const [second]=await sql`insert into organizations(slug,display_name)
    values(${"lease-b-"+id},'Lease B') returning id`;
  tenant=first.id;foreign=second.id;
  const store=createHarnessReservationStore({
    sql,now:()=>now.at,limits:{maxActive:6,maxReservedCostUsd:2},
  });
  for(const runId of ["run-one","run-two","run-canceled"]){
    await store.reserve({organizationId:tenant,actorSubject:"test-operator",
      request:request(tenant,runId),capabilities:caps});
  }
  await store.requestCancel(tenant,"run-canceled");
  const allowed=new Set(["worker-1","worker-2","worker-3"]);
  const queue=()=>createHarnessDispatchLeaseQueue({
    sql,now:()=>now.at,
    authorizeWorker:async({tenantId,adapterId,workerId})=>
      tenantId===tenant&&adapterId==="sandbox-adapter"&&allowed.has(workerId),
  });
  const q1=queue(),q2=queue();
  const ident=(workerId,tenantId=tenant)=>({tenantId,adapterId:"sandbox-adapter",workerId});
  await denied("unauthorized",()=>q1.claim(ident("untrusted")));
  await denied("unauthorized",()=>q1.claim(ident("worker-1",foreign)));
  // Parallel claims against independent stores must never dispatch one job twice.
  const [claimA,claimB]=await Promise.all([
    q1.claim(ident("worker-1"),1500),q2.claim(ident("worker-2"),1500),
  ]);
  assert.ok(claimA&&claimB);
  assert.notEqual(claimA.runId,claimB.runId);
  assert.deepEqual(new Set([claimA.runId,claimB.runId]),new Set(["run-one","run-two"]));
  assert.equal(claimA.attempt,1);assert.equal(claimB.attempt,1);
  assert.equal(claimA.generation,1);assert.equal(claimB.generation,1);
  assert.equal(claimA.leaseToken.length,64);
  assert.equal(claimA.idempotencyKey,"idem-"+claimA.runId);
  assert.equal(await q1.claim(ident("worker-1"),500),null);
  await denied("lease_denied",()=>q2.acknowledge(ident("worker-2"),claimA.runId,claimA.leaseToken,"forged"));
  await denied("lease_denied",()=>q1.acknowledge(ident("worker-1"),claimA.runId,"0".repeat(64),"forged"));
  assert.equal((await q1.renew(ident("worker-1"),claimA.runId,claimA.leaseToken,1500)).generation,1);

  const retry=await q2.releaseForRetry(ident("worker-2"),claimB.runId,claimB.leaseToken,300);
  assert.equal(retry.state,"retry");
  await denied("lease_denied",()=>q2.acknowledge(ident("worker-2"),claimB.runId,claimB.leaseToken,"late"));
  now.at=new Date(now.at.getTime()+200);
  assert.equal(await queue().claim(ident("worker-3"),500),null,"backoff must hold");
  now.at=new Date(now.at.getTime()+150);
  const claimRetry=await queue().claim(ident("worker-3"),500);
  assert.equal(claimRetry.runId,claimB.runId);
  assert.equal(claimRetry.attempt,2);
  assert.equal(claimRetry.generation,2);
  assert.notEqual(claimRetry.leaseToken,claimB.leaseToken);
  await denied("lease_denied",()=>q2.acknowledge(ident("worker-2"),claimB.runId,claimB.leaseToken,"stale"));
  await queue().markDispatchStarted(ident("worker-3"),claimRetry.runId,claimRetry.leaseToken);
  await q1.markDispatchStarted(ident("worker-1"),claimA.runId,claimA.leaseToken);
  assert.equal((await queue().acknowledge(ident("worker-3"),claimRetry.runId,
    claimRetry.leaseToken,"provider-retry")).status,"running");
  assert.equal((await q1.acknowledge(ident("worker-1"),claimA.runId,
    claimA.leaseToken,"provider-first")).status,"running");
  await denied("lease_denied",()=>q1.acknowledge(ident("worker-1"),claimA.runId,
    claimA.leaseToken,"duplicate"));
  assert.equal((await store.getRun(tenant,claimB.runId)).status,"running");

  await store.reserve({organizationId:tenant,actorSubject:"test-operator",
    request:request(tenant,"run-crashed"),capabilities:caps});
  const dying=await q1.claim(ident("worker-1"),500);
  assert.equal(dying.runId,"run-crashed");
  const hexHash=createHash("sha256").update(dying.leaseToken).digest("hex");
  const rows=await sql`select lease_token_sha256 from harness_eval_dispatch_leases
    where organization_id=${tenant} and harness_run_id=(
      select id from harness_eval_runs where organization_id=${tenant} and run_id='run-crashed')`;
  assert.equal(rows[0].lease_token_sha256,hexHash);
  assert.notEqual(rows[0].lease_token_sha256,dying.leaseToken);
  now.at=new Date(now.at.getTime()+550);
  const recovered=await q2.claim(ident("worker-2"),500);
  assert.equal(recovered.runId,"run-crashed");
  assert.equal(recovered.generation,2);
  await denied("lease_denied",()=>q1.acknowledge(ident("worker-1"),dying.runId,
    dying.leaseToken,"duplicate-provider-call"));
  assert.equal((await store.requestCancel(tenant,"run-crashed")).status,"cancelRequested");
  await denied("lease_denied",()=>q2.acknowledge(ident("worker-2"),recovered.runId,
    recovered.leaseToken,"late-canceled"));
  assert.equal(await q1.claim(ident("worker-1"),500),null);
  assert.equal((await sql`select count(*)::int as n from harness_eval_dispatch_leases
    where organization_id=${foreign}`)[0].n,0);
  // Exhausted retries must not silently re-dispatch or fabricate provider success.
  await store.reserve({organizationId:tenant,actorSubject:"test-operator",
    request:request(tenant,"run-exhausted"),capabilities:caps});
  for(let i=1;i<=4;i++){
    const leased=await q1.claim(ident("worker-1"),500);
    assert.equal(leased.runId,"run-exhausted");
    assert.equal(leased.attempt,i);
    const outcome=await q1.releaseForRetry(ident("worker-1"),leased.runId,leased.leaseToken,100);
    assert.equal(outcome.state,i===4?"exhausted":"retry");
    assert.equal(outcome.retryAfterMs,100*2**(i-1));
    // Before the enforced backoff completes no other process can reclaim it.
    now.at=new Date(now.at.getTime()+outcome.retryAfterMs-1);
    assert.equal(await q2.claim(ident("worker-2"),500),null);
    now.at=new Date(now.at.getTime()+2);
  }
  assert.equal(await q2.claim(ident("worker-2"),500),null);
  assert.equal((await store.getRun(tenant,"run-exhausted")).status,"queued");
  // Durable dispatch-start marker prevents crash/lease expiry from auto-redispatch.
  await store.reserve({organizationId:tenant,actorSubject:"test-operator",
    request:request(tenant,"run-possibly-started"),capabilities:caps});
  const sideEffect=await q1.claim(ident("worker-1"),500);
  assert.equal(sideEffect.runId,"run-possibly-started");
  assert.equal((await q1.markDispatchStarted(ident("worker-1"),
    sideEffect.runId,sideEffect.leaseToken)).state,"dispatching");
  await denied("lease_denied",()=>q1.releaseForRetry(ident("worker-1"),
    sideEffect.runId,sideEffect.leaseToken,100));
  now.at=new Date(now.at.getTime()+700);
  assert.equal(await q2.claim(ident("worker-2"),500),null,"provider-side uncertainty must never auto-dispatch");
  assert.equal((await q1.recordUnknownOutcome(ident("worker-1"),
    sideEffect.runId,sideEffect.leaseToken,"provider_unknown")).state,"reconciliation");
  assert.equal(await q2.claim(ident("worker-2"),500),null);
  await denied("lease_denied",()=>q2.acknowledge(ident("worker-2"),
    sideEffect.runId,sideEffect.leaseToken,"forged"));
  const holds=await sql`select state,reconciliation_reason from harness_eval_dispatch_leases
    where organization_id=${tenant} and harness_run_id=
      (select id from harness_eval_runs where organization_id=${tenant} and run_id='run-possibly-started')`;
  assert.deepEqual([holds[0].state,holds[0].reconciliation_reason],["reconciliation","provider_unknown"]);
  const active=await sql`select status,count(*)::int as n from harness_eval_runs
    where organization_id=${tenant} group by status`;
  assert.equal(active.find(x=>x.status==="running").n,2);
  assert.equal(active.find(x=>x.status==="cancelRequested").n,2);
  const audit=await sql`select count(*)::int as n from harness_eval_transitions
    where organization_id=${tenant} and action='started'`;
  assert.equal(audit[0].n,2);
  await sql`delete from organizations where id=${tenant}`;tenant=null;
  assert.equal((await sql`select count(*)::int as n from harness_eval_dispatch_leases`)[0].n,0);
  console.log(JSON.stringify({dispatchLeaseIntegration:"passed",
    assertions:["worker-auth","concurrent unique claim","tenant isolation","hash-only fencing",
      "retry backoff","retry exhaustion","generation fencing","crash recovery","cancel race","atomic audit","cascade"]}));
}finally{
  if(tenant)await sql`delete from organizations where id=${tenant}`;
  if(foreign)await sql`delete from organizations where id=${foreign}`;
  await sql.end({timeout:5});
}
