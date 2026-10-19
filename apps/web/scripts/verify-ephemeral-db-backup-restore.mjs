import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {readdir,readFile} from "node:fs/promises";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {decryptTestBenchCases,encryptTestBenchCases}
  from "../src/server/test-bench/definition-crypto.ts";
import {encryptAIConnectionSecret,decryptAIConnectionSecret}
  from "../src/server/control-plane/ai-connection-secrets.ts";
import {createManagedCiphertextRewrapper}
  from "../src/server/security/managed-ciphertext-rewrap.ts";
import {
  assertEphemeralRestoreContext,dumpEphemeralDatabase,
  createEphemeralRestoreDatabase,restoreEphemeralDatabase,
  dropEphemeralRestoreDatabase,restoredDatabaseUri,
  writeEncryptedFixtureSnapshot,readVerifiedFixtureSnapshot,
  decryptFixtureBackup,withPrivateBackupDirectory
} from "./ephemeral-encrypted-pg-archive.mjs";

const ctx=assertEphemeralRestoreContext();
const uri=process.env.DATABASE_URL;
const sql=postgres(uri,{max:6,prepare:false});
const defs=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const rewrap=createManagedCiphertextRewrapper(sql);
const op={scope:"platform-crypto-operator",subject:"ci-backup-restore-operator"};
const uid=randomBytes(4).toString("hex"),sha="a".repeat(40);
const oldBench="31".repeat(32),nextBench="51".repeat(32);
const oldAI="32".repeat(32),nextAI="52".repeat(32);
const benchV1={TEST_BENCH_ENCRYPTION_KEY:oldBench};
const benchV2={
  TEST_BENCH_ENCRYPTION_KEY:nextBench,
  TEST_BENCH_ENCRYPTION_KEY_ID:"oct2026",
  TEST_BENCH_LEGACY_ENCRYPTION_KEY:oldBench
};
const aiV1={AI_CONNECTION_ENCRYPTION_KEY:oldAI};
const aiV2={
  AI_CONNECTION_ENCRYPTION_KEY:nextAI,
  AI_CONNECTION_ENCRYPTION_KEY_ID:"oct2026",
  AI_CONNECTION_LEGACY_ENCRYPTION_KEY:oldAI
};
const keyNames=["TEST_BENCH_ENCRYPTION_KEY","TEST_BENCH_ENCRYPTION_KEY_ID",
  "TEST_BENCH_LEGACY_ENCRYPTION_KEY","TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS",
  "AI_CONNECTION_ENCRYPTION_KEY","AI_CONNECTION_ENCRYPTION_KEY_ID",
  "AI_CONNECTION_LEGACY_ENCRYPTION_KEY","AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS"];
