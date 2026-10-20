import assert from "node:assert/strict";
import {generateKeyPairSync, randomBytes, sign} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import {
  authorizeProductionMvpSchemaApply, PRODUCTION_PROJECT_ID,
  PRODUCTION_RECEIPT_SCHEMA, PRODUCTION_CONFIRM, PRODUCTION_ONLY,
  PRODUCTION_MIGRATIONS, ProductionSchemaAuthorizationError
} from "./production-schema-authorization.mjs";

const sha="a".repeat(40),digest="b".repeat(64),now=1792512000000;
const sourceUrl=new URL("postgresql://ep-prod.us-east-1.aws.neon.tech/savant?sslmode=require");
sourceUrl.username="owner";
sourceUrl.password=randomBytes(16).toString("hex");
const url=sourceUrl.toString();
const deny=code=>error=>error instanceof ProductionSchemaAuthorizationError && error.code===code;
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),"savant-prod-mvp-"));
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const receipt=join(dir,"receipt.json"),trust=join(dir,"trusted.pem");
  writeFileSync(trust,publicKey.export({type:"spki",format:"pem"}),{mode:0o600});
  const payload={
    schema:PRODUCTION_RECEIPT_SCHEMA,
    issuer:"savant-owner-production-mvp",
    repository:"LATTIX-IO/savant",
    vercelProjectId:PRODUCTION_PROJECT_ID,
    neonProjectId:"neonprod_1234",
    sourceCommitSha:sha,
    targetDatabaseHost:"ep-prod.us-east-1.aws.neon.tech",
    targetDatabaseName:"savant",
    targetDatabaseRole:"owner",
    recoveryPointId:"snapshot_abc123",
    restoredBranchId:"branch_abc123",
    restoredDatabaseHost:"ep-recovery.us-east-1.aws.neon.tech",
    evidenceDigest:digest,
    issuedAt:now-1000,
    expiresAt:now+1000,
    checks:{
      productionRecoveryPointVerified:true,
      restoreOnDistinctComputeVerified:true,
      rollbackRevisionVerified:true,
      syntheticTenantScopeVerified:true,
    },
  };
  const env={
    SAVANT_SCHEMA_APPLY_TARGET:"production-mvp",
    SAVANT_PRODUCTION_VERCEL_PROJECT_ID:PRODUCTION_PROJECT_ID,
    SAVANT_PRODUCTION_NEON_PROJECT_ID:payload.neonProjectId,
    SAVANT_SCHEMA_EXACT_MAIN_SHA:sha,
    SAVANT_PRODUCTION_RECOVERY_RECEIPT_FILE:receipt,
    SAVANT_PRODUCTION_RECOVERY_TRUST_KEY_FILE:trust,
  };
  function signReceipt(data=payload,key=privateKey) {
    writeFileSync(receipt,JSON.stringify({payload:data,signature:sign(null,
      Buffer.from(JSON.stringify(data),"utf8"),key).toString("base64url")}),{mode:0o600});
  }
  signReceipt();
  const run=(options={})=>authorizeProductionMvpSchemaApply({
    env:{...env,...options.env},
    argv:options.argv??[PRODUCTION_ONLY,PRODUCTION_CONFIRM],
    databaseUrl:options.databaseUrl??url,
    nowMs:options.nowMs??now
  });
  return {dir,env,payload,receipt,trust,signReceipt,run,close:()=>rmSync(dir,{recursive:true,force:true})};
}

test("PER-1592: owner receipt permits only explicit full reviewed 0015-0035 production migration",()=>{
  const f=fixture();
  try {
    assert.deepEqual(f.run(),{scope:"signed-production-mvp",authorized:true,
      commitSha:sha,evidenceDigest:digest});
    assert.equal(PRODUCTION_MIGRATIONS.length,21);
    assert.deepEqual(PRODUCTION_MIGRATIONS,
      Array.from({length:21},(_,i)=>String(i+15).padStart(4,"0")));
  }finally{f.close();}
});

test("PER-1592: Vercel runtime, build and CI can never invoke production DDL",()=>{
  const f=fixture();try{
    for(const e of [{VERCEL:"1"},{VERCEL_ENV:"production"},
      {VERCEL_ENV:"preview"},{CI:"true"},{GITHUB_ACTIONS:"true"}])
      assert.throws(()=>f.run({env:e}),deny("production_migration_runtime_disallowed"));
    for(const e of [{SAVANT_SCHEMA_APPLY_TARGET:"staging"},
      {SAVANT_SCHEMA_APPLY_TARGET:"production"},
      {SAVANT_PRODUCTION_VERCEL_PROJECT_ID:"prj_other"},
      {SAVANT_SCHEMA_EXACT_MAIN_SHA:"f".repeat(40)},
      {SAVANT_PRODUCTION_NEON_PROJECT_ID:"unknown"}])
      assert.throws(()=>f.run({env:e}),e=>e instanceof ProductionSchemaAuthorizationError);
  }finally{f.close();}
});

