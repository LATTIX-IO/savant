import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createHarnessReservationStore} from "../src/server/harness/invocation-reservations.ts";
import {createHarnessDispatchLeaseQueue} from "../src/server/harness/dispatch-leases.ts";
import {createHarnessRunContextLoader} from "../src/server/harness/dispatch-run-context.ts";
import {createHarnessDispatchWorker} from "../src/server/harness/dispatch-worker.ts";
const url=process.env.DATABASE_URL;
if(!url||process.env.SAVANT_HARNESS_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(url).hostname))
  throw Error("Isolated local PostgreSQL opt-in required.");
const sql=postgres(url,{max:8,prepare:false});
const stamp=randomUUID().slice(0,8);
const now={at:new Date("2026-10-12T12:00:00.000Z")};
let tenant=null,foreign=null;
const caps={protocol:{major:1,minor:0},adapterId:"sandbox-adapter",
  features:{execute:true,observe:true,cancel:true,events:true},
  coverage:{execution:"partial",observation:"partial"},
  limits:{maxConcurrency:4,maxDurationMs:60000,maxCostUsd:1}};
const hashA="a".repeat(64),hashB="b".repeat(64);
const request=(tenantId,runId)=>({
  tenantId,adapterId:"sandbox-adapter",actor:"reviewer",
  runId,traceId:"trace-"+runId,idempotencyKey:"idem-"+runId,
  specVersionHash:hashA,testSuiteHash:hashB,inputRef:"fixture-golden",
  budget:{maxDurationMs:10000,maxCostUsd:0.25},
  capture:{level:"metadata",retentionDays:7,residency:"us-east-1"},
});
const claims=[];
try {
  const [a]=await sql`insert into organizations(slug,display_name)
    values(${"dispatch-worker-a-"+stamp},'Dispatch Worker A') returning id`;
  const [b]=await sql`insert into organizations(slug,display_name)
    values(${"dispatch-worker-b-"+stamp},'Dispatch Worker B') returning id`;
  tenant=a.id;foreign=b.id;
  const reservations=createHarnessReservationStore({
    sql,now:()=>now.at,limits:{maxActive:5,maxReservedCostUsd:2},
  });
  const submit=async(runId)=>reservations.reserve({
    organizationId:tenant,actorSubject:"reviewer",request:request(tenant,runId),capabilities:caps,
  });
  await submit("run-allowed");
  await submit("run-denied");
  await submit("run-unknown");
  const identity={tenantId:tenant,adapterId:"sandbox-adapter",workerId:"worker-a"};
  const queue=createHarnessDispatchLeaseQueue({
    sql,now:()=>now.at,authorizeWorker:async principal=>
      principal.tenantId===tenant&&principal.adapterId==="sandbox-adapter"&&principal.workerId==="worker-a",
  });
  const permissions=new Set(["run-allowed","run-unknown"]);
  const context=createHarnessRunContextLoader({
    sql,now:()=>now.at,
    authorizeArtifacts:async claim=>{
      claims.push(claim);
      return claim.tenantId===tenant&&claim.actor==="reviewer"&&
        claim.specVersionHash===hashA&&claim.testSuiteHash===hashB&&
        claim.inputRef==="fixture-golden"&&permissions.has(claim.runId);
    },
  });
  const remote=[];
  const outcomes=[];
  const worker=createHarnessDispatchWorker({
    queue,nowMs:()=>now.at.getTime(),
    loadAuthorizedRequest:context,
    resolveAdapter:async()=>({
      durableIdempotency:true,capabilities:caps,
      invoke:async(req,options)=>{
        remote.push({tenantId:req.tenantId,runId:req.runId,
          key:options.idempotencyKey,hasSignal:!!options.signal});
        if(req.runId==="run-unknown")throw Error("unsafe provider error secret");
        return {
          tenantId:req.tenantId,adapterId:req.adapterId,runId:req.runId,
          externalRunId:"external-"+req.runId,traceId:req.traceId,
          specVersionHash:req.specVersionHash,testSuiteHash:req.testSuiteHash,
          status:"queued",
        };
      },
    }),
    audit:async event=>{outcomes.push(event);},
  });
  const positive=await worker.tick(identity,20000);
  assert.deepEqual(positive,{state:"dispatched",runId:"run-allowed"});
  assert.deepEqual(remote,[{tenantId:tenant,runId:"run-allowed",
    key:"idem-run-allowed",hasSignal:true}]);
  assert.equal((await reservations.getRun(tenant,"run-allowed")).status,"running");
  const denied=await worker.tick(identity,20000);
  assert.deepEqual(denied,{state:"retry",runId:"run-denied"});
  assert.equal(remote.length,1,"denied artifacts never call provider");
  const pending=await worker.tick(identity,20000);
  assert.deepEqual(pending,{state:"reconciliation_required",runId:"run-unknown"});
  assert.equal(remote.length,2,"provider failure not blindly retried");
  assert.equal((await reservations.getRun(tenant,"run-unknown")).status,"queued");
  assert.equal((await reservations.getRun(tenant,"run-denied")).status,"queued");
  assert.equal(claims.length,3);
  assert.equal(outcomes.length,2);
  assert.equal(await worker.tick(identity,20000).then(x=>x.state),"idle","backoff and leased unknown require reconciliation");
  const persisted=await sql`
    select run_id,status,external_run_id from harness_eval_runs
      where organization_id=${tenant} order by run_id
  `;
  assert.deepEqual(persisted.map(x=>[x.run_id,x.status]),[
    ["run-allowed","running"],["run-denied","queued"],["run-unknown","queued"]]);
  assert.equal(persisted[0].external_run_id,"external-run-allowed");
  const otherContext=await createHarnessRunContextLoader({
    sql,now:()=>now.at,authorizeArtifacts:async()=>false,
  })({
    tenantId:foreign,adapterId:"sandbox-adapter",runId:"run-allowed",
    traceId:"trace-run-allowed",idempotencyKey:"idem-run-allowed",
    inputRef:"fixture-golden",specVersionHash:hashA,testSuiteHash:hashB,
  }).then(()=>true,()=>false);
  assert.equal(otherContext,false,"cannot load foreign tenant artifact");
  assert.equal((await sql`select count(*)::int as n from harness_eval_runs
    where organization_id=${foreign}`)[0].n,0);
  assert.equal((await sql`select count(*)::int as n from harness_eval_transitions
    where organization_id=${tenant} and action='started'`)[0].n,1);
  console.log(JSON.stringify({
    dispatchWorkerIntegration:"passed",
    checks:["tenant isolation","immutable artifact permission","provider idempotency",
      "unknown side effect reconciliation","audit","atomic run state"],
  }));
} finally {
  if(tenant)await sql`delete from organizations where id=${tenant}`;
  if(foreign)await sql`delete from organizations where id=${foreign}`;
  await sql.end({timeout:5});
}