const previous=Object.fromEntries(keyNames.map(k=>[k,process.env[k]]));
const applyEnv=values=>{
  for(const k of keyNames){
    if(values[k]===undefined)delete process.env[k];
    else process.env[k]=values[k];
  }
};
const scope=(organizationId,target)=>({organizationId,target,maxRows:12});
const one=async(pg,query,params=[])=>{
  const rows=await pg.unsafe(query,params);return rows[0];
};
const organizations=[];
const restoredDbs=[];
let restoredConnections=[];
const backupKey=randomBytes(32);
let tenant=null,foreign=null,skillId=null,actor=null;
const activeReq=randomUUID(),originalCases=[
  {caseId:"active",kind:"positive",prompt:"SYNTHETIC_PRIVATE_PROMPT",
    context:null,expectedBehavior:"pass"}
];
const archivedCases=[
  {caseId:"archive",kind:"positive",prompt:"SYNTHETIC_ARCHIVED_PROMPT",
    context:null,expectedBehavior:"pass"}
];
let activeId,archivedId,runId,connectionId,foreignConnId;
let requestDigest,secretFingerprint,oldRun,originSecret;
async function setup(){
  const [a]=await sql.unsafe(
    "insert into organizations(slug,display_name) "+
    "values($1,'Isolated restore tenant') returning id",["recover-"+uid]);
  tenant=a.id;organizations.push(tenant);
  const [b]=await sql.unsafe(
    "insert into organizations(slug,display_name) "+
    "values($1,'Isolated restore foreign tenant') returning id",["recover-other-"+uid]);
  foreign=b.id;organizations.push(foreign);
  const [repo]=await sql.unsafe(
    "insert into repositories(organization_id,provider_type,owner_name,"+
    "repo_name,default_branch) values($1,'github','ci-recovery',$2,'main') returning id",
    [tenant,"restore-"+uid]);
  skillId="backup-"+uid;
  await sql.unsafe(
    "insert into indexed_skills(organization_id,repository_id,skill_id,"+
    "display_name,tier,status,source_path,source_commit_sha,content_hash) "+
    "values($1,$2,$3,'Restore fixture','tier1','active',$4,$5,'fixture')",
    [tenant,repo.id,skillId,"skills/"+skillId,sha]);
  actor={organizationId:tenant,subject:"ci-admin",role:"admin"};
  const active=await defs.create(actor,skillId,{
    name:"Synthetic active",cases:originalCases,requestId:activeReq
  });
  const archived=await defs.create(actor,skillId,{
    name:"Synthetic archived",cases:archivedCases,requestId:randomUUID()
  });
  activeId=active.definition.id;archivedId=archived.definition.id;
  await defs.archive(actor,skillId,archivedId,1);
  const obs=await runs.start(actor,skillId,activeId,{
    requestId:randomUUID(),expectedRevision:1,executionSource:"platform-nim"
  });
  runId=obs.run.id;
  const results=encryptTestBenchCases("[]",{
    organizationId:tenant,definitionId:runId,revision:1,commitSha:sha
  },benchV1,65536);
  await sql.unsafe("update test_bench_runs set results_ciphertext=$1 where id=$2",
    [results,runId]);
  oldRun=await one(sql,"select * from test_bench_runs where id=$1",[runId]);
  requestDigest=(await one(sql,"select request_digest from test_bench_definitions "+
    "where id=$1",[activeId])).request_digest;
  connectionId=randomUUID();
  const secret="SYNTHETIC_CREDENTIAL_NEVER_VALID";
  originSecret=secret;
  const envelope=encryptAIConnectionSecret(secret,{
    organizationId:tenant,aiConnectionId:connectionId,provider:"openai"
  },aiV1);
  secretFingerprint=envelope.secretFingerprint;
  await sql.unsafe(
    "insert into ai_connections(id,organization_id,provider_type,display_name,"+
    "default_model,purpose,usage_scope,secret_ref,status) "+
    "values($1,$2,'openai','Restore connection','test-model','QA','test-bench',$3,'active')",
    [connectionId,tenant,"ai-connection:"+connectionId]);
  await sql.unsafe(
    "insert into ai_connection_secrets(ai_connection_id,encrypted_secret,"+
    "secret_fingerprint,algorithm,key_version) values($1,$2,$3,$4,$5)",
    [connectionId,envelope.encryptedSecret,envelope.secretFingerprint,
      envelope.algorithm,envelope.keyVersion]);
  foreignConnId=randomUUID();
  const other=encryptAIConnectionSecret("SYNTHETIC_OTHER_TENANT",{
    organizationId:foreign,aiConnectionId:foreignConnId,provider:"openai"
  },aiV1);
  await sql.unsafe(
    "insert into ai_connections(id,organization_id,provider_type,display_name,"+
    "default_model,purpose,usage_scope,secret_ref,status) "+
    "values($1,$2,'openai','Foreign fixture','test-model','QA','test-bench',$3,'active')",
    [foreignConnId,foreign,"ai-connection:"+foreignConnId]);
  await sql.unsafe(
    "insert into ai_connection_secrets(ai_connection_id,encrypted_secret,"+
    "secret_fingerprint,algorithm,key_version) values($1,$2,$3,$4,$5)",
    [foreignConnId,other.encryptedSecret,other.secretFingerprint,
      other.algorithm,other.keyVersion]);
}
async function verify(pg,{version,expectedAudit}){
  const [schema]=await pg.unsafe(
    "select to_regclass('public.test_bench_definitions') as definitions,"+
    "to_regclass('public.test_bench_runs') as runs,"+
    "to_regclass('public.ai_connection_secrets') as secrets");
  assert.ok(schema.definitions&&schema.runs&&schema.secrets);
  const benv=version===1?benchV1:benchV2;
  const aenv=version===1?aiV1:aiV2;
  const rows=await pg.unsafe(
    "select id,revision,source_commit_sha,archived_at,cases_ciphertext,"+
    "request_digest,create_request_id from test_bench_definitions "+
    "where organization_id=$1 order by id",[tenant]);
  assert.equal(rows.length,2);
  for(const row of rows){
    assert.match(row.cases_ciphertext,version===1?/^v1:/:/^v2:oct2026:/);
    const encryptedRevision=row.archived_at?row.revision-1:row.revision;
    const plaintext=decryptTestBenchCases(row.cases_ciphertext,{
      organizationId:tenant,definitionId:row.id,
      revision:encryptedRevision,commitSha:row.source_commit_sha
    },benv);
    assert.deepEqual(JSON.parse(plaintext),row.id===activeId?originalCases:archivedCases);
    assert.equal(row.source_commit_sha,sha);
    if(row.id===activeId){
      assert.equal(row.request_digest,requestDigest);
      assert.equal(row.create_request_id,activeReq);
      assert.equal(row.revision,1);
    }else assert.equal(row.revision,2);
  }
  const run=await one(pg,"select * from test_bench_runs where id=$1",[runId]);
  assert.match(run.snapshot_ciphertext,version===1?/^v1:/:/^v2:oct2026:/);
  assert.match(run.results_ciphertext,version===1?/^v1:/:/^v2:oct2026:/);
  assert.ok(decryptTestBenchCases(run.snapshot_ciphertext,{
    organizationId:tenant,definitionId:runId,revision:1,commitSha:sha
  },benv).length>20);
  assert.equal(decryptTestBenchCases(run.results_ciphertext,{
    organizationId:tenant,definitionId:runId,revision:1,commitSha:sha
  },benv,65536),"[]");
  for(const f of ["request_id","source_commit_sha","definition_revision","status",
    "rate_card_id","reserved_micro_usd","scorecard","total_tokens","updated_at"])
    assert.deepEqual(run[f],oldRun[f]);
  const c=await one(pg,
    "select secret_fingerprint,key_version,encrypted_secret from "+
    "ai_connection_secrets where ai_connection_id=$1",[connectionId]);
  assert.equal(c.secret_fingerprint,secretFingerprint);
  assert.equal(c.key_version,version);
  assert.match(c.encrypted_secret,version===1?/^v1:/:/^v2:oct2026:/);
  assert.equal(decryptAIConnectionSecret(c.encrypted_secret,{
    organizationId:tenant,aiConnectionId:connectionId,provider:"openai"
  },aenv),originSecret);
  const cross=await one(pg,
    "select encrypted_secret,key_version from ai_connection_secrets "+
    "where ai_connection_id=$1",[foreignConnId]);
  assert.match(cross.encrypted_secret,/^v1:/);
  assert.equal(cross.key_version,1);
  assert.throws(()=>decryptAIConnectionSecret(c.encrypted_secret,{
    organizationId:foreign,aiConnectionId:connectionId,provider:"openai"
  },aenv),error=>error?.code==="ai_connection_secret_decrypt_failed");
  const audit=await one(pg,"select count(*)::int as n from audit_events "+
    "where organization_id=$1 and action='crypto_aead_v1_rewrapped'",[tenant]);
  assert.equal(audit.n,expectedAudit);
  // Existing idempotent replay must still resolve to the original ID.
  applyEnv({...benv,...aenv});
  const replay=await createTestBenchDefinitionStore(pg).create(
    actor,skillId,{name:"Synthetic active",cases:originalCases,requestId:activeReq});
  assert.equal(replay.replayed,true);
  assert.equal(replay.definition.id,activeId);
  return true;
}
async function testSnapshots(dir){
  const beforeRaw=dumpEphemeralDatabase(ctx);
  const pre=await writeEncryptedFixtureSnapshot(dir,"pre",beforeRaw,backupKey);
  beforeRaw.fill(0);
  assert.ok(pre.size>0);
  const tenantBefore=await rewrap.preview(op,tenant);
  assert.deepEqual({
    definitions:tenantBefore.definitions,runs:tenantBefore.runs,
    aiSecrets:tenantBefore.aiSecrets
  },{definitions:2,runs:1,aiSecrets:1});
  const defResult=await rewrap.rewrapNext(op,scope(tenant,"definitions"),benchV2);
  const runResult=await rewrap.rewrapNext(op,scope(tenant,"runs"),benchV2);
  const aiResult=await rewrap.rewrapNext(op,scope(tenant,"ai-secrets"),aiV2);
  assert.deepEqual([defResult.migrated,runResult.migrated,aiResult.migrated],[2,1,1]);
  assert.equal((await rewrap.preview(op,tenant)).definitions,0);
  assert.equal((await rewrap.preview(op,foreign)).aiSecrets,1);
  const afterRaw=dumpEphemeralDatabase(ctx);
  const post=await writeEncryptedFixtureSnapshot(dir,"post",afterRaw,backupKey);
  afterRaw.fill(0);
  assert.notEqual(pre.sha256,post.sha256);

  // Both an attacker-generated SHA and a wrong AES backup key must fail.
  const original=await readFile(pre.path),mutated=Buffer.from(original);
  mutated[mutated.length-1]^=1;
  assert.throws(()=>decryptFixtureBackup(mutated,backupKey),
    error=>error?.code==="synthetic_backup_integrity_failure");
  await assert.rejects(()=>readVerifiedFixtureSnapshot(pre,Buffer.alloc(32,88)),
    error=>error?.code==="synthetic_backup_integrity_failure");
  assert.deepEqual((await readdir(dir)).sort(),["post.savant-aead","pre.savant-aead"]);

  for(const [label,reference,version,audit] of [
    ["pre",pre,1,0],["post",post,2,4]
  ]){
    const name="savant_restore_"+uid+"_"+label;
    let created=false,client=null,raw=null;
    try{
      createEphemeralRestoreDatabase(ctx,name);
      created=true;restoredDbs.push(name);
      raw=await readVerifiedFixtureSnapshot(reference,backupKey);
      restoreEphemeralDatabase(ctx,name,raw);
      raw.fill(0);raw=null;
      client=postgres(restoredDatabaseUri(uri,name),{max:2,prepare:false});
      restoredConnections.push(client);
      await verify(client,{version,expectedAudit:audit});
      await client.end({timeout:5});client=null;
    }finally{
      if(raw)raw.fill(0);
      if(client)await client.end({timeout:5});
      if(created){
        dropEphemeralRestoreDatabase(ctx,name);
        restoredDbs.splice(restoredDbs.indexOf(name),1);
      }
    }
  }
  console.log(JSON.stringify({encryptedDatabaseRestore:"passed",scope:"synthetic-loopback-CI-only",
    recoveredGenerations:2,tenantClasses:2,classes:[
      "active+archived v1/v2 Test Bench cases","run snapshot and results",
      "BYO provider secret","original idempotency digest","audit records",
      "foreign tenant untouched","wrong synthetic backup key and ciphertext tamper denied"
    ],plaintextBackupFileCreated:false}));
}
try{
  applyEnv({...benchV1,...aiV1});
  await setup();
  await withPrivateBackupDirectory(testSnapshots);
}finally{
  applyEnv(previous);
  backupKey.fill(0);
  for(const client of restoredConnections)try{await client.end({timeout:2});}catch{}
  for(const name of restoredDbs)try{dropEphemeralRestoreDatabase(ctx,name);}catch{}
  for(const org of organizations)try{
    await sql.unsafe("delete from organizations where id=$1",[org]);
  }catch{}
  await sql.end({timeout:5});
}
