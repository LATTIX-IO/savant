/**
 * PER-1560: no automatic crypto migration. Invoke only from a protected,
 * reviewer-approved, authenticated maintenance runtime. A signed permit
 * is necessary, but ALSO require independently verified restored backup,
 * pre-authorized tenant DB role and escrowed KMS key ID before SQL admission.
 */
import type {Sql} from "postgres";
import {
  verifyGithubMaintenanceJwt,verifySignedMaintenanceApproval,
  MaintenanceAuthorizationError,
  type MaintenanceTrustPolicy,type SignedMaintenanceApproval,
  type VerifiedMaintenancePermit
} from "./crypto-maintenance-authorization.ts";
import type {RewrapBatchResult,RewrapOperator,RewrapScope} from "./managed-ciphertext-rewrap.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(code:string):never=>{throw new MaintenanceAuthorizationError(code);};
const safeId=(v:unknown):string=>{
  if(typeof v!=="string"||!UUID.test(v))fail("maintenance_operation_invalid");
  return v;
};
type AuditAction="crypto_maintenance_admitted"|"crypto_maintenance_started"|
  "crypto_maintenance_completed"|"crypto_maintenance_uncertain";
type Operation={id:string;state:string;organization_id:string;target:string;
  max_rows:number;approval_id:string};
