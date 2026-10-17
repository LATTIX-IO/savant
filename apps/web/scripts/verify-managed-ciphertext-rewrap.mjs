import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {encryptTestBenchCases,decryptTestBenchCases} from "../src/server/test-bench/definition-crypto.ts";
import {encryptAIConnectionSecret,decryptAIConnectionSecret} from "../src/server/control-plane/ai-connection-secrets.ts";
import {createManagedCiphertextRewrapper} from "../src/server/security/managed-ciphertext-rewrap.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_CIPHER_REWRAP_TEST!=="1"||
  process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||
  process.env.SAVANT_REWRAP_EPHEMERAL_DATABASE!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("PER-1555 requires opt-in ephemeral loopback PostgreSQL.");
const sql=postgres(uri,{max:18,prepare:false});
const definitions=createTestBenchDefinitionStore(sql),runs=createObservedRunStore(sql);
const service=createManagedCiphertextRewrapper(sql);
const actor={scope:"platform-crypto-operator",subject:"ci-crypto-operator"};
const code=value=>e=>e?.code===value;
const uid=randomUUID().slice(0,8),sha="a".repeat(40);
const benchOld="31".repeat(32),benchNew="51".repeat(32);
const aiOld="32".repeat(32),aiNew="52".repeat(32);
const testOld={TEST_BENCH_ENCRYPTION_KEY:benchOld};
const testNew={
  TEST_BENCH_ENCRYPTION_KEY:benchNew,
  TEST_BENCH_ENCRYPTION_KEY_ID:"oct2026",
  TEST_BENCH_LEGACY_ENCRYPTION_KEY:benchOld,
};
const aiOldEnv={AI_CONNECTION_ENCRYPTION_KEY:aiOld};
const aiNewEnv={
  AI_CONNECTION_ENCRYPTION_KEY:aiNew,
  AI_CONNECTION_ENCRYPTION_KEY_ID:"oct2026",
  AI_CONNECTION_LEGACY_ENCRYPTION_KEY:aiOld,
};
const setEnv=env=>{
  for(const k of ["TEST_BENCH_ENCRYPTION_KEY","TEST_BENCH_ENCRYPTION_KEY_ID",
    "TEST_BENCH_LEGACY_ENCRYPTION_KEY","AI_CONNECTION_ENCRYPTION_KEY",
    "AI_CONNECTION_ENCRYPTION_KEY_ID","AI_CONNECTION_LEGACY_ENCRYPTION_KEY"]){
    if(env[k]===undefined)delete process.env[k];
    else process.env[k]=env[k];
  }
};
const fetchOne=async(query,values=[])=>{
  const rows=await sql.unsafe(query,values);return rows[0];
};
const countAudit=async(org)=>Number((await fetchOne(
  "select count(*)::int as n from audit_events "+
  "where organization_id=$1 and action='crypto_aead_v1_rewrapped'",[org])).n);
