/** Internal, metadata-only quarantine after verified HMAC and run attribution.
 * Must not be exposed without the signed-event admission verifier. */
import type { Sql } from "postgres";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_PER_RUN=250;
const MS_PER_DAY=86400000;
export class HarnessQuarantineError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.name="HarnessQuarantineError";this.code=code;}
}
function fail(code:string):never {throw new HarnessQuarantineError(code);}
export interface HarnessRejectedEvent {
  tenantId:string;
  adapterId:string;
  runId:string;
  deliveryId:string;
  payloadSha256:string;
  reason:"invalid_event";
}
export function createHarnessEventQuarantine(deps:{sql:Sql;now:()=>Date}){
  const {sql}=deps;
  function clock(){
    const value=deps.now();
    if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("invalid_configuration");
    return value;
  }
  return {
    async record(input:HarnessRejectedEvent){
      if(!input||typeof input!=="object"||
        typeof input.tenantId!=="string"||!UUID.test(input.tenantId)||
        typeof input.adapterId!=="string"||!IDENT.test(input.adapterId)||
        typeof input.runId!=="string"||!IDENT.test(input.runId)||
        typeof input.deliveryId!=="string"||!IDENT.test(input.deliveryId)||
        typeof input.payloadSha256!=="string"||!HASH.test(input.payloadSha256)||
        input.reason!=="invalid_event")fail("invalid_quarantine");
      const at=clock();
      return sql.begin(async tx=>{
        const runs=await tx<{id:string;adapter_id:string;retention_days:number}[]>`
          select id,adapter_id,retention_days from harness_eval_runs
          where organization_id=${input.tenantId} and run_id=${input.runId}
          for update
        `;
        const run=runs[0];
        if(!run||run.adapter_id!==input.adapterId)fail("not_found");
        if(run.retention_days===0)return {retained:false,replay:false};
        if(!Number.isSafeInteger(run.retention_days)||run.retention_days<0||run.retention_days>30)
          fail("invalid_configuration");
        const existing=await tx<{payload_sha256:string;reason:string}[]>`
          select payload_sha256,reason from harness_eval_event_quarantine
          where organization_id=${input.tenantId} and harness_run_id=${run.id}
            and delivery_id=${input.deliveryId}
        `;
        if(existing.length){
          if(existing[0]!.payload_sha256!==input.payloadSha256 ||
            existing[0]!.reason!==input.reason)fail("quarantine_conflict");
          return {retained:true,replay:true};
        }
        const accepted=await tx<{id:string}[]>`
          select id from harness_eval_deliveries
          where organization_id=${input.tenantId} and harness_run_id=${run.id}
            and delivery_id=${input.deliveryId}
        `;
        if(accepted.length)fail("delivery_conflict");
        const counts=await tx<{n:number}[]>`
          select count(*)::int as n from harness_eval_event_quarantine
          where organization_id=${input.tenantId} and harness_run_id=${run.id}
        `;
        if((counts[0]?.n??0)>=MAX_PER_RUN)fail("quarantine_quota");
        const expires=new Date(at.getTime()+run.retention_days*MS_PER_DAY);
        await tx`
          insert into harness_eval_event_quarantine
            (organization_id,harness_run_id,adapter_id,delivery_id,payload_sha256,
              reason,rejected_at,expires_at)
          values (${input.tenantId},${run.id},${input.adapterId},${input.deliveryId},
            ${input.payloadSha256},${input.reason},${at},${expires})
        `;
        return {retained:true,replay:false};
      });
    },
    /** Internal, tenant-authorized retention worker, not a user-facing delete. */
    async purgeExpired(tenantId:string){
      if(typeof tenantId!=="string"||!UUID.test(tenantId))fail("unauthorized");
      const at=clock();
      const removed=await sql<{id:string}[]>`
        delete from harness_eval_event_quarantine where organization_id=${tenantId}
          and expires_at<=${at} returning id
      `;
      return removed.length;
    },
  };
}