function proof(permit:VerifiedMaintenancePermit){
  // Hashes and ticket only. Never write a signed JWT, raw KMS material,
  // ciphertext, provider API key, plaintext or approver signature to audit.
  return JSON.stringify({
    schema:"savant.crypto-maintenance-proof.v1",
    approvalSha256:permit.approvalSha256,backupSha256:permit.backupSha256,
    backupId:permit.backupId,headSha:permit.mainSha,changeTicket:permit.changeTicket,
    githubRunId:permit.runId,attempt:permit.runAttempt,
    keyVersion:permit.activeKeyId,target:permit.target
  });
}
export function createCryptoMaintenanceAdmissionStore(sql:Sql){
  const log=async(tx:import("postgres").TransactionSql,permit:VerifiedMaintenancePermit,
    opId:string,action:AuditAction)=>{
    await tx.unsafe(
      "insert into audit_events(organization_id,actor_type,actor_ref,category,"+
      "action,target_type,target_ref,request_id,payload_redacted) "+
      "values($1,'service',$2,'security',$3,'crypto_maintenance_operation',"+
      "$4,$5,$6::jsonb)",
      [permit.organizationId,"gha-"+permit.actorId,action,opId,permit.approvalId,
        proof(permit)]);
  };
  return {
    async reserve(permit:VerifiedMaintenancePermit):Promise<string>{
      try{
        return await sql.begin(async tx=>{
          const tenant=await tx.unsafe<{id:string}[]>(
            "select id from organizations where id=$1 for update",[permit.organizationId]);
          if(tenant.length!==1)fail("maintenance_tenant_not_found");
          const rows=await tx.unsafe<{id:string}[]>(
            "insert into crypto_maintenance_operations "+
            "(organization_id,approval_id,operator_actor_id,reviewer_actor_id,"+
            "github_run_id,github_run_attempt,target,max_rows,head_sha,"+
            "key_version,backup_id,backup_sha256,approval_sha256,change_ticket) "+
            "values($1,$2,$3::bigint,$4::bigint,$5::bigint,$6::int,$7,$8,$9,$10,$11,$12,$13,$14) "+
            "returning id",
            [permit.organizationId,permit.approvalId,permit.actorId,
              permit.reviewerId,permit.runId,permit.runAttempt,permit.target,
              permit.maxRows,permit.mainSha,permit.activeKeyId,
              permit.backupId,permit.backupSha256,permit.approvalSha256,
              permit.changeTicket]);
          const id=safeId(rows[0]?.id);
          await log(tx,permit,id,"crypto_maintenance_admitted");
          return id;
        });
      }catch{return fail("maintenance_replay_or_admission_denied");}
    },
    async start(id:string,permit:VerifiedMaintenancePermit):Promise<void>{
      safeId(id);
      try{
        await sql.begin(async tx=>{
          const rows=await tx.unsafe<Operation[]>(
            "update crypto_maintenance_operations set state='running' "+
            "where id=$1 and organization_id=$2 and approval_id=$3 "+
            "and approval_sha256=$4 and state='admitted' returning *",
            [id,permit.organizationId,permit.approvalId,permit.approvalSha256]);
          if(rows.length!==1)fail("maintenance_transition_denied");
          await log(tx,permit,id,"crypto_maintenance_started");
        });
      }catch{return fail("maintenance_transition_denied");}
    },
    async complete(id:string,permit:VerifiedMaintenancePermit,
      result:RewrapBatchResult):Promise<void>{
      safeId(id);safeId(result.batchId);
      if(result.organizationId!==permit.organizationId||
        result.target!==permit.target||result.activeKeyId!==permit.activeKeyId||
        !Number.isSafeInteger(result.migrated)||result.migrated<0||
        result.migrated>permit.maxRows)
        fail("maintenance_result_integrity_denied");
      try{
        await sql.begin(async tx=>{
          const updated=await tx.unsafe<Operation[]>(
            "update crypto_maintenance_operations "+
            "set state='completed',migrated=$5,resulting_batch_id=$6 "+
            "where id=$1 and organization_id=$2 and approval_id=$3 "+
            "and approval_sha256=$4 and state='running' returning *",
            [id,permit.organizationId,permit.approvalId,permit.approvalSha256,
              result.migrated,result.batchId]);
          if(updated.length!==1)fail("maintenance_transition_denied");
          await log(tx,permit,id,"crypto_maintenance_completed");
        });
      }catch{return fail("maintenance_completion_uncertain");}
    },
    async uncertain(id:string,permit:VerifiedMaintenancePermit):Promise<void>{
      safeId(id);
      try{
        await sql.begin(async tx=>{
          const updated=await tx.unsafe<Operation[]>(
            "update crypto_maintenance_operations set state='uncertain' "+
            "where id=$1 and organization_id=$2 and approval_id=$3 "+
            "and approval_sha256=$4 and state in ('admitted','running') returning *",
            [id,permit.organizationId,permit.approvalId,permit.approvalSha256]);
          if(updated.length!==1)fail("maintenance_transition_denied");
          await log(tx,permit,id,"crypto_maintenance_uncertain");
        });
      }catch{return fail("maintenance_uncertain_manual_reconciliation");}
    },
  };
}
export type CryptoMaintenanceExecutorDeps={
  trust:MaintenanceTrustPolicy;
  clock:()=>number;
  store:ReturnType<typeof createCryptoMaintenanceAdmissionStore>;
  /** Only an independently validated, successfully restored backup qualifies. */
  verifyRestoredBackup:(p:VerifiedMaintenancePermit)=>Promise<boolean>;
  /** Verify short-lived tenant-specific DB principal; never infer from operator scope. */
  verifyRestrictedDatabaseRole:(p:VerifiedMaintenancePermit)=>Promise<boolean>;
  /** Resolve escrowed key versions in trusted KMS; NOT from supplied JWT fields. */
  verifyManagedKeyVersions:(p:VerifiedMaintenancePermit)=>Promise<boolean>;
  /** Trusted internal invocation that actually calls createManagedCiphertextRewrapper;
   * must use key material from separately attested KMS provider, not process/global env.
   */
  rewrap:(actor:RewrapOperator,scope:RewrapScope)=>Promise<RewrapBatchResult>;
};
export function createCryptoMaintenanceExecutor(deps:CryptoMaintenanceExecutorDeps){
  return {
    /** A fail-closed one-shot execution. Uncertain outcomes never auto-retry. */
    async execute(jwt:string,approval:SignedMaintenanceApproval){
      const identity=verifyGithubMaintenanceJwt(jwt,deps.trust,deps.clock());
      const permit=verifySignedMaintenanceApproval(
        approval,identity,deps.trust,deps.clock());
      for(const verify of [
        deps.verifyRestoredBackup,
        deps.verifyRestrictedDatabaseRole,
        deps.verifyManagedKeyVersions
      ]){
        let ok=false;
        try{ok=await verify(permit);}catch{/* never disclose raw KMS/DB errors */}
        if(!ok)fail("maintenance_operational_preflight_denied");
      }
      const id=await deps.store.reserve(permit);
      try{
        await deps.store.start(id,permit);
      }catch{
        // A failed start can have committed remotely; do not execute or retry.
        fail("maintenance_start_uncertain_manual_reconciliation");
      }
      let result:RewrapBatchResult;
      try{
        result=await deps.rewrap(
          {scope:"platform-crypto-operator",subject:identity.subject},
          {organizationId:permit.organizationId,target:permit.target,
            maxRows:permit.maxRows});
        await deps.store.complete(id,permit,result);
      }catch{
        try{await deps.store.uncertain(id,permit);}catch{
          return fail("maintenance_uncertain_manual_reconciliation");
        }
        return fail("maintenance_uncertain_manual_reconciliation");
      }
      return Object.freeze({
        state:"completed" as const,operationId:id,organizationId:permit.organizationId,
        migrated:result.migrated,remaining:result.remaining,batchId:result.batchId,
        target:permit.target,activeKeyId:permit.activeKeyId
      });
    }
  };
}
