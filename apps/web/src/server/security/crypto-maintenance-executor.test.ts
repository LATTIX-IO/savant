import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync,sign} from "node:crypto";
import {
  canonicalApprovalBytes,MaintenanceAuthorizationError
} from "./crypto-maintenance-authorization.ts";
import {createCryptoMaintenanceExecutor} from "./crypto-maintenance-executor.ts";

const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
const ed=generateKeyPairSync("ed25519");
const rsaKey={...rsa.publicKey.export({format:"jwk"}),
  kid:"per1560-fixture-key",alg:"RS256",use:"sig"};
const sha="a".repeat(40),time=Date.now();
const tenant="22222222-2222-4222-8222-222222222222";
const operation="33333333-3333-4333-8333-333333333333";
const batch="44444444-4444-4444-8444-444444444444";
const trust={
  repositoryId:"123456",expectedMainSha:sha,
  issuer:"https://token.actions.githubusercontent.com",
  audience:"api://savant-crypto-maintenance",
  subject:"repo:LATTIX-IO/savant:environment:savant-crypto-maintenance",
  workflowRef:"LATTIX-IO/savant/.github/workflows/crypto-maintenance.yml@refs/heads/main",
  oidcJwks:[rsaKey],approvalPublicKey:ed.publicKey
};
const enc=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString("base64url");
function jwt(change:Record<string,unknown>={}):string{
  const h=enc({alg:"RS256",kid:rsaKey.kid,typ:"JWT"});
  const b=enc({iss:trust.issuer,aud:trust.audience,sub:trust.subject,
    repository:"LATTIX-IO/savant",repository_id:trust.repositoryId,
    ref:"refs/heads/main",workflow_ref:trust.workflowRef,sha,
    event_name:"workflow_dispatch",actor_id:"900",run_id:"118800",
    run_attempt:"1",iat:Math.floor(time/1000)-10,
    nbf:Math.floor(time/1000)-10,exp:Math.floor(time/1000)+180,...change});
  const data=h+"."+b;
  return data+"."+sign("RSA-SHA256",Buffer.from(data),rsa.privateKey).toString("base64url");
}
function grant(change:Record<string,unknown>={}){
  const payload={
    schema:"savant.crypto-maintenance-approval.v1" as const,
    approvalId:"11111111-1111-4111-8111-111111111111",
    organizationId:tenant,target:"definitions" as const,maxRows:4,
    activeKeyId:"oct2026",backupId:"backup-fixture",backupSha256:"b".repeat(64),
    changeTicket:"PER-1560",reviewerId:"901",runnerActorId:"900",
    githubRunId:"118800",githubRunAttempt:"1",mainSha:sha,
    notBeforeMs:time-30000,expiresAtMs:time+180000,...change
  };
  return {payload,signature:sign(null,canonicalApprovalBytes(payload as never),
    ed.privateKey).toString("base64url")};
}
const err=(code:string)=>(e:unknown)=>
  e instanceof MaintenanceAuthorizationError&&e.code===code;
