import {createPublicKey,verify} from "node:crypto";
import {readFileSync} from "node:fs";

export const STAGING_PROJECT_ID="prj_PkhjEr34pRKGKOVN2bFGzZGg2RMf";
export const PRODUCTION_PROJECT_ID="prj_0IlFmCr7MplvLgD8C3sLKgazxXwl";
export const STAGING_RECEIPT_SCHEMA="savant.staging-recovery-acceptance.v1";
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const KEY_ID=/^[a-z][a-z0-9_-]{0,31}$/;
const DB_NAME=/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/;
const DB_ROLE=/^[a-z][a-z0-9_]{2,63}$/;
const STAGING_CONFIRM="--confirm=APPLY-SAVANT-STAGING-SCHEMA";
const CHECKS=[
  "encryptedFullPgRestore",
  "managedLegacyAndActiveKeyRestore",
  "testBenchV1V2Decryption",
  "aiConnectionV1V2Decryption",
  "requestHmacUnchanged",
  "tenantIsolation",
  "wrongKeyDenied",
  "replayDenied",
  "rollbackReady"
];
export class SchemaAuthorizationError extends Error{
  constructor(code){super(code);this.name="SchemaAuthorizationError";this.code=code;}
}
function deny(code){throw new SchemaAuthorizationError(code);}
function exactKeys(obj,keys){
  return obj&&typeof obj==="object"&&!Array.isArray(obj)&&
    JSON.stringify(Object.keys(obj).sort())===JSON.stringify([...keys].sort());
}
function parseDbUrl(raw){
  if(typeof raw!=="string"||raw.length>4096||raw.includes("\n"))deny("database_target_invalid");
  let u;
  try{u=new URL(raw);}catch{deny("database_target_invalid");}
  if(!["postgres:","postgresql:"].includes(u.protocol)||!u.hostname||
    u.hash||u.searchParams.has("host"))deny("database_target_invalid");
  let name;
  try{name=decodeURIComponent(u.pathname.slice(1));}catch{deny("database_target_invalid");}
  if(!DB_NAME.test(name))deny("database_target_invalid");
  return {host:u.hostname.toLowerCase(),name,uri:u};
}
function validateOnlyArgs(argv){
  if(!Array.isArray(argv)||argv.some(x=>typeof x!=="string"))deny("schema_args_invalid");
  const only=argv.filter(x=>x.startsWith("--only="));
  if(only.length>1||only.some(x=>!/^--only=\d{4}(?:,\d{4}){0,34}$/.test(x)||
    new Set(x.slice(7).split(",")).size!==x.slice(7).split(",").length))
    deny("schema_args_invalid");
  const others=argv.filter(x=>!x.startsWith("--only="));
  if(others.length>1||(others.length===1&&others[0]!==STAGING_CONFIRM))
    deny("schema_args_invalid");
  return others.includes(STAGING_CONFIRM);
}
function verifySignedReceipt({receiptFile,publicKeyFile,nowMs}){
  let envelope,key;
  try{
    if(typeof receiptFile!=="string"||!receiptFile||
      typeof publicKeyFile!=="string"||!publicKeyFile)deny("recovery_proof_unavailable");
    envelope=JSON.parse(readFileSync(receiptFile,"utf8"));
    key=createPublicKey(readFileSync(publicKeyFile,"utf8"));
  }catch{deny("recovery_proof_unavailable");}
  if(!exactKeys(envelope,["payload","signature"])||
    key.asymmetricKeyType!=="ed25519"||
    typeof envelope.signature!=="string"||
    !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))
    deny("recovery_proof_invalid");
  let bytes;
  try{
    bytes=Buffer.from(envelope.signature,"base64url");
    if(bytes.length!==64||bytes.toString("base64url")!==envelope.signature||
      !verify(null,Buffer.from(JSON.stringify(envelope.payload),"utf8"),key,bytes))
      deny("recovery_proof_invalid");
  }catch{deny("recovery_proof_invalid");}
  const p=envelope.payload;
  if(!exactKeys(p,[
    "schema","issuer","stageProjectId","sourceCommitSha","targetDatabaseHost",
    "targetDatabaseName","targetDatabaseRole","restoredDatabaseHost","restoredDatabaseName","backupId",
    "restoreId","testBenchKeyIds","aiConnectionKeyIds","evidenceDigest",
    "issuedAt","expiresAt","checks"
  ])||p.schema!==STAGING_RECEIPT_SCHEMA||p.issuer!=="savant-owner-staging-recovery"||
  p.stageProjectId!==STAGING_PROJECT_ID||!HEX40.test(p.sourceCommitSha)||
  !HEX64.test(p.evidenceDigest)||!ID.test(p.backupId)||!ID.test(p.restoreId)||
  !DB_NAME.test(p.targetDatabaseName)||!DB_ROLE.test(p.targetDatabaseRole)||
  !DB_NAME.test(p.restoredDatabaseName)||
  typeof p.targetDatabaseHost!=="string"||typeof p.restoredDatabaseHost!=="string"||
  p.targetDatabaseHost.toLowerCase()===p.restoredDatabaseHost.toLowerCase()||
  !exactKeys(p.testBenchKeyIds,["legacy","active"])||
  !exactKeys(p.aiConnectionKeyIds,["legacy","active"])||
  ![p.testBenchKeyIds,p.aiConnectionKeyIds].every(k=>
    KEY_ID.test(k.legacy)&&KEY_ID.test(k.active)&&k.legacy!==k.active)||
  !exactKeys(p.checks,CHECKS)||!CHECKS.every(c=>p.checks[c]===true)||
  !Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||
  p.expiresAt<=p.issuedAt||p.expiresAt-p.issuedAt>86400000||
  !Number.isSafeInteger(nowMs)||nowMs<p.issuedAt||nowMs>p.expiresAt)
    deny("recovery_proof_invalid");
  return p;
}

