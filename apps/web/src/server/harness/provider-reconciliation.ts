/**
 * PER-1059 read-only evidence intake for held customer-harness dispatches.
 * No automatic replay, refund, release, cancellation or terminal-state mutation.
 * Trust boundaries: authenticated operator and tenant-bound provider verifier
 * are injected; never accept a browser-supplied "verified" flag as proof.
 */
import {createHash} from "node:crypto";
import type {Sql} from "postgres";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
type ProviderState="accepted"|"not_found"|"unknown";
type Row={
  id:string; organization_id:string; adapter_id:string; run_id:string;
  idempotency_key:string; trace_id:string; lease_state:string;
};
type Receipt={provider_state:ProviderState; evidence_sha256:string; idempotency_sha256:string};
export class HarnessReconciliationError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.code=code;this.name="HarnessReconciliationError";}
}
function fail(code:string):never{throw new HarnessReconciliationError(code);}
function validScope(tenantId:string,adapterId:string,runId:string,observationId:string,actor:string){
  if(typeof tenantId!=="string"||!UUID.test(tenantId)||
    typeof adapterId!=="string"||!ID.test(adapterId)||
    typeof runId!=="string"||!ID.test(runId)||
    typeof observationId!=="string"||!ID.test(observationId)||
    typeof actor!=="string"||!ID.test(actor))fail("unauthorized");
}
function validatedEvidence(raw:unknown,original:{
  tenantId:string;adapterId:string;runId:string;idempotencyKey:string;
}):{providerState:ProviderState;evidenceSha256:string}{
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     (Object.getPrototypeOf(raw)!==Object.prototype&&Object.getPrototypeOf(raw)!==null))
    fail("invalid_evidence");
  const desc=Object.getOwnPropertyDescriptors(raw);
  const keys=["tenantId","adapterId","runId","idempotencyKey","providerState","evidenceSha256"];
  if(Object.keys(desc).length!==keys.length||
    Object.entries(desc).some(([k,d])=>!keys.includes(k)||!("value" in d)))
    fail("invalid_evidence");
  const x=raw as Record<string,unknown>;
  if(x.tenantId!==original.tenantId||x.adapterId!==original.adapterId||
    x.runId!==original.runId||x.idempotencyKey!==original.idempotencyKey||
    !["accepted","not_found","unknown"].includes(x.providerState as string)||
    typeof x.evidenceSha256!=="string"||!HASH.test(x.evidenceSha256))
    fail("invalid_evidence");
  return {providerState:x.providerState as ProviderState,evidenceSha256:x.evidenceSha256};
}
export function createHarnessProviderReconciliation(deps:{
  sql:Sql;
  now:()=>Date;
  /** Authenticated scope and role; cannot trust user-provided actor string. */
  authorizeOperator:(scope:{tenantId:string;adapterId:string;runId:string;actor:string})=>Promise<boolean>;
  /** Provider status verifier MUST authenticate the customer adapter and evidence.
   * Do not use anonymous HTTP or caller-supplied JSON for this callback. */
  verifiedLookup:(scope:{tenantId:string;adapterId:string;runId:string;
    idempotencyKey:string;traceId:string})=>Promise<unknown>;
}){
  const {sql}=deps;
  return {
    async inspectAndRecord(input:{
      tenantId:string;adapterId:string;runId:string;observationId:string;actor:string;
    }){
      if(!input||typeof input!=="object")fail("unauthorized");
      validScope(input.tenantId,input.adapterId,input.runId,input.observationId,input.actor);
      let authorized=false;
      try{authorized=await deps.authorizeOperator(input);}catch{/* fail closed */}
      if(!authorized)fail("unauthorized");
      const at=deps.now();
      if(!(at instanceof Date)||!Number.isFinite(at.getTime()))fail("invalid_configuration");
      const records=await sql<Row[]>`
        select r.id,r.organization_id,r.adapter_id,r.run_id,r.idempotency_key,
          r.trace_id,d.state as lease_state
        from harness_eval_runs r
        inner join harness_eval_dispatch_leases d on
          d.harness_run_id=r.id and d.organization_id=r.organization_id
        where r.organization_id=${input.tenantId}
          and r.adapter_id=${input.adapterId} and r.run_id=${input.runId}
          and d.state in ('dispatching','reconciliation')
      `;
      const row=records[0];
      if(!row)fail("not_found");
      let raw:unknown;
      try{
        raw=await deps.verifiedLookup({
          tenantId:input.tenantId,adapterId:input.adapterId,runId:input.runId,
          idempotencyKey:row.idempotency_key,traceId:row.trace_id,
        });
      }catch{return fail("provider_unavailable");}
      const evidence=validatedEvidence(raw,{
        tenantId:input.tenantId,adapterId:input.adapterId,runId:input.runId,
        idempotencyKey:row.idempotency_key,
      });
      const idHash=createHash("sha256").update(row.idempotency_key).digest("hex");
      return sql.begin(async tx=>{
        // Consistent global lock order: run first, lease second.
        // A joined FOR UPDATE can invert the order used by queue workers.
        const checked=await tx<{id:string;idempotency_key:string}[]>`
          select id,idempotency_key from harness_eval_runs
          where organization_id=${input.tenantId}
            and adapter_id=${input.adapterId} and run_id=${input.runId}
          for update
        `;
        const current=checked[0];
        if(!current||current.id!==row.id||
          current.idempotency_key!==row.idempotency_key)fail("state_changed");
        const lease=await tx<{state:string}[]>`
          select state from harness_eval_dispatch_leases
          where organization_id=${input.tenantId} and harness_run_id=${current.id}
          for update
        `;
        if(!lease.length||!["dispatching","reconciliation"].includes(lease[0]!.state))
          fail("state_changed");
        const prior=await tx<Receipt[]>`
          select provider_state,evidence_sha256,idempotency_sha256
          from harness_eval_reconciliation_observations
          where organization_id=${input.tenantId} and harness_run_id=${row.id}
            and observation_id=${input.observationId}
        `;
        if(prior.length){
          if(prior[0]!.provider_state!==evidence.providerState||
            prior[0]!.evidence_sha256!==evidence.evidenceSha256||
            prior[0]!.idempotency_sha256!==idHash)fail("observation_conflict");
          return {state:evidence.providerState,runId:input.runId,replay:true,
            action:"manual_reconciliation_required" as const};
        }
        await tx`
          insert into harness_eval_reconciliation_observations
            (organization_id,harness_run_id,observation_id,adapter_id,
              idempotency_sha256,evidence_sha256,provider_state,observed_at)
          values (${input.tenantId},${row.id},${input.observationId},${input.adapterId},
            ${idHash},${evidence.evidenceSha256},${evidence.providerState},${at})
        `;
        return {state:evidence.providerState,runId:input.runId,replay:false,
          action:"manual_reconciliation_required" as const};
      });
    },
  };
}
