import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {
  authorizeSchemaApply,SchemaAuthorizationError,STAGING_PROJECT_ID,
  PRODUCTION_PROJECT_ID,STAGING_RECEIPT_SCHEMA
} from "./schema-apply-authorization.mjs";

const sha="a".repeat(40),digest="b".repeat(64),now=1792420000000;
const localUrl="postgresql://savant@127.0.0.1:5432/savant";
const stageUrl="postgresql://db-staging.example.neon.tech/savant_stage?sslmode=require";
const confirm="--confirm=APPLY-SAVANT-STAGING-SCHEMA";
const allChecks={
  encryptedFullPgRestore:true,
  managedLegacyAndActiveKeyRestore:true,
  testBenchV1V2Decryption:true,
  aiConnectionV1V2Decryption:true,
  requestHmacUnchanged:true,
  tenantIsolation:true,
  wrongKeyDenied:true,
  replayDenied:true,
  rollbackReady:true
};
const expectedErr=code=>e=>e instanceof SchemaAuthorizationError&&e.code===code;
function fixture(){
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const dir=mkdtempSync(join(tmpdir(),"savant-stage-gate-"));
  const trustPath=join(dir,"trusted-stage-public.pem");
  const receiptPath=join(dir,"witnessed-recovery.json");
  writeFileSync(trustPath,publicKey.export({format:"pem",type:"spki"}),{mode:0o600});
  const payload={
    schema:STAGING_RECEIPT_SCHEMA,
    issuer:"savant-owner-staging-recovery",stageProjectId:STAGING_PROJECT_ID,
    sourceCommitSha:sha,targetDatabaseHost:"db-staging.example.neon.tech",
    targetDatabaseName:"savant_stage",
    restoredDatabaseHost:"restore-staging.example.neon.tech",
    restoredDatabaseName:"savant_restore",
    backupId:"encrypted-backup-20261019",
    restoreId:"restore-run-20261019",
    testBenchKeyIds:{legacy:"tb_legacy",active:"tb_active"},
    aiConnectionKeyIds:{legacy:"ai_legacy",active:"ai_active"},
    evidenceDigest:digest,issuedAt:now-30000,expiresAt:now+30000,
    checks:structuredClone(allChecks)
  };
  function writeReceipt(content=payload,key=privateKey){
    const signature=sign(null,Buffer.from(JSON.stringify(content),"utf8"),key)
      .toString("base64url");
    writeFileSync(receiptPath,JSON.stringify({payload:content,signature}),{mode:0o600});
  }
  const env={
    SAVANT_SCHEMA_APPLY_TARGET:"staging",
    SAVANT_STAGING_VERCEL_PROJECT_ID:STAGING_PROJECT_ID,
    SAVANT_SCHEMA_EXACT_MAIN_SHA:sha,
    SAVANT_STAGING_RECOVERY_RECEIPT_FILE:receiptPath,
    SAVANT_STAGING_RECOVERY_TRUST_KEY_FILE:trustPath
  };
  writeReceipt();
  return{dir,env,payload,writeReceipt,trustPath,receiptPath,privateKey,
    authorize:(overrides={})=>authorizeSchemaApply({
      env:{...env,...overrides},argv:[confirm],databaseUrl:stageUrl,nowMs:now
    }),
    close(){rmSync(dir,{recursive:true,force:true});}
  };
}
test("PER-1556: only explicit loopback CI schema test may run without signed witness",()=>{
  const env={SAVANT_WORKFLOW_SCHEMA_TEST:"1"};
  const r=authorizeSchemaApply({databaseUrl:localUrl,env});
  assert.deepEqual(r,{scope:"isolated-loopback-test",authorized:true});
  assert.throws(()=>authorizeSchemaApply({databaseUrl:localUrl,env:{}}),
    expectedErr("loopback_schema_context_untrusted"));
  assert.throws(()=>authorizeSchemaApply({databaseUrl:localUrl,env,
    argv:[confirm]}),expectedErr("loopback_schema_context_untrusted"));
  for(const url of [
    "postgresql://savant@localhost/savant_production",
    "postgresql://admin@127.0.0.1/savant",
    "postgresql://savant@127.0.0.1/savant_stage"
  ])assert.throws(()=>authorizeSchemaApply({databaseUrl:url,env}),
    expectedErr("loopback_schema_context_untrusted"));
});
test("PER-1556: production Vercel builds and project cannot apply schema",()=>{
  const f=fixture();
  try{
    for(const env of [
      {VERCEL_ENV:"production"},
      {VERCEL:"1"},
      {VERCEL_PROJECT_ID:PRODUCTION_PROJECT_ID}
    ]){
      assert.throws(()=>f.authorize(env),expectedErr("production_schema_changes_disabled"));
      assert.throws(()=>authorizeSchemaApply({
        env:{...env,SAVANT_WORKFLOW_SCHEMA_TEST:"1"},databaseUrl:localUrl
      }),expectedErr("production_schema_changes_disabled"));
    }
  }finally{f.close();}
});
test("PER-1556: remote DDL requires exact staging project, operator intent and TLS",()=>{
  const f=fixture();
  try{
    assert.throws(()=>authorizeSchemaApply({
      env:f.env,argv:[],databaseUrl:stageUrl,nowMs:now
    }),expectedErr("remote_schema_apply_not_authorized"));
    for(const overrides of [
      {SAVANT_STAGING_VERCEL_PROJECT_ID:PRODUCTION_PROJECT_ID},
      {SAVANT_SCHEMA_APPLY_TARGET:"production"},
      {SAVANT_SCHEMA_EXACT_MAIN_SHA:"f".repeat(40)}
    ])assert.throws(()=>f.authorize(overrides),e=>e instanceof SchemaAuthorizationError);
    for(const url of [
      "postgresql://db-staging.example.neon.tech/savant_stage",
      "postgresql://db-staging.example.neon.tech/savant_stage?sslmode=disable",
      "postgresql://db-staging.example.neon.tech/savant_stage?sslmode=prefer"
    ])assert.throws(()=>authorizeSchemaApply({
      env:f.env,argv:[confirm],databaseUrl:url,nowMs:now
    }),expectedErr("staging_tls_required"));
    assert.throws(()=>authorizeSchemaApply({
      env:f.env,argv:[confirm],databaseUrl:"postgresql://different.neon.tech/savant_stage?sslmode=require",nowMs:now
    }),expectedErr("staging_receipt_target_mismatch"));
  }finally{f.close();}
});
test("PER-1556: signed owner receipt binds exact target and old/new key custody evidence",()=>{
  const f=fixture();
  try{
    const result=f.authorize();
    assert.equal(result.authorized,true);
    assert.equal(result.scope,"signed-staging-only");
    assert.equal(result.commitSha,sha);
    assert.equal(result.evidenceDigest,digest);
    for(const change of [
      x=>{x.targetDatabaseHost="different.neon.tech";},
      x=>{x.sourceCommitSha="f".repeat(40);},
      x=>{x.backupId="";},
      x=>{x.restoreId="";},
      x=>{x.stageProjectId=PRODUCTION_PROJECT_ID;},
      x=>{x.testBenchKeyIds.active=x.testBenchKeyIds.legacy;},
      x=>{x.aiConnectionKeyIds.legacy="";},
      x=>{x.restoredDatabaseHost=x.targetDatabaseHost;
        x.restoredDatabaseName=x.targetDatabaseName;},
      x=>{x.checks.wrongKeyDenied=false;},
      x=>{x.checks.encryptedFullPgRestore=false;},
      x=>{x.evidenceDigest="bad";},
      x=>{x.issuer="attacker";},
      x=>{x.expiresAt=now-1;},
      x=>{x.unexpectedField=true;}
    ]){
      const copy=structuredClone(f.payload);change(copy);f.writeReceipt(copy);
      assert.throws(()=>f.authorize(),e=>e instanceof SchemaAuthorizationError);
    }
  }finally{f.close();}
});
test("PER-1556: signatures cannot be copied to an altered payload or verified using wrong trust key",()=>{
  const f=fixture();
  try{
    const signed=JSON.parse(readFileSync(f.receiptPath,"utf8"));
    signed.payload.sourceCommitSha="f".repeat(40);
    writeFileSync(f.receiptPath,JSON.stringify(signed));
    assert.throws(()=>f.authorize(),expectedErr("recovery_proof_invalid"));
    f.writeReceipt();
    const {publicKey}=generateKeyPairSync("ed25519");
    writeFileSync(f.trustPath,publicKey.export({format:"pem",type:"spki"}));
    assert.throws(()=>f.authorize(),expectedErr("recovery_proof_invalid"));
    assert.throws(()=>f.authorize({
      SAVANT_STAGING_RECOVERY_RECEIPT_FILE:join(f.dir,"missing")
    }),expectedErr("recovery_proof_unavailable"));
  }finally{f.close();}
});
test("PER-1556: signed receipts expire, cannot be replayed and never accept unexpected flags",()=>{
  const f=fixture();
  try{
    assert.throws(()=>authorizeSchemaApply({
      env:f.env,argv:[confirm],databaseUrl:stageUrl,nowMs:now+86400000
    }),expectedErr("recovery_proof_invalid"));
    for(const argv of [
      ["--force"],["--only=foo"],["--only=0002,0002"],
      ["--only=0001","--only=0002"],[confirm,confirm],
      ["--only=0001","--confirm=BYPASS"],["--only=0001,0002,foo"]
    ])assert.throws(()=>authorizeSchemaApply({
      env:f.env,argv,databaseUrl:stageUrl,nowMs:now
    }),expectedErr("schema_args_invalid"));
    assert.equal(authorizeSchemaApply({
      env:f.env,argv:["--only=0001,0002",confirm],
      databaseUrl:stageUrl,nowMs:now
    }).authorized,true);
  }finally{f.close();}
});
test("PER-1556: schema executor imports authorization before any network or DDL",()=>{
  const body=readFileSync(new URL("./apply-db-schema.mjs",import.meta.url),"utf8");
  assert.match(body,/import \{authorizeSchemaApply,SchemaAuthorizationError\}/);
  assert.ok(body.indexOf("authorizeSchemaApply({env,argv:process.argv.slice(2),databaseUrl})")<
    body.indexOf("const sql = postgres(databaseUrl"));
  assert.match(body,/DATABASE_URL:env\.DATABASE_URL_UNPOOLED/);
  assert.match(body,/process\.exit\(1\)/);
  const build=readFileSync(new URL("./migrate-on-deploy.mjs",import.meta.url),"utf8");
  assert.match(build,/Production schema migration is disabled during builds/);
});
