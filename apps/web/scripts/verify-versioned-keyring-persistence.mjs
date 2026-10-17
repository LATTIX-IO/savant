import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {
  encryptAIConnectionSecret,decryptAIConnectionSecret,
} from "../src/server/control-plane/ai-connection-secrets.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_V2_KEYRING_SCHEMA_TEST!=="1"||
  process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("PER-1550 requires isolated loopback PostgreSQL and explicit opt-in.");
const benchOld="31".repeat(32),benchNew="51".repeat(32),
 benchNext="71".repeat(32),aiOld="32".repeat(32),
 aiNew="52".repeat(32),aiNext="72".repeat(32);
const sql=postgres(uri,{max:8,prepare:false});
const store=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const unique=randomUUID().slice(0,8),pinnedSha="a".repeat(40);
const skillId="keyring-"+unique,ctxSecret={
  organizationId:"",aiConnectionId:randomUUID(),provider:"openai",
};
const cases=[{caseId:"keyring",kind:"positive",prompt:"private key migration",
  context:null,expectedBehavior:"pass"}];
const setLegacy=()=>{
  process.env.TEST_BENCH_ENCRYPTION_KEY=benchOld;
  process.env.AI_CONNECTION_ENCRYPTION_KEY=aiOld;
  delete process.env.TEST_BENCH_ENCRYPTION_KEY_ID;
  delete process.env.TEST_BENCH_LEGACY_ENCRYPTION_KEY;
  delete process.env.TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS;
  delete process.env.AI_CONNECTION_ENCRYPTION_KEY_ID;
  delete process.env.AI_CONNECTION_LEGACY_ENCRYPTION_KEY;
  delete process.env.AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS;
};
const setV2=()=>{
  process.env.TEST_BENCH_ENCRYPTION_KEY=benchNew;
  process.env.TEST_BENCH_ENCRYPTION_KEY_ID="oct2026";
  process.env.TEST_BENCH_LEGACY_ENCRYPTION_KEY=benchOld;
  process.env.AI_CONNECTION_ENCRYPTION_KEY=aiNew;
  process.env.AI_CONNECTION_ENCRYPTION_KEY_ID="oct2026";
  process.env.AI_CONNECTION_LEGACY_ENCRYPTION_KEY=aiOld;
};
const setV3=()=>{
  process.env.TEST_BENCH_ENCRYPTION_KEY=benchNext;
  process.env.TEST_BENCH_ENCRYPTION_KEY_ID="nov2026";
  process.env.TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS=JSON.stringify({oct2026:benchNew});
  process.env.AI_CONNECTION_ENCRYPTION_KEY=aiNext;
  process.env.AI_CONNECTION_ENCRYPTION_KEY_ID="nov2026";
  process.env.AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS=JSON.stringify({oct2026:aiNew});
};
setLegacy();
let orgId=null,connId=null;
const failCode=code=>e=>e?.code===code;
try{
  const [org]=await sql`insert into organizations(slug,display_name)
    values(${"keyring-"+unique},'Keyring isolated fixture') returning id`;
  orgId=org.id;ctxSecret.organizationId=orgId;
  const [repoRow]=await sql`insert into repositories(
    organization_id,provider_type,owner_name,repo_name,default_branch
  ) values(${orgId},'github','test-keyring',${"keyring-"+unique},'main')
  returning id`;
  await sql`insert into indexed_skills(
    organization_id,repository_id,skill_id,display_name,tier,status,
    source_path,source_commit_sha,content_hash
  ) values(${orgId},${repoRow.id},${skillId},'Keyring fixture',
    'tier1','active',${"skills/"+skillId},${pinnedSha},'hash')`;
  const actor={organizationId:orgId,subject:"admin",role:"admin"};
  const requestId=randomUUID();
  const before=await store.create(actor,skillId,{
    name:"Legacy suite",cases,requestId,
  });
  assert.equal(before.replayed,false);
  const [oldRow]=await sql`select cases_ciphertext,request_digest
    from test_bench_definitions where id=${before.definition.id}`;
  assert.match(oldRow.cases_ciphertext,/^v1:/);
  const originalKey=encryptAIConnectionSecret("private-fixture-credential",ctxSecret);
  assert.match(originalKey.encryptedSecret,/^v1:/);
  connId=ctxSecret.aiConnectionId;
  await sql`insert into ai_connections(
    id,organization_id,provider_type,display_name,default_model,purpose,
    usage_scope,secret_ref,status
  ) values(${connId},${orgId},'openai','Legacy key fixture',
   'test-model','QA','test-bench',${"ai-connection:"+connId},'active')`;
  await sql`insert into ai_connection_secrets(
    ai_connection_id,encrypted_secret,secret_fingerprint,algorithm,key_version
  ) values(${connId},${originalKey.encryptedSecret},
    ${originalKey.secretFingerprint},${originalKey.algorithm},
    ${originalKey.keyVersion})`;

  setV2();
  assert.deepEqual((await store.get(actor,skillId,before.definition.id)).cases,cases);
  const replay=await store.create(actor,skillId,{
    name:"Legacy suite",cases,requestId,
  });
  assert.equal(replay.replayed,true);
  assert.equal(replay.definition.id,before.definition.id);
  assert.equal((await sql`select request_digest from test_bench_definitions
    where id=${before.definition.id}`)[0].request_digest,oldRow.request_digest);
  assert.equal(decryptAIConnectionSecret(originalKey.encryptedSecret,ctxSecret),
    "private-fixture-credential");
  const updated=await store.update(actor,skillId,before.definition.id,{
    name:"Versioned suite",cases,expectedRevision:1,
  });
  assert.equal(updated.revision,2);
  const [newRow]=await sql`select cases_ciphertext from test_bench_definitions
    where id=${before.definition.id}`;
  assert.match(newRow.cases_ciphertext,/^v2:oct2026:/);
  const acceptedRun=(await runs.start(actor,skillId,before.definition.id,{
    requestId:randomUUID(),expectedRevision:2,executionSource:"platform-nim",
  })).run;
  const [runEnvelope]=await sql`select snapshot_ciphertext from test_bench_runs
    where id=${acceptedRun.id}`;
  assert.match(runEnvelope.snapshot_ciphertext,/^v2:oct2026:/);
  await assert.rejects(()=>sql`update test_bench_runs set
    snapshot_ciphertext='v2:Invalid-ID:bad:bad:bad'
    where id=${acceptedRun.id}`,e=>e?.code==="23514");
  await assert.rejects(()=>sql`update test_bench_definitions set
    cases_ciphertext='v2:INVALID:bad:bad:bad'
    where id=${before.definition.id}`,e=>e?.code==="23514");
  const v2Secret=encryptAIConnectionSecret("private-fixture-credential",ctxSecret);
  assert.match(v2Secret.encryptedSecret,/^v2:oct2026:/);
  await sql`update ai_connection_secrets set
    encrypted_secret=${v2Secret.encryptedSecret},
    key_version=${v2Secret.keyVersion} where ai_connection_id=${connId}`;
  assert.equal((await sql`select key_version from ai_connection_secrets
    where ai_connection_id=${connId}`)[0].key_version,2);

  setV3();
  assert.deepEqual((await store.get(actor,skillId,before.definition.id)).cases,cases);
  assert.equal(decryptAIConnectionSecret(v2Secret.encryptedSecret,ctxSecret),
    "private-fixture-credential");
  assert.equal(decryptAIConnectionSecret(originalKey.encryptedSecret,ctxSecret),
    "private-fixture-credential");
  const replay2=await store.create(actor,skillId,{
    name:"Legacy suite",cases,requestId,
  });
  assert.equal(replay2.replayed,true);
  assert.equal((await sql`select request_digest from test_bench_definitions
    where id=${before.definition.id}`)[0].request_digest,oldRow.request_digest);
  // Retiring a previous v2 key while ciphertext still references it is
  // an intentional decryption denial, not plaintext or fallback.
  process.env.TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS="{}";
  await assert.rejects(()=>store.get(actor,skillId,before.definition.id),
    failCode("test_bench_integrity_failure"));
  process.env.AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS="{}";
  assert.throws(()=>decryptAIConnectionSecret(v2Secret.encryptedSecret,ctxSecret),
    failCode("ai_connection_secret_decrypt_failed"));
  console.log(JSON.stringify({keyringPersistence:"passed",checks:[
    "legacy v1 DB Test Bench case and BYO secret read after v2 activation",
    "v2 Test Bench revision and queued run snapshot, persisted BYO key_version=2",
    "original request digest unchanged through two active-key rotations",
    "previous-v2 key recovery and retired key fail-closed",
    "no network, plaintext secrets, production KMS or database rewrap",
  ]}));
}finally{
  if(orgId)await sql`delete from organizations where id=${orgId}`;
  await sql.end({timeout:5});
}