test("PER-1592: arbitrary subset/override/confirmation missing is denied",()=>{
  const f=fixture();try{
    for(const argv of [[],[PRODUCTION_CONFIRM], [PRODUCTION_ONLY],
      ["--only=0023",PRODUCTION_CONFIRM],
      ["--only=0001,0002",PRODUCTION_CONFIRM],
      [PRODUCTION_ONLY,"--confirm=FORCE"],["--force",PRODUCTION_CONFIRM],
      [PRODUCTION_ONLY,PRODUCTION_CONFIRM,PRODUCTION_CONFIRM]]) {
      assert.throws(()=>f.run({argv}),deny("production_migration_args_invalid"));
    }
  }finally{f.close();}
});

test("PER-1592: reject pooled, unencrypted, wrong host/db/role and URL injection",()=>{
  const f=fixture();try{
    for(const databaseUrl of [
      url.replace("ep-prod","ep-prod-pooler"),
      url.replace("sslmode=require","sslmode=disable"),
      url.replace("sslmode=require","sslmode=prefer"),
      url.replace("sslmode=require","sslmode=require&options=-csearch_path%3Dpublic"),
      url.replace("postgresql:","https:"),
      url.replace("ep-prod","ep-forged"),
      url.replace("/savant?","/main?"),
      url.replace("//owner:","//superuser:"),
      url.replace("neon.tech","attacker.example"),
      url.replace(sourceUrl.password,sourceUrl.password+"%0Ainjected")
    ])assert.throws(()=>f.run({databaseUrl}),e=>e instanceof ProductionSchemaAuthorizationError,databaseUrl.includes("password")?"invalid URL":"invalid");
  }finally{f.close();}
});

test("PER-1592: require complete independent recovery evidence and signed expiry",()=>{
  const f=fixture();try{
    for(const change of [
      p=>{p.checks.productionRecoveryPointVerified=false;},
      p=>{p.checks.restoreOnDistinctComputeVerified=false;},
      p=>{p.checks.syntheticTenantScopeVerified=false;},
      p=>{p.checks.rollbackRevisionVerified=false;},
      p=>{p.restoredDatabaseHost=p.targetDatabaseHost.toUpperCase();},
      p=>{p.recoveryPointId=p.restoredBranchId;},
      p=>{p.sourceCommitSha="f".repeat(40);},
      p=>{p.targetDatabaseRole="postgres";},
      p=>{p.vercelProjectId="prj_not-production";},
      p=>{p.neonProjectId="neon-other-project";},
      p=>{p.repository="attacker/repository";},
      p=>{p.evidenceDigest="";},
      p=>{p.unexpected=true;},
      p=>{p.issuedAt=now+10000;},
      p=>{p.expiresAt=now+31*60*1000;}
    ]) {
      const p=structuredClone(f.payload);change(p);f.signReceipt(p);
      assert.throws(()=>f.run(),e=>e instanceof ProductionSchemaAuthorizationError);
    }
    f.signReceipt();
    assert.throws(()=>f.run({nowMs:now+10000}),
      deny("production_recovery_proof_invalid"));
    const signed=JSON.parse(readFileSync(f.receipt,"utf8"));
    signed.payload.sourceCommitSha="f".repeat(40);
    writeFileSync(f.receipt,JSON.stringify(signed));
    assert.throws(()=>f.run(),deny("production_recovery_proof_invalid"));
    f.signReceipt();
    const other=generateKeyPairSync("ed25519").publicKey;
    writeFileSync(f.trust,other.export({type:"spki",format:"pem"}));
    assert.throws(()=>f.run(),deny("production_recovery_proof_invalid"));
  }finally{f.close();}
});

test("PER-1592: no secret-bearing CI steps or automatic production schema execution",()=>{
  const source=readFileSync(new URL("./apply-db-schema.mjs",import.meta.url),"utf8");
  const build=readFileSync(new URL("./migrate-on-deploy.mjs",import.meta.url),"utf8");
  const authorize=source.indexOf("authorizeProductionMvpSchemaApply(");
  const sql=source.indexOf("const sql = postgres(databaseUrl");
  assert.ok(authorize>=0 && sql>authorize);
  const preflight=source.indexOf("assertStagingRoleReadiness(");
  const mutate=source.indexOf("for (const schemaFile of schemaFiles)");
  assert.ok(preflight>sql && mutate>preflight);
  assert.match(source,/DATABASE_URL_UNPOOLED/);
  assert.match(build,/if \(process\.env\.VERCEL_ENV === "production"\)/);
  assert.doesNotMatch(build,/production-mvp/);
});
