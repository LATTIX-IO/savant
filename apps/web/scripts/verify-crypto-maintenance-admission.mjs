import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import postgres from "postgres";
import {createCryptoMaintenanceAdmissionStore}
  from "../src/server/security/crypto-maintenance-executor.ts";

const url=process.env.DATABASE_URL;
if(process.env.CI!=="true"||
  process.env.SAVANT_CRYPTO_MAINTENANCE_DB_TEST!=="1"||
  process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||
  process.env.PGPASSWORD!=="integration_only"||
  url!=="postgresql://savant@127.0.0.1:5432/savant")
  throw Error("PER-1560 requires disposable localhost CI database only");
const sql=postgres(url,{max:8,prepare:false});
const store=createCryptoMaintenanceAdmissionStore(sql);
const suffix=randomBytes(4).toString("hex");
let orgId;
const target="definitions",sha="a".repeat(40);
const permit=(index,changes={})=>({
  approvalId:randomUUID(),organizationId:orgId,
  target,maxRows:4,activeKeyId:"oct2026",
  backupId:"synthetic-approved-backup",backupSha256:"b".repeat(64),
  changeTicket:"PER-1560",reviewerId:"901",actorId:"900",
  runId:String(500001+index),runAttempt:"1",mainSha:sha,
  approvalSha256:"c".repeat(64),...changes
});
const expectDenied=async(fn)=>assert.rejects(fn,
  e=>e?.code==="maintenance_replay_or_admission_denied"||
    e?.code==="maintenance_transition_denied"||
    e?.code==="maintenance_result_integrity_denied");
let completed=0;
try{
  const [org]=await sql.unsafe(
    "insert into organizations(slug,display_name) values($1,$2) returning id",
    ["maintenance-"+suffix,"Crypto maintenance synthetic tenant"]);
  orgId=org.id;
  const first=permit(1),id=await store.reserve(first);
  assert.match(id,/^[0-9a-f-]{36}$/);
  await expectDenied(()=>store.reserve(first)); // exact approval replay
  const conflict=permit(2);
  await expectDenied(()=>store.reserve(conflict)); // same tenant+target active
  const otherAttempt=permit(3,{
    target:"ai-secrets",runId:first.runId,runAttempt:first.runAttempt
  });
  await expectDenied(()=>store.reserve(otherAttempt)); // workflow run attempt reused
  const pending=await sql.unsafe(
    "select state,max_rows,operator_actor_id,reviewer_actor_id from "+
    "crypto_maintenance_operations where id=$1",[id]);
  assert.equal(pending[0].state,"admitted");
  assert.equal(pending[0].max_rows,4);
  assert.notEqual(pending[0].operator_actor_id,pending[0].reviewer_actor_id);
  // DB trigger makes signed authorization, tenant and target immutable.
  await assert.rejects(sql.unsafe(
    "update crypto_maintenance_operations set operator_actor_id=999 "+
    "where id=$1",[id]));
  await assert.rejects(sql.unsafe(
    "update crypto_maintenance_operations set state='completed',"+
    "migrated=0,resulting_batch_id=$1 where id=$2",
    [randomUUID(),id]));
  assert.equal((await sql.unsafe(
    "select state from crypto_maintenance_operations where id=$1",[id]))[0].state,
    "admitted");
  await store.start(id,first);
  await expectDenied(()=>store.start(id,first));
  await expectDenied(()=>store.complete(id,first,{
    batchId:randomUUID(),organizationId:orgId,target,maxRows:4,
    activeKeyId:"unapproved-key",migrated:1,fieldsRewrapped:1,remaining:0
  }));
  assert.equal((await sql.unsafe(
    "select state from crypto_maintenance_operations where id=$1",[id]))[0].state,
    "running");
  const batch=randomUUID();
  await store.complete(id,first,{
    batchId:batch,organizationId:orgId,target,
    activeKeyId:"oct2026",migrated:2,fieldsRewrapped:2,remaining:0
  });
  completed++;
  await expectDenied(()=>store.uncertain(id,first)); // completed cannot roll back
  await assert.rejects(sql.unsafe(
    "update crypto_maintenance_operations set state='admitted',"+
    "migrated=null,resulting_batch_id=null where id=$1",[id]));
  const newPermit=permit(4),second=await store.reserve(newPermit);
  assert.notEqual(second,id); // prior completed releases only its target lease
  await store.start(second,newPermit);
  await store.uncertain(second,newPermit);
  await expectDenied(()=>store.reserve(permit(5))); // uncertain blocks automatic retry
  await expectDenied(()=>store.start(second,newPermit));
  const audits=await sql.unsafe(
    "select action,target_ref,payload_redacted from audit_events "+
    "where organization_id=$1 and category='security' and "+
    "action like 'crypto_maintenance_%' order by id",[orgId]);
  assert.deepEqual(audits.map(x=>x.action),[
    "crypto_maintenance_admitted","crypto_maintenance_started",
    "crypto_maintenance_completed","crypto_maintenance_admitted",
    "crypto_maintenance_started","crypto_maintenance_uncertain"
  ]);
  assert.ok(audits.every(a=>a.payload_redacted.schema===
    "savant.crypto-maintenance-proof.v1"));
  assert.ok(audits.every(a=>!JSON.stringify(a).includes("SYNTHETIC_SECRET")));
  const rows=await sql.unsafe(
    "select state,migrated,resulting_batch_id from "+
    "crypto_maintenance_operations where organization_id=$1 order by admitted_at",
    [orgId]);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>x.state).sort(),["completed","uncertain"]);
  console.log(JSON.stringify({
    cryptoMaintenanceAdmission:"passed",mode:"ephemeral-postgres-only",
    replayDenied:true,concurrentTenantTargetDenied:true,workflowAttemptDenied:true,
    immutableApprovalEnforced:true,completed,uncertainRetained:true,
    auditEvents:audits.length
  }));
}finally{
  if(orgId){
    await sql.unsafe("delete from crypto_maintenance_operations "+
      "where organization_id=$1",[orgId]);
    await sql.unsafe("delete from organizations where id=$1",[orgId]);
  }
  await sql.end({timeout:5});
}