const orgs=[];
async function setup(label,howMany){
  const [org]=await sql.unsafe(
    "insert into organizations(slug,display_name) values($1,$2) returning id",
    ["rewrap-"+label+"-"+uid,"Rewrap fixture "+label]);
  orgs.push(org.id);
  const [repo]=await sql.unsafe(
    "insert into repositories(organization_id,provider_type,owner_name,"+
    "repo_name,default_branch) values($1,'github',$2,$3,'main') returning id",
    [org.id,"rewrap-"+label,"repo-"+uid]);
  const skillId="rewrap-"+label+"-"+uid;
  await sql.unsafe(
    "insert into indexed_skills(organization_id,repository_id,skill_id,"+
    "display_name,tier,status,source_path,source_commit_sha,content_hash) "+
    "values($1,$2,$3,'Rewrap fixture','tier1','active',$4,$5,'fixture')",
    [org.id,repo.id,skillId,"skills/"+skillId,sha]);
  const admin={organizationId:org.id,subject:"owner-"+label,role:"admin"};
  const defs=[];
  for(let i=0;i<howMany;i++){
    const cases=[{caseId:"c-"+i,kind:"positive",
      prompt:"PRIVATE_CASE_"+label+"_"+i,
      context:null,expectedBehavior:"PRIVATE_EXPECTED_"+i}];
    const created=await definitions.create(admin,skillId,{
      name:"v1 "+i,cases,requestId:randomUUID(),
    });
    defs.push({id:created.definition.id,cases,
      original:created.definition});
  }
  return {orgId:org.id,repoId:repo.id,skillId,admin,defs};
}
async function addCredential(organizationId,label){
  const id=randomUUID(),provider="openai",secret="sk-PRIVATE_"+label+"_FAKE_KEY";
  const context={organizationId,aiConnectionId:id,provider};
  const encrypted=encryptAIConnectionSecret(secret,context,aiOldEnv);
  await sql.unsafe(
    "insert into ai_connections(id,organization_id,provider_type,display_name,"+
    "default_model,purpose,usage_scope,secret_ref,status) "+
    "values($1,$2,$3,$4,'fixture','QA','test-bench',$5,'active')",
    [id,organizationId,provider,"Rewrap "+label,"ai-connection:"+id]);
  await sql.unsafe(
    "insert into ai_connection_secrets(ai_connection_id,encrypted_secret,"+
    "secret_fingerprint,algorithm,key_version) values($1,$2,$3,$4,$5)",
    [id,encrypted.encryptedSecret,encrypted.secretFingerprint,
      encrypted.algorithm,encrypted.keyVersion]);
  return {id,context,secret,fingerprint:encrypted.secretFingerprint,
    ciphertext:encrypted.encryptedSecret};
}
const scope=(organizationId,target,maxRows=20)=>({organizationId,target,maxRows});
try{
  setEnv({...testOld,...aiOldEnv});
  const a=await setup("a",2),b=await setup("b",1);
  const credentials=await Promise.all([
    addCredential(a.orgId,"one"),addCredential(a.orgId,"two"),
  ]);
  const foreign=await addCredential(b.orgId,"foreign");
  const run=(await runs.start(a.admin,a.skillId,a.defs[0].id,{
    requestId:randomUUID(),expectedRevision:1,
    executionSource:"platform-nim",
  })).run;
  const context={organizationId:a.orgId,definitionId:run.id,
    revision:1,commitSha:sha};
  const fixtureResults=encryptTestBenchCases("[]",context,testOld,65536);
  await sql.unsafe("update test_bench_runs set results_ciphertext=$1 where id=$2",
    [fixtureResults,run.id]);
  const beforeDefs=await sql.unsafe(
    "select id,cases_ciphertext,request_digest,revision,source_commit_sha,"+
    "updated_at from test_bench_definitions "+
    "where organization_id=$1 order by id",[a.orgId]);
  const oldRun=await fetchOne("select * from test_bench_runs where id=$1",[run.id]);
  const oldCred=await sql.unsafe(
    "select encrypted_secret,secret_fingerprint,key_version,ai_connection_id,"+
    "updated_at from ai_connection_secrets where ai_connection_id=any($1::uuid[])",
    [credentials.map(x=>x.id)]);
  const foreignBefore=await fetchOne(
    "select cases_ciphertext,request_digest from test_bench_definitions "+
    "where id=$1",[b.defs[0].id]);
  const before=await service.preview(actor,a.orgId);
  assert.equal(before.definitions,2);
  assert.equal(before.runs,1);
  assert.equal(before.aiSecrets,2);
  assert.deepEqual((await service.preview(actor,b.orgId)).definitions,1);
  await assert.rejects(()=>service.preview({...actor,scope:"tenant"},a.orgId),
    code("crypto_rewrap_operator_forbidden"));

  // Force a second-row v1 GCM integrity failure. This proves the first
  // successful UPDATE and its audit entry both ROLLBACK atomically.
  const damaged=beforeDefs[1];
  await sql.unsafe("update test_bench_definitions set cases_ciphertext=$1 "+
    "where id=$2",["v1:bad:bad:bad",damaged.id]);
  await assert.rejects(()=>service.rewrapNext(actor,scope(a.orgId,"definitions"),testNew),
    code("crypto_rewrap_transaction_aborted"));
  const afterFailure=await sql.unsafe(
    "select id,cases_ciphertext from test_bench_definitions "+
    "where organization_id=$1 order by id",[a.orgId]);
  assert.equal(afterFailure[0].cases_ciphertext,beforeDefs[0].cases_ciphertext);
  assert.equal(afterFailure[1].cases_ciphertext,"v1:bad:bad:bad");
  assert.equal(await countAudit(a.orgId),0);
  await sql.unsafe("update test_bench_definitions set cases_ciphertext=$1 "+
    "where id=$2",[damaged.cases_ciphertext,damaged.id]);

  // Concurrent/replayed invocations must not double-convert or double-audit
  // the same source despite lock contention.
  const jobs=await Promise.all(Array.from({length:12},
    ()=>service.rewrapNext(actor,scope(a.orgId,"definitions",1),testNew)));
  assert.equal(jobs.reduce((n,j)=>n+j.migrated,0),2);
  assert.equal(await countAudit(a.orgId),2);
  assert.equal((await service.preview(actor,a.orgId)).definitions,0);
  assert.equal((await service.rewrapNext(actor,scope(a.orgId,"definitions"),testNew)).migrated,0);
  const migratedDefs=await sql.unsafe(
    "select id,cases_ciphertext,request_digest,revision,source_commit_sha,"+
    "updated_at from test_bench_definitions "+
    "where organization_id=$1 order by id",[a.orgId]);
  for(let i=0;i<2;i++){
    assert.match(migratedDefs[i].cases_ciphertext,/^v2:oct2026:/);
    for(const field of ["request_digest","revision","source_commit_sha","updated_at"])
      assert.deepEqual(migratedDefs[i][field],beforeDefs[i][field]);
    const old=beforeDefs[i];
    assert.equal(decryptTestBenchCases(migratedDefs[i].cases_ciphertext,{
      organizationId:a.orgId,definitionId:old.id,revision:old.revision,
      commitSha:old.source_commit_sha,
    },testNew),decryptTestBenchCases(old.cases_ciphertext,{
      organizationId:a.orgId,definitionId:old.id,revision:old.revision,
      commitSha:old.source_commit_sha,
    },testOld));
  }
  assert.equal((await fetchOne("select cases_ciphertext from test_bench_definitions "+
    "where id=$1",[b.defs[0].id])).cases_ciphertext,foreignBefore.cases_ciphertext);

  const migratedRun=await service.rewrapNext(actor,scope(a.orgId,"runs"),testNew);
  assert.equal(migratedRun.migrated,1);
  assert.equal(migratedRun.fieldsRewrapped,2);
  const runAfter=await fetchOne("select * from test_bench_runs where id=$1",[run.id]);
  assert.match(runAfter.snapshot_ciphertext,/^v2:oct2026:/);
  assert.match(runAfter.results_ciphertext,/^v2:oct2026:/);
  assert.equal(decryptTestBenchCases(runAfter.results_ciphertext,context,testNew,65536),"[]");
  for(const field of ["request_id","source_commit_sha","definition_revision","status",
    "rate_card_id","reserved_micro_usd","scorecard","updated_at","total_tokens"])
    assert.deepEqual(runAfter[field],oldRun[field]);
  assert.equal((await service.preview(actor,a.orgId)).runs,0);

  const aiJobs=await Promise.all(Array.from({length:12},
    ()=>service.rewrapNext(actor,scope(a.orgId,"ai-secrets",1),aiNewEnv)));
  assert.equal(aiJobs.reduce((n,j)=>n+j.migrated,0),2);
  assert.equal(await countAudit(a.orgId),5);
  const aiAfter=await sql.unsafe(
    "select encrypted_secret,secret_fingerprint,key_version,ai_connection_id,"+
    "updated_at from ai_connection_secrets where ai_connection_id=any($1::uuid[])",
    [credentials.map(x=>x.id)]);
  assert.equal(aiAfter.length,2);
  for(const item of aiAfter){
    assert.match(item.encrypted_secret,/^v2:oct2026:/);
    assert.equal(item.key_version,2);
    const old=oldCred.find(c=>c.ai_connection_id===item.ai_connection_id);
    assert.equal(item.secret_fingerprint,old.secret_fingerprint);
    assert.deepEqual(item.updated_at,old.updated_at);
    const ref=credentials.find(c=>c.id===item.ai_connection_id);
    assert.equal(decryptAIConnectionSecret(item.encrypted_secret,ref.context,aiNewEnv),
      ref.secret);
  }
  const bAfter=await fetchOne(
    "select encrypted_secret from ai_connection_secrets where ai_connection_id=$1",
    [foreign.id]);
  assert.equal(bAfter.encrypted_secret,foreign.ciphertext);
  const audits=await sql.unsafe(
    "select target_type,target_ref,payload_redacted from audit_events "+
    "where organization_id=$1 and action='crypto_aead_v1_rewrapped' "+
    "order by occurred_at,id",[a.orgId]);
  assert.equal(audits.length,5);
  for(const event of audits){
    const audit=JSON.stringify(event);
    for(const secret of [
      "PRIVATE_CASE_a_0","PRIVATE_CASE_a_1","PRIVATE_EXPECTED",
      "sk-PRIVATE_","v1:","v2:","31".repeat(32),"32".repeat(32)])
      assert.equal(audit.includes(secret),false);
    assert.equal(event.payload_redacted.from,"v1");
    assert.equal(event.payload_redacted.to,"v2");
    assert.equal(event.payload_redacted.keyId,"oct2026");
    assert.match(event.payload_redacted.previousSha256,/^[a-f0-9]{64}$/);
    assert.match(event.payload_redacted.nextSha256,/^[a-f0-9]{64}$/);
  }

  // Simulate a recovery check using a pre-migration encrypted backup row and
  // its matching independently held fixture key IN A ROLLED-BACK TRANSACTION.
  // This is NOT a KMS or actual backup-system recovery qualification.
  await assert.rejects(()=>sql.begin(async tx=>{
    await tx.unsafe("update test_bench_definitions set cases_ciphertext=$1 "+
      "where id=$2",[beforeDefs[0].cases_ciphertext,beforeDefs[0].id]);
    const [restored]=await tx.unsafe(
      "select cases_ciphertext from test_bench_definitions where id=$1",
      [beforeDefs[0].id]);
    const old=beforeDefs[0];
    assert.equal(decryptTestBenchCases(restored.cases_ciphertext,{
      organizationId:a.orgId,definitionId:old.id,
      revision:old.revision,commitSha:old.source_commit_sha,
    },testOld),JSON.stringify(a.defs.find(x=>x.id===old.id).cases));
    throw Error("simulate-restoration-rollback");
  }),/simulate-restoration-rollback/);
  assert.match((await fetchOne(
    "select cases_ciphertext from test_bench_definitions where id=$1",
    [beforeDefs[0].id])).cases_ciphertext,/^v2:oct2026:/);

  // A changed AAD-bound source SHA must fail closed with no new row/audit.
  await sql.unsafe("update test_bench_definitions set "+
    "source_commit_sha=$1,cases_ciphertext=$2 where id=$3",
    ["b".repeat(40),foreignBefore.cases_ciphertext,b.defs[0].id]);
  await assert.rejects(()=>service.rewrapNext(actor,scope(b.orgId,"definitions"),testNew),
    code("crypto_rewrap_transaction_aborted"));
  assert.equal(await countAudit(b.orgId),0);
  await sql.unsafe("update test_bench_definitions set source_commit_sha=$1 "+
    "where id=$2",[sha,b.defs[0].id]);
  assert.equal((await service.preview(actor,b.orgId)).definitions,1);
  assert.equal((await service.preview(actor,a.orgId)).aiSecrets,0);
  console.log(JSON.stringify({cryptoRewrap:"passed",checks:[
    "three bounded tenant-scoped ciphertext target classes",
    "mid-batch AEAD failure rolls back both data and audit",
    "twelve concurrent resumable invocations convert each record once",
    "AAD-bound snapshot plus results and AI secret key_version=2",
    "request digests, revisions, rates and provider metadata unchanged",
    "foreign tenant ciphertext and secrets untouched",
    "redacted exact-source/target audit with no plaintext or credentials",
    "isolated fixture recovery then explicit SQL rollback",
  ]}));
}finally{
  for(const id of orgs)await sql.unsafe("delete from organizations where id=$1",[id]);
  await sql.end({timeout:5});
}
