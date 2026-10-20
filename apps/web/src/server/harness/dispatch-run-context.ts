/** Tenant-owned immutable execution context reconstructed from the reservation DB.
 * Never take a browser-provided request as a trusted provider dispatch context. */
import type { Sql } from "postgres";
import type { HarnessTestRequest } from "@savant/types/harness-adapter";
import { HarnessWorkerError } from "./dispatch-worker.ts";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
export interface ClaimedHarnessRun {
  tenantId:string;adapterId:string;runId:string;traceId:string;
  idempotencyKey:string;inputRef:string;specVersionHash:string;testSuiteHash:string;
}
type PersistedRun={
  organization_id:string;adapter_id:string;run_id:string;actor_subject:string;
  idempotency_key:string;trace_id:string;input_ref:string;
  spec_version_hash:string;test_suite_hash:string;status:string;deadline_at:Date;
  max_duration_ms:number;max_cost_usd:string;capture_level:string;
  retention_days:number;residency:string;
};
export interface ArtifactAuthorization {
  tenantId:string;actor:string;runId:string;specVersionHash:string;
  testSuiteHash:string;inputRef:string;
}
function deny():never {throw new HarnessWorkerError("unauthorized_context");}
export function createHarnessRunContextLoader(deps:{
  sql:Sql;now:()=>Date;
  /** MUST validate tenant actor + read access to immutable spec, suite and fixture. */
  authorizeArtifacts:(record:ArtifactAuthorization)=>Promise<boolean>;
}){
  return async function load(lease:ClaimedHarnessRun):Promise<HarnessTestRequest>{
    if(!lease||typeof lease!=="object"||typeof lease.tenantId!=="string"||
      !UUID.test(lease.tenantId)||typeof lease.adapterId!=="string"||!ID.test(lease.adapterId)||
      typeof lease.runId!=="string"||!ID.test(lease.runId))deny();
    const now=deps.now();
    if(!(now instanceof Date)||!Number.isFinite(now.getTime()))deny();
    const found=await deps.sql<PersistedRun[]>`
      select organization_id,adapter_id,run_id,actor_subject,idempotency_key,trace_id,
        input_ref,spec_version_hash,test_suite_hash,status,deadline_at,max_duration_ms,
        max_cost_usd::text,capture_level,retention_days,residency
      from harness_eval_runs
      where organization_id=${lease.tenantId} and adapter_id=${lease.adapterId}
        and run_id=${lease.runId}
    `;
    const row=found[0];
    if(!row||row.status!=="queued"||new Date(row.deadline_at).getTime()<=now.getTime()||
      row.idempotency_key!==lease.idempotencyKey||row.trace_id!==lease.traceId||
      row.input_ref!==lease.inputRef||row.spec_version_hash!==lease.specVersionHash||
      row.test_suite_hash!==lease.testSuiteHash||
      typeof row.actor_subject!=="string"||!ID.test(row.actor_subject)||
      !HASH.test(row.spec_version_hash)||!HASH.test(row.test_suite_hash))deny();
    let approved=false;
    try{approved=await deps.authorizeArtifacts({
      tenantId:lease.tenantId,actor:row.actor_subject,runId:row.run_id,
      specVersionHash:row.spec_version_hash,testSuiteHash:row.test_suite_hash,
      inputRef:row.input_ref,
    });}catch{/* fail closed, do not return provider/ACL details */}
    if(!approved)deny();
    return {
      tenantId:row.organization_id,adapterId:row.adapter_id,actor:row.actor_subject,
      runId:row.run_id,traceId:row.trace_id,idempotencyKey:row.idempotency_key,
      specVersionHash:row.spec_version_hash,testSuiteHash:row.test_suite_hash,
      inputRef:row.input_ref,
      budget:{maxDurationMs:row.max_duration_ms,maxCostUsd:Number(row.max_cost_usd)},
      capture:{level:row.capture_level as HarnessTestRequest["capture"]["level"],
        retentionDays:row.retention_days,residency:row.residency},
    };
  };
}
