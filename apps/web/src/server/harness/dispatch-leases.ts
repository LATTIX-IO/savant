/** Internal, tenant-scoped dispatch lease queue; not a public route or provider executor. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const MAX_ATTEMPTS=4;
type Row={
  id:string; organization_id:string; harness_run_id:string; adapter_id:string;
  worker_id:string; lease_token_sha256:string; generation:number; attempt:number;
  state:"leased"|"retry"|"acknowledged"|"exhausted";
  lease_until:Date; next_eligible_at:Date;
};
type Candidate={
  id:string; run_id:string; adapter_id:string; trace_id:string;
  idempotency_key:string; input_ref:string; spec_version_hash:string; test_suite_hash:string;
  deadline_at:Date; lease_attempt:number|null; lease_state:string|null;
};
export class HarnessDispatchError extends Error{
  readonly code:string;
  constructor(code:string){super(code);this.name="HarnessDispatchError";this.code=code;}
}
function fail(code:string):never{throw new HarnessDispatchError(code);}
function scope(tenantId:string,adapterId:string,workerId:string){
  if(typeof tenantId!=="string"||!UUID.test(tenantId)||
     typeof adapterId!=="string"||!ID.test(adapterId)||
     typeof workerId!=="string"||!ID.test(workerId))fail("unauthorized");
}
function digest(token:string){return createHash("sha256").update(token,"utf8").digest("hex");}
function tokenValid(token:string){return typeof token==="string"&&TOKEN.test(token);}
function safeEqual(a:string,b:string){
  return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
export interface DispatchIdentity{tenantId:string;adapterId:string;workerId:string;}
export function createHarnessDispatchLeaseQueue(deps:{
  sql:Sql;
  now:()=>Date;
  authorizeWorker:(identity:DispatchIdentity)=>Promise<boolean>;
}){
  const {sql}=deps;
  function clock(){
    const now=deps.now();
    if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail("invalid_configuration");
    return now;
  }
  async function authorized(identity:DispatchIdentity){
    if(!identity||typeof identity!=="object")fail("unauthorized");
    scope(identity.tenantId,identity.adapterId,identity.workerId);
    let allowed=false;
    try{allowed=await deps.authorizeWorker(identity);}catch{/* fail-closed */}
    if(!allowed)fail("unauthorized");
  }
  function checkedToken(token:string){
    if(!tokenValid(token))fail("lease_denied");
    return digest(token);
  }
  async function lockedLease(tx:TransactionSql, identity:DispatchIdentity, runId:string, token:string,at:Date){
    if(typeof runId!=="string"||!ID.test(runId))fail("lease_denied");
    const hash=checkedToken(token);
    // Global lock order: run row then lease row. Avoids deadlocks with claim,
    // cancellation, and reservation-store transitions across processes.
    const runs=await tx<{id:string}[]>`
      select id from harness_eval_runs
      where organization_id=${identity.tenantId} and adapter_id=${identity.adapterId}
        and run_id=${runId} for update
    `;
    if(!runs.length)fail("lease_denied");
    const found=await tx<Row[]>`
      select * from harness_eval_dispatch_leases
      where organization_id=${identity.tenantId} and adapter_id=${identity.adapterId}
        and harness_run_id=${runs[0]!.id} for update
    `;
    const row=found[0];
    if(!row||row.worker_id!==identity.workerId||
      !safeEqual(row.lease_token_sha256,hash)||
      row.state!=="leased"||new Date(row.lease_until).getTime()<=at.getTime())
      fail("lease_denied");
    return row;
  }
  return {
    /** Claim one due reservation; worker must pass run.idempotencyKey to the provider. */
    async claim(identity:DispatchIdentity,leaseMs=30000){
      await authorized(identity);
      if(!Number.isSafeInteger(leaseMs)||leaseMs<100||leaseMs>60000)fail("invalid_lease");
      const at=clock();
      return sql.begin(async tx=>{
        // Tenant row serializes claims with reservation and expiry decisions.
        const tenants=await tx<{id:string}[]>`
          select id from organizations where id=${identity.tenantId} for update
        `;
        if(!tenants.length)fail("not_found");
        const chosen=await tx<Candidate[]>`
          select r.id,r.run_id,r.adapter_id,r.trace_id,r.idempotency_key,
            r.input_ref,r.spec_version_hash,r.test_suite_hash,r.deadline_at,
            d.attempt as lease_attempt,d.state as lease_state
          from harness_eval_runs r
          left join harness_eval_dispatch_leases d on
            d.organization_id=r.organization_id and d.harness_run_id=r.id
          where r.organization_id=${identity.tenantId} and r.adapter_id=${identity.adapterId}
            and r.status='queued' and r.deadline_at>${at}
            and (d.id is null or (d.state in ('leased','retry') and
              d.lease_until<=${at} and d.next_eligible_at<=${at}
              and d.attempt < ${MAX_ATTEMPTS}))
          order by r.created_at,r.id
          for update of r skip locked limit 1
        `;
        const selected=chosen[0];
        if(!selected)return null;
        const attempt=Number(selected.lease_attempt??0)+1;
        const ends=new Date(Math.min(at.getTime()+leaseMs,new Date(selected.deadline_at).getTime()));
        if(ends.getTime()<=at.getTime())return null;
        const token=randomBytes(32).toString("hex");
        const hash=digest(token);
        const leased=await tx<Row[]>`
          insert into harness_eval_dispatch_leases
            (organization_id,harness_run_id,adapter_id,worker_id,lease_token_sha256,
              generation,attempt,state,lease_until,next_eligible_at,updated_at)
          values (${identity.tenantId},${selected.id},${identity.adapterId},${identity.workerId},
              ${hash},1,${attempt},'leased',${ends},${at},${at})
          on conflict (organization_id,harness_run_id) do update
          set worker_id=excluded.worker_id,lease_token_sha256=excluded.lease_token_sha256,
            generation=harness_eval_dispatch_leases.generation+1,
            attempt=excluded.attempt,state='leased',lease_until=excluded.lease_until,
            next_eligible_at=excluded.next_eligible_at,updated_at=excluded.updated_at
          returning *
        `;
        return {
          tenantId:identity.tenantId,adapterId:identity.adapterId,runId:selected.run_id,
          traceId:selected.trace_id,idempotencyKey:selected.idempotency_key,
          inputRef:selected.input_ref,specVersionHash:selected.spec_version_hash,
          testSuiteHash:selected.test_suite_hash,
          leaseToken:token,leaseUntil:ends.toISOString(),
          attempt:leased[0]!.attempt,generation:leased[0]!.generation,
        };
      });
    },
    /** Fenced renewal; expired or canceled jobs cannot be resurrected. */
    async renew(identity:DispatchIdentity,runId:string,token:string,leaseMs=30000){
      await authorized(identity);
      if(!Number.isSafeInteger(leaseMs)||leaseMs<100||leaseMs>60000)fail("invalid_lease");
      const at=clock();
      return sql.begin(async tx=>{
        const row=await lockedLease(tx,identity,runId,token,at);
        const runs=await tx<{status:string;deadline_at:Date}[]>`
          select status,deadline_at from harness_eval_runs
          where organization_id=${identity.tenantId} and id=${row.harness_run_id}
          for update
        `;
        if(runs[0]?.status!=="queued")fail("lease_denied");
        const until=new Date(Math.min(at.getTime()+leaseMs,new Date(runs[0]!.deadline_at).getTime()));
        if(until.getTime()<=at.getTime())fail("lease_denied");
        await tx`
          update harness_eval_dispatch_leases set lease_until=${until},updated_at=${at}
          where id=${row.id}
        `;
        return {leaseUntil:until.toISOString(),generation:row.generation};
      });
    },
    /** Acknowledge an already-dispatched customer harness job. Not provider execution. */
    async acknowledge(identity:DispatchIdentity,runId:string,token:string,externalRunId:string){
      await authorized(identity);
      if(typeof externalRunId!=="string"||!ID.test(externalRunId))fail("invalid_external_run");
      const at=clock();
      return sql.begin(async tx=>{
        const row=await lockedLease(tx,identity,runId,token,at);
        const runs=await tx<{status:string;deadline_at:Date}[]>`
          select status,deadline_at from harness_eval_runs
          where organization_id=${identity.tenantId} and id=${row.harness_run_id}
          for update
        `;
        if(runs[0]?.status!=="queued"||
          new Date(runs[0]!.deadline_at).getTime()<=at.getTime())fail("lease_denied");
        await tx`
          update harness_eval_runs set status='running',external_run_id=${externalRunId},
            updated_at=${at}
          where id=${row.harness_run_id} and organization_id=${identity.tenantId}
        `;
        await tx`
          update harness_eval_dispatch_leases set state='acknowledged',updated_at=${at}
          where id=${row.id}
        `;
        await tx`
          insert into harness_eval_transitions
            (organization_id,harness_run_id,action,from_status,to_status)
          values (${identity.tenantId},${row.harness_run_id},'started','queued','running')
        `;
        return {runId,externalRunId,status:"running" as const};
      });
    },
    /** Safe retry with bounded exponential eligibility; token fenced even on backoff. */
    async releaseForRetry(identity:DispatchIdentity,runId:string,token:string,delayMs:number){
      await authorized(identity);
      if(!Number.isSafeInteger(delayMs)||delayMs<100||delayMs>60000)fail("invalid_retry");
      const at=clock();
      return sql.begin(async tx=>{
        const row=await lockedLease(tx,identity,runId,token,at);
        const runs=await tx<{status:string}[]>`
          select status from harness_eval_runs
          where organization_id=${identity.tenantId} and id=${row.harness_run_id}
          for update
        `;
        if(runs[0]?.status!=="queued")fail("lease_denied");
        const state=row.attempt>=MAX_ATTEMPTS?"exhausted":"retry";
        await tx`
          update harness_eval_dispatch_leases set state=${state},lease_until=${at},
            next_eligible_at=${new Date(at.getTime()+delayMs)},updated_at=${at}
          where id=${row.id}
        `;
        return {state,attempt:row.attempt};
      });
    },
  };
}
