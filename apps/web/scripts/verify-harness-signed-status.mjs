import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import postgres from "postgres";
import {createHarnessReservationStore} from "../src/server/harness/invocation-reservations.ts";
import {createHarnessDispatchLeaseQueue} from "../src/server/harness/dispatch-leases.ts";
import {createHarnessProviderReconciliation,HarnessReconciliationError}
  from "../src/server/harness/provider-reconciliation.ts";
import {createSignedHarnessStatusLookup}
  from "../src/server/harness/signed-status-connector.ts";

const url=process.env.DATABASE_URL;
if(!url||process.env.SAVANT_HARNESS_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(url).hostname))
  throw Error("Isolated local PostgreSQL is required");
const sql=postgres(url,{max:5,prepare:false});
const now=new Date("2026-10-12T12:00:00Z");
const suffix=randomUUID().slice(0,8);
const adapterId="sandbox-adapter",runId="run-status",key=Buffer.alloc(32,0x55);
const origin="https://harness-uat.example.com";
const endpoint=origin+"/v1/savant/status";
let tenant=null,foreign=null,requestCount=0;
const caps={protocol:{major:1,minor:0},adapterId,
  features:{execute:true,observe:true,cancel:true,events:true},
  coverage:{execution:"partial",observation:"partial"},
  limits:{maxConcurrency:1,maxDurationMs:30000,maxCostUsd:1}};
try{
  const [a]=await sql`insert into organizations(slug,display_name)
    values(${"signed-status-a-"+suffix},'Status A') returning id`;
  const [b]=await sql`insert into organizations(slug,display_name)
    values(${"signed-status-b-"+suffix},'Status B') returning id`;
  tenant=a.id;foreign=b.id;
  const reservations=createHarnessReservationStore({
    sql,now:()=>now,limits:{maxActive:2,maxReservedCostUsd:1},
  });
  const request={tenantId:tenant,adapterId,actor:"test-operator",runId,
    traceId:"trace-1",idempotencyKey:"idem-1",specVersionHash:"a".repeat(64),
    testSuiteHash:"b".repeat(64),inputRef:"fixture-one",
    budget:{maxDurationMs:10000,maxCostUsd:0.25},
    capture:{level:"metadata",retentionDays:7,residency:"us-east-1"},
  };
  await reservations.reserve({organizationId:tenant,actorSubject:"test-operator",request,capabilities:caps});
  const identity={tenantId:tenant,adapterId,workerId:"worker-1"};
  const queue=createHarnessDispatchLeaseQueue({
    sql,now:()=>now,authorizeWorker:async who=>
      who.tenantId===tenant&&who.adapterId===adapterId&&who.workerId==="worker-1",
  });
  const lease=await queue.claim(identity,500);
  await queue.markDispatchStarted(identity,runId,lease.leaseToken);
  let invalidSignature=false;
  const sign=(label,stamp,nonce,bytes)=>"v1="+createHmac("sha256",key)
    .update(Buffer.concat([
      Buffer.from(`${label}\n${stamp}\n${nonce}\n${tenant}\n${adapterId}\n${runId}\n`),bytes,
    ])).digest("hex");
  const lookup=createSignedHarnessStatusLookup({
    allowedOrigins:[origin],nowMs:()=>now.getTime(),
    resolveConnection:async(t,a)=>{
      assert.equal(t,tenant);assert.equal(a,adapterId);
      return {endpoint,secretRef:`vault:${tenant}:${adapterId}:status`};
    },
    readSecret:async(t,a,ref)=>{
      assert.equal(t,tenant);assert.equal(a,adapterId);
      assert.equal(ref,`vault:${tenant}:${adapterId}:status`);
      return key;
    },
    transport:async(url,init)=>{
      requestCount++;
      assert.equal(url,endpoint);assert.equal(init.redirect,"error");
      const headers=new Headers(init.headers);
      const stamp=headers.get("x-savant-timestamp");
      const nonce=headers.get("x-savant-nonce");
      const outbound=Buffer.from(init.body);
      assert.equal(headers.get("x-savant-signature"),
        sign("savant-harness-status-request-v1",stamp,nonce,outbound));
      assert.deepEqual(JSON.parse(outbound.toString("utf8")),{
        tenantId:tenant,adapterId,runId,idempotencyKey:"idem-1",traceId:"trace-1",
      });
      const response=Buffer.from(JSON.stringify({
        tenantId:tenant,adapterId,runId,idempotencyKey:"idem-1",providerState:"accepted",
      }));
      return new Response(new Uint8Array(response),{
        status:200,headers:{"content-type":"application/json",
          "x-savant-timestamp":stamp,"x-savant-nonce":nonce,
          "x-savant-signature":invalidSignature?"v1="+"0".repeat(64):
            sign("savant-harness-status-response-v1",stamp,nonce,response)},
      });
    },
  });
  const reconcile=createHarnessProviderReconciliation({
    sql,now:()=>now,
    authorizeOperator:async s=>s.tenantId===tenant&&s.actor==="security-reviewer",
    verifiedLookup:lookup,
  });
  const input={tenantId:tenant,adapterId,runId,
    actor:"security-reviewer",observationId:"signed-uat"};
  invalidSignature=true;
  await assert.rejects(()=>reconcile.inspectAndRecord(input),
    e=>e instanceof HarnessReconciliationError&&e.code==="provider_unavailable");
  assert.equal((await sql`select count(*)::int as n
    from harness_eval_reconciliation_observations where organization_id=${tenant}`)[0].n,0);
  invalidSignature=false;
  assert.deepEqual(await reconcile.inspectAndRecord(input),{
    state:"accepted",runId,replay:false,action:"manual_reconciliation_required",
  });
  assert.equal((await reconcile.inspectAndRecord(input)).replay,true);
  await assert.rejects(()=>reconcile.inspectAndRecord({...input,tenantId:foreign}),
    e=>e instanceof HarnessReconciliationError&&e.code==="unauthorized");
  assert.equal(requestCount,3,"foreign tenant must not invoke provider");
  const receipt=await sql`select provider_state,idempotency_sha256,evidence_sha256
    from harness_eval_reconciliation_observations where organization_id=${tenant}`;
  assert.equal(receipt.length,1);assert.equal(receipt[0].provider_state,"accepted");
  assert.match(receipt[0].idempotency_sha256,/^[a-f0-9]{64}$/);
  assert.match(receipt[0].evidence_sha256,/^[a-f0-9]{64}$/);
  assert.equal((await reservations.getRun(tenant,runId)).status,"queued");
  assert.equal((await sql`select state from harness_eval_dispatch_leases
    where organization_id=${tenant}`)[0].state,"dispatching");
  console.log(JSON.stringify({signedHarnessStatusIntegration:"passed",
    checks:["signed request","vault scoped origin","provider response MAC",
      "original idempotency","Postgres evidence","forged signature",
      "tenant denial","no automatic run replay"]}));
}finally{
  if(tenant)await sql`delete from organizations where id=${tenant}`;
  if(foreign)await sql`delete from organizations where id=${foreign}`;
  await sql.end({timeout:5});
}