function fixture(){
  const calls:string[]=[],verified:{backup:boolean;role:boolean;keys:boolean}={
    backup:true,role:true,keys:true
  };
  const store={
    reserve:async()=>{calls.push("reserve");return operation;},
    start:async()=>{calls.push("start");},
    complete:async()=>{calls.push("complete");},
    uncertain:async()=>{calls.push("uncertain");}
  };
  const baseResult={
    batchId:batch,organizationId:tenant,target:"definitions" as const,
    migrated:2,fieldsRewrapped:2,remaining:3,activeKeyId:"oct2026"
  };
  const deps={
    trust,clock:()=>time,store,
    verifyRestoredBackup:async()=>{calls.push("backup");return verified.backup;},
    verifyRestrictedDatabaseRole:async()=>{calls.push("role");return verified.role;},
    verifyManagedKeyVersions:async()=>{calls.push("keys");return verified.keys;},
    rewrap:async(actor:unknown,scope:unknown)=>{
      calls.push("rewrap");
      assert.deepEqual(actor,{scope:"platform-crypto-operator",subject:"gha-900"});
      assert.deepEqual(scope,{organizationId:tenant,target:"definitions",maxRows:4});
      return baseResult;
    }
  };
  return {calls,verified,store,deps,baseResult};
}
test("PER-1560: signed workload+independent approval, recovered backup, restricted DB and KMS precede durable admission",async()=>{
  const f=fixture();const r=await createCryptoMaintenanceExecutor(f.deps).execute(jwt(),grant());
  assert.equal(r.operationId,operation);
  assert.equal(r.organizationId,tenant);
  assert.equal(r.migrated,2);
  assert.deepEqual(f.calls,[
    "backup","role","keys","reserve","start","rewrap","complete"
  ]);
  assert.equal(Object.isFrozen(r),true);
});
test("PER-1560: unsigned or tampered workflow identity/approval never invokes checks, database or rewrap",async()=>{
  const f=fixture();const go=createCryptoMaintenanceExecutor(f.deps);
  await assert.rejects(()=>go.execute(jwt({sub:"repo:LATTIX-IO/savant:ref:refs/heads/main"}),grant()),
    err("oidc_workload_scope_denied"));
  await assert.rejects(()=>go.execute(jwt(),grant({reviewerId:"900"})),
    err("approval_not_valid_for_execution"));
  assert.deepEqual(f.calls,[]);
});
test("PER-1560: missing real backup restoration, scoped DB role or KMS escrow denies BEFORE durable admission",async()=>{
  for(const bad of ["backup","role","keys"] as const){
    const f=fixture();f.verified[bad]=false;
    await assert.rejects(()=>
      createCryptoMaintenanceExecutor(f.deps).execute(jwt(),grant()),
      err("maintenance_operational_preflight_denied"));
    assert.ok(!f.calls.includes("reserve"));
    assert.ok(!f.calls.includes("rewrap"));
  }
});
test("PER-1560: exceptions from KMS and database validators are sanitized and fail closed",async()=>{
  const f=fixture();f.deps.verifyManagedKeyVersions=async()=>{
    throw Error("SECRET_UNSAFE_INFORMATION");
  };
  await assert.rejects(()=>
    createCryptoMaintenanceExecutor(f.deps).execute(jwt(),grant()),
    e=>err("maintenance_operational_preflight_denied")(e)&&
      !(e as Error).message.includes("SECRET"));
  assert.ok(!f.calls.includes("reserve"));
});
test("PER-1560: replay or concurrent admission rejection never rewraps",async()=>{
  const f=fixture();
  f.store.reserve=async()=>{throw new MaintenanceAuthorizationError(
    "maintenance_replay_or_admission_denied");};
  await assert.rejects(()=>
    createCryptoMaintenanceExecutor(f.deps).execute(jwt(),grant()),
    err("maintenance_replay_or_admission_denied"));
  assert.ok(!f.calls.includes("rewrap"));
});
test("PER-1560: ambiguous durable start does not run rewrap or automatically retry",async()=>{
  const f=fixture();
  f.store.start=async()=>{throw Error("uncertain storage result");};
  await assert.rejects(()=>
    createCryptoMaintenanceExecutor(f.deps).execute(jwt(),grant()),
    err("maintenance_start_uncertain_manual_reconciliation"));
  assert.ok(!f.calls.includes("rewrap"));
});
test("PER-1560: failed rewrap is held in uncertain state with no blind retry",async()=>{
  const f=fixture();
  f.deps.rewrap=async()=>{throw Error("SECRET provider failure");};
  await assert.rejects(()=>
    createCryptoMaintenanceExecutor(f.deps).execute(jwt(),grant()),
    e=>err("maintenance_uncertain_manual_reconciliation")(e)&&
      !(e as Error).message.includes("SECRET"));
  assert.deepEqual(f.calls,[
    "backup","role","keys","reserve","start","uncertain"
  ]);
});
test("PER-1560: failed outcome audit leaves uncertain manual hold",async()=>{
  const f=fixture();
  f.store.complete=async()=>{calls.push("complete");throw Error("commit status unknown");};
  const calls=f.calls;
  await assert.rejects(()=>
    createCryptoMaintenanceExecutor(f.deps).execute(jwt(),grant()),
    err("maintenance_uncertain_manual_reconciliation"));
  assert.ok(f.calls.includes("uncertain"));
});
test("PER-1560: error in uncertain-state persistence cannot be interpreted as success",async()=>{
  const f=fixture();f.store.complete=async()=>{throw Error("unknown");};
  f.store.uncertain=async()=>{throw Error("error contains confidential material");};
  await assert.rejects(()=>
    createCryptoMaintenanceExecutor(f.deps).execute(jwt(),grant()),
    err("maintenance_uncertain_manual_reconciliation"));
});
