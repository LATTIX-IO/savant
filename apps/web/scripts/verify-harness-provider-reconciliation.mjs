import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import postgres from "postgres";
import {createHarnessReservationStore} from "../src/server/harness/invocation-reservations.ts";
import {createHarnessDispatchLeaseQueue} from "../src/server/harness/dispatch-leases.ts";
import {createHarnessProviderReconciliation,HarnessReconciliationError}
  from "../src/server/harness/provider-reconciliation.ts";

const url=process.env.DATABASE_URL;
if(!url||process.env.SAVANT_HARNESS_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(url).hostname))
  throw Error("Explicit isolated PostgreSQL 16 opt-in required");
const sql=postgres(url,{max:8,prepare:false});
const now={at:new Date("2026-10-12T12:00:00Z")};
const stamp=randomUUID().slice(0,8);
let tenant=null,other=null;
const evidenceHash="e".repeat(64);
const caps={protocol:{major:1,minor:0},adapterId:"sandbox-adapter",
  features:{execute:true,observe:true,cancel:true,events:true},
  coverage:{execution:"partial",observation:"partial"},
  limits:{maxConcurrency:2,maxDurationMs:30000,maxCostUsd:1}};
const request=(tenantId,runId)=>({
  tenantId,adapterId:"sandbox-adapter",actor:"operator-1",
  runId,idempotencyKey:"idem-"+runId,traceId:"trace-"+runId,
  specVersionHash:"a".repeat(64),testSuiteHash:"b".repeat(64),
  inputRef:"fixture-one",budget:{maxDurationMs:10000,maxCostUsd:0.25},
  capture:{level:"metadata",retentionDays:7,residency:"us-east-1"},
});
async function denied(code,fn){
  await assert.rejects(fn,e=>e instanceof HarnessReconciliationError&&e.code===code);
}
try{
  const [a]=await sql`insert into organizations(slug,display_name)
    values(${"recon-a-"+stamp},'Reconciliation A') returning id`;
  const [b]=await sql`insert into organizations(slug,display_name)
    values(${"recon-b-"+stamp},'Reconciliation B') returning id`;
  tenant=a.id;other=b.id;
  const store=createHarnessReservationStore({sql,now:()=>now.at,
    limits:{maxActive:2,maxReservedCostUsd:1}});
  const queue=createHarnessDispatchLeaseQueue({sql,now:()=>now.at,
    authorizeWorker:async identity=>identity.tenantId===tenant&&
      identity.adapterId==="sandbox-adapter"&&identity.workerId==="worker-1"});
  await store.reserve({organizationId:tenant,actorSubject:"operator-1",
    request:request(tenant,"run-one"),capabilities:caps});
  const identity={tenantId:tenant,adapterId:"sandbox-adapter",workerId:"worker-1"};
  const lease=await queue.claim(identity,1000);
  assert.equal(lease.runId,"run-one");
  await queue.markDispatchStarted(identity,lease.runId,lease.leaseToken);
  // Simulate worker process death after side-effect boundary, before ack.
  now.at=new Date(now.at.getTime()+2000);
  assert.equal(await queue.claim(identity,1000),null);
  let calls=0,allowed=true,providerStatus="accepted",providerEvidence=evidenceHash;
  const reconciler=createHarnessProviderReconciliation({
    sql,now:()=>now.at,
    authorizeOperator:async scope=>allowed&&scope.tenantId===tenant&&
      scope.actor==="security-reviewer"&&scope.adapterId==="sandbox-adapter",
    verifiedLookup:async pinned=>{
      calls++;
      assert.deepEqual(pinned,{
        tenantId:tenant,adapterId:"sandbox-adapter",runId:"run-one",
        idempotencyKey:"idem-run-one",traceId:"trace-run-one",
      });
      return {tenantId:tenant,adapterId:"sandbox-adapter",runId:"run-one",
        idempotencyKey:"idem-run-one",providerState:providerStatus,
        evidenceSha256:providerEvidence};
    },
  });
  const args={tenantId:tenant,adapterId:"sandbox-adapter",
    runId:"run-one",actor:"security-reviewer",observationId:"check-1"};
  await denied("unauthorized",()=>reconciler.inspectAndRecord({...args,actor:"outsider"}));
  await denied("unauthorized",()=>reconciler.inspectAndRecord({...args,tenantId:other}));
  assert.equal(calls,0);
  assert.deepEqual(await reconciler.inspectAndRecord(args),{
    state:"accepted",runId:"run-one",replay:false,action:"manual_reconciliation_required",
  });
  assert.equal((await reconciler.inspectAndRecord(args)).replay,true);
  providerStatus="not_found";
  await denied("observation_conflict",()=>reconciler.inspectAndRecord(args));
  assert.equal((await store.getRun(tenant,"run-one")).status,"queued");
  const leaseRows=await sql`select state from harness_eval_dispatch_leases
    where organization_id=${tenant}`;
  assert.equal(leaseRows[0].state,"dispatching");
  assert.equal(await queue.claim(identity,1000),null,"not_found does not permit replay");
  // Same event ID with changed raw evidence must not overwrite history.
  providerStatus="accepted";providerEvidence="f".repeat(64);
  await denied("observation_conflict",()=>reconciler.inspectAndRecord(args));
  providerEvidence=evidenceHash;
  const second=await reconciler.inspectAndRecord({...args,observationId:"check-2"});
  assert.equal(second.replay,false);
  const receipt=await sql`select idempotency_sha256,evidence_sha256,provider_state
    from harness_eval_reconciliation_observations where organization_id=${tenant}
    order by observed_at,observation_id`;
  assert.equal(receipt.length,2);
  assert.equal(receipt[0].idempotency_sha256,
    createHash("sha256").update("idem-run-one").digest("hex"));
  assert.equal(receipt[0].evidence_sha256,evidenceHash);
  allowed=false;
  await denied("unauthorized",()=>reconciler.inspectAndRecord({...args,observationId:"check-denied"}));
  assert.equal((await sql`select count(*)::int as n from
    harness_eval_reconciliation_observations where organization_id=${other}`)[0].n,0);
  // A cross-tenant FK graft is rejected by PostgreSQL itself.
  const [owned]=await sql`select id from harness_eval_runs where organization_id=${tenant}`;
  let graftDenied=false;
  try{
    await sql`insert into harness_eval_reconciliation_observations
      (organization_id,harness_run_id,observation_id,adapter_id,idempotency_sha256,
        evidence_sha256,provider_state)
      values (${other},${owned.id},'graft','sandbox-adapter',${"c".repeat(64)},
        ${evidenceHash},'accepted')`;
  }catch(error){graftDenied=error.code==="23503";if(!graftDenied)throw error;}
  assert.equal(graftDenied,true);
  await sql`delete from organizations where id=${tenant}`;tenant=null;
  assert.equal((await sql`select count(*)::int as n from
    harness_eval_reconciliation_observations`)[0].n,0);
  console.log(JSON.stringify({providerReconciliation:"passed",
    assertions:["admin scope","provider idempotency pins","durable replay",
      "conflicting evidence","no automatic redispatch","foreign tenant FK","cascade"]}));
} finally {
  if(tenant)await sql`delete from organizations where id=${tenant}`;
  if(other)await sql`delete from organizations where id=${other}`;
  await sql.end({timeout:5});
}
