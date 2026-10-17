import {createHash,randomUUID} from "node:crypto";
import type {Sql} from "postgres";
import {decryptTestBenchCases,encryptTestBenchCases,
  type TestBenchCipherContext} from "../test-bench/definition-crypto.ts";
import {decryptAIConnectionSecret,encryptAIConnectionSecret,
  buildAIConnectionSecretFingerprint} from "../control-plane/ai-connection-secrets.ts";
import {readKeyring,type DomainKeyringConfig} from "./versioned-aead-keyring.ts";

/** PER-1555: privileged server-only rewrap. Not exposed by an HTTP route,
 * background worker, tenant API, client component or automatic deployment.
 * A protected maintenance job must authenticate any invoking operator.
 */
export type RewrapTarget="definitions"|"runs"|"ai-secrets";
export type RewrapOperator={scope:"platform-crypto-operator";subject:string};
export type RewrapScope={
  organizationId:string;target:RewrapTarget;maxRows:number;
};
export type RewrapBatchResult={
  batchId:string;organizationId:string;target:RewrapTarget;
  migrated:number;fieldsRewrapped:number;remaining:number;activeKeyId:string;
};
export type RewrapInventory={
  organizationId:string;definitions:number;runs:number;aiSecrets:number;
};
export class RewrapDenied extends Error{
  readonly code:string;
  constructor(code:string){
    super(code);this.name="RewrapDenied";this.code=code;
  }
}
const fail=(code:string):never=>{throw new RewrapDenied(code);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT=/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/;
const benchConfig:DomainKeyringConfig={
  activeEnv:"TEST_BENCH_ENCRYPTION_KEY",activeIdEnv:"TEST_BENCH_ENCRYPTION_KEY_ID",
  legacyEnv:"TEST_BENCH_LEGACY_ENCRYPTION_KEY",
  previousEnv:"TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS",encoding:"base64url",
};
const aiConfig:DomainKeyringConfig={
  activeEnv:"AI_CONNECTION_ENCRYPTION_KEY",activeIdEnv:"AI_CONNECTION_ENCRYPTION_KEY_ID",
  legacyEnv:"AI_CONNECTION_LEGACY_ENCRYPTION_KEY",
  previousEnv:"AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS",encoding:"base64",
};
function requireAuthorized(actor:RewrapOperator,organizationId:string):void{
  if(!actor||actor.scope!=="platform-crypto-operator"||
    typeof actor.subject!=="string"||!SUBJECT.test(actor.subject))
    fail("crypto_rewrap_operator_forbidden");
  if(typeof organizationId!=="string"||!UUID.test(organizationId))
    fail("crypto_rewrap_tenant_scope_invalid");
}
function requireTarget(value:unknown):asserts value is RewrapTarget{
  if(value!=="definitions"&&value!=="runs"&&value!=="ai-secrets")
    fail("crypto_rewrap_target_invalid");
}
function requireKeyId(target:RewrapTarget,
  env:Record<string,string|undefined>):string{
  try{
    const ring=readKeyring(env,target==="ai-secrets"?aiConfig:benchConfig);
    if(!ring.activeId)fail("crypto_rewrap_v2_key_required");
    return ring.activeId!;
  }catch{
    return fail("crypto_rewrap_keyring_unavailable");
  }
}
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const isV1=(value:string|null)=>typeof value==="string"&&value.startsWith("v1:");
type DefinitionRow={
  id:string;organization_id:string;revision:number;source_commit_sha:string;
  cases_ciphertext:string;
};
type RunRow={
  id:string;organization_id:string;definition_revision:number;
  source_commit_sha:string;snapshot_ciphertext:string;results_ciphertext:string|null;
};
type SecretRow={
  id:string;organization_id:string;provider_type:string;encrypted_secret:string;
  secret_fingerprint:string;key_version:number;
};
function rewrapBench(old:string,ctx:TestBenchCipherContext,
  env:Record<string,string|undefined>,maxBytes:16384|65536):string{
  const plaintext=decryptTestBenchCases(old,ctx,env,maxBytes);
  const next=encryptTestBenchCases(plaintext,ctx,env,maxBytes);
  if(!next.startsWith("v2:")||
    decryptTestBenchCases(next,ctx,env,maxBytes)!==plaintext)
    fail("crypto_rewrap_verification_failed");
  return next;
}
function rewrapAI(row:SecretRow,env:Record<string,string|undefined>):string{
  const ctx={organizationId:row.organization_id,aiConnectionId:row.id,
    provider:row.provider_type};
  const secret=decryptAIConnectionSecret(row.encrypted_secret,ctx,env);
  if(buildAIConnectionSecretFingerprint(secret)!==row.secret_fingerprint)
    fail("crypto_rewrap_fingerprint_mismatch");
  const encrypted=encryptAIConnectionSecret(secret,ctx,env);
  if(encrypted.keyVersion!==2||!encrypted.encryptedSecret.startsWith("v2:")||
    encrypted.secretFingerprint!==row.secret_fingerprint||
    decryptAIConnectionSecret(encrypted.encryptedSecret,ctx,env)!==secret)
    fail("crypto_rewrap_verification_failed");
  return encrypted.encryptedSecret;
}
export function createManagedCiphertextRewrapper(sql:Sql){
  const inventory=async(organizationId:string):Promise<RewrapInventory>=>{
    const d=await sql.unsafe<{n:number}[]>(
      "select count(*)::int as n from test_bench_definitions "+
      "where organization_id=$1 and left(cases_ciphertext,3)='v1:'",[organizationId]);
    const r=await sql.unsafe<{n:number}[]>(
      "select count(*)::int as n from test_bench_runs "+
      "where organization_id=$1 and (left(snapshot_ciphertext,3)='v1:' "+
      "or left(results_ciphertext,3)='v1:')",[organizationId]);
    const a=await sql.unsafe<{n:number}[]>(
      "select count(*)::int as n from ai_connection_secrets s "+
      "join ai_connections c on c.id=s.ai_connection_id "+
      "where c.organization_id=$1 and left(s.encrypted_secret,3)='v1:'",[organizationId]);
    return {organizationId,definitions:d[0]?.n??0,runs:r[0]?.n??0,aiSecrets:a[0]?.n??0};
  };
  return {
    /** Metadata-only preview: never decrypts or logs content. */
    async preview(actor:RewrapOperator,organizationId:string):Promise<RewrapInventory>{
      requireAuthorized(actor,organizationId);
      return inventory(organizationId);
    },
    /** One bounded tenant transaction. Concurrent writes are serialized by
     * row locks; failed verification or audit rolls back the entire batch.
     */
    async rewrapNext(actor:RewrapOperator,scope:RewrapScope,
      env:Record<string,string|undefined>=process.env):Promise<RewrapBatchResult>{
      requireAuthorized(actor,scope.organizationId);
      requireTarget(scope.target);
      if(!Number.isSafeInteger(scope.maxRows)||scope.maxRows<1||scope.maxRows>20)
        fail("crypto_rewrap_batch_limit_invalid");
      const keyId=requireKeyId(scope.target,env);
      const batchId=randomUUID(),organizationId=scope.organizationId;
      let migrated=0,fieldsRewrapped=0;
      try{
        await sql.begin(async tx=>{
          await tx.unsafe("set local lock_timeout = '3000ms'");
          await tx.unsafe("set local statement_timeout = '15000ms'");
          const audit=async(kind:string,rowId:string,previous:string,newValue:string,
            fieldNames:readonly string[]):Promise<void>=>{
            const redacted=JSON.stringify({
              schema:"savant.crypto-rewrap.v1",from:"v1",to:"v2",
              keyId,fieldNames,previousSha256:sha(previous),nextSha256:sha(newValue),
            });
            await tx.unsafe(
              "insert into audit_events(organization_id,actor_type,actor_ref,category,"+
              "action,target_type,target_ref,request_id,payload_redacted) "+
              "values($1,'service',$2,'security','crypto_aead_v1_rewrapped',"+
              "$3,$4,$5,$6::jsonb)",
              [organizationId,actor.subject,kind,rowId,batchId,redacted],
            );
          };
          if(scope.target==="definitions"){
            const rows=await tx.unsafe<DefinitionRow[]>(
              "select id,organization_id,revision,source_commit_sha,cases_ciphertext "+
              "from test_bench_definitions where organization_id=$1 "+
              "and left(cases_ciphertext,3)='v1:' "+
              "order by id limit $2 for update skip locked",
              [organizationId,scope.maxRows],
            );
            for(const row of rows){
              const ctx={organizationId:row.organization_id,definitionId:row.id,
                revision:row.revision,commitSha:row.source_commit_sha};
              const next=rewrapBench(row.cases_ciphertext,ctx,env,16384);
              const changed=await tx.unsafe(
                "update test_bench_definitions set cases_ciphertext=$1 "+
                "where organization_id=$2 and id=$3 and revision=$4 "+
                "and cases_ciphertext=$5 returning id",
                [next,organizationId,row.id,row.revision,row.cases_ciphertext],
              );
              if(changed.length!==1)fail("crypto_rewrap_stale_record");
              await audit("test_bench_definition",row.id,row.cases_ciphertext,
                next,["cases_ciphertext"]);
              migrated++;fieldsRewrapped++;
            }
          }else if(scope.target==="runs"){
            const rows=await tx.unsafe<RunRow[]>(
              "select id,organization_id,definition_revision,source_commit_sha,"+
              "snapshot_ciphertext,results_ciphertext from test_bench_runs "+
              "where organization_id=$1 and (left(snapshot_ciphertext,3)='v1:' "+
              "or left(results_ciphertext,3)='v1:') "+
              "order by id limit $2 for update skip locked",
              [organizationId,scope.maxRows],
            );
            for(const row of rows){
              const ctx={organizationId:row.organization_id,definitionId:row.id,
                revision:row.definition_revision,commitSha:row.source_commit_sha};
              const snapshot=isV1(row.snapshot_ciphertext)?
                rewrapBench(row.snapshot_ciphertext,ctx,env,16384):row.snapshot_ciphertext;
              const results=isV1(row.results_ciphertext)?
                rewrapBench(row.results_ciphertext!,ctx,env,65536):
                row.results_ciphertext;
              const changed=await tx.unsafe(
                "update test_bench_runs set snapshot_ciphertext=$1,results_ciphertext=$2 "+
                "where organization_id=$3 and id=$4 and definition_revision=$5 "+
                "and snapshot_ciphertext=$6 and results_ciphertext is not distinct from $7 "+
                "returning id",
                [snapshot,results,organizationId,row.id,row.definition_revision,
                  row.snapshot_ciphertext,row.results_ciphertext],
              );
              if(changed.length!==1)fail("crypto_rewrap_stale_record");
              const columns=[
                ...(snapshot!==row.snapshot_ciphertext?["snapshot_ciphertext"]:[]),
                ...(results!==row.results_ciphertext?["results_ciphertext"]:[]),
              ];
              await audit("test_bench_run",row.id,
                JSON.stringify([row.snapshot_ciphertext,row.results_ciphertext]),
                JSON.stringify([snapshot,results]),columns);
              migrated++;fieldsRewrapped+=columns.length;
            }
          }else{
            const rows=await tx.unsafe<SecretRow[]>(
              "select c.id,c.organization_id,c.provider_type,s.encrypted_secret,"+
              "s.secret_fingerprint,s.key_version from ai_connection_secrets s "+
              "join ai_connections c on c.id=s.ai_connection_id "+
              "where c.organization_id=$1 and left(s.encrypted_secret,3)='v1:' "+
              "order by c.id limit $2 for update of s,c skip locked",
              [organizationId,scope.maxRows],
            );
            for(const row of rows){
              if(row.key_version!==1)fail("crypto_rewrap_metadata_mismatch");
              const next=rewrapAI(row,env);
              const changed=await tx.unsafe(
                "update ai_connection_secrets set encrypted_secret=$1,key_version=2 "+
                "where ai_connection_id=$2 and key_version=1 "+
                "and encrypted_secret=$3 returning ai_connection_id",
                [next,row.id,row.encrypted_secret],
              );
              if(changed.length!==1)fail("crypto_rewrap_stale_record");
              await audit("ai_connection_secret",row.id,row.encrypted_secret,
                next,["encrypted_secret","key_version"]);
              migrated++;fieldsRewrapped++;
            }
          }
        });
      }catch{
        // Never return plaintext, key bytes, ciphertext or SQL parameters.
        fail("crypto_rewrap_transaction_aborted");
      }
      const remaining=await inventory(organizationId);
      return {batchId,organizationId,target:scope.target,migrated,
        fieldsRewrapped,
        remaining:scope.target==="definitions"?remaining.definitions:
          scope.target==="runs"?remaining.runs:remaining.aiSecrets,
        activeKeyId:keyId};
    },
  };
}