/**
 * Authorizes only local CI PostgreSQL or receipt-bound, isolated staging DDL.
 * It does not itself perform or attest a real KMS or pg_restore operation.
 * Receipt signatures provide operator authorization, NOT provider evidence.
 */
export function authorizeSchemaApply({
  env=process.env,argv=[],databaseUrl,nowMs=Date.now()
}={}){
  const db=parseDbUrl(databaseUrl),confirmed=validateOnlyArgs(argv);
  // Build workers, production project and all production-designated executions
  // must never be able to execute DDL through this tool.
  if(env.VERCEL_ENV==="production"||env.VERCEL==="1"||
     env.VERCEL_PROJECT_ID===PRODUCTION_PROJECT_ID)
    deny("production_schema_changes_disabled");
  const loopback=["localhost","127.0.0.1","::1"].includes(db.host);
  if(loopback){
    if(env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||confirmed||
      db.name!=="savant"||db.uri.username!=="savant"||
      env.SAVANT_SCHEMA_APPLY_TARGET==="staging")
      deny("loopback_schema_context_untrusted");
    return Object.freeze({scope:"isolated-loopback-test",authorized:true});
  }
  if(!confirmed||env.SAVANT_SCHEMA_APPLY_TARGET!=="staging"||
    env.SAVANT_STAGING_VERCEL_PROJECT_ID!==STAGING_PROJECT_ID||
    !HEX40.test(env.SAVANT_SCHEMA_EXACT_MAIN_SHA||""))
    deny("remote_schema_apply_not_authorized");
  const sslmode=db.uri.searchParams.get("sslmode");
  if(!["require","verify-full","verify-ca"].includes(sslmode)||
    [...db.uri.searchParams.keys()].some(k=>!["sslmode","channel_binding"].includes(k))||
    (db.uri.searchParams.has("channel_binding")&&
      !["prefer","require"].includes(db.uri.searchParams.get("channel_binding"))))
    deny("staging_tls_required");
  const proof=verifySignedReceipt({
    receiptFile:env.SAVANT_STAGING_RECOVERY_RECEIPT_FILE,
    publicKeyFile:env.SAVANT_STAGING_RECOVERY_TRUST_KEY_FILE,nowMs
  });
  if(proof.sourceCommitSha!==env.SAVANT_SCHEMA_EXACT_MAIN_SHA||
    proof.targetDatabaseHost.toLowerCase()!==db.host||
    proof.targetDatabaseName!==db.name||
    proof.targetDatabaseRole!==db.uri.username||
    proof.restoredDatabaseHost.toLowerCase()===db.host||
    env.SAVANT_SCHEMA_APPLY_TARGET!=="staging")
    deny("staging_receipt_target_mismatch");
  return Object.freeze({scope:"signed-staging-only",authorized:true,
    commitSha:proof.sourceCommitSha,evidenceDigest:proof.evidenceDigest});
}
