/**
 * PER-1059: one-shot server-side dispatcher for customer-owned QA harnesses.
 * Not an HTTP route, scheduler, inference gateway or general agent runtime.
 * Upstream must inject authenticated workload identity, tenant-pinned artifacts
 * and an adapter which contractually guarantees idempotent execution.
 */
import type { HarnessAdapterCapabilities, HarnessTestRequest, HarnessRun } from "@savant/types/harness-adapter";
import { parseHarnessCapabilities, validateHarnessTestRequest } from "@savant/schemas/harness-adapter";
import type { DispatchIdentity } from "./dispatch-leases.ts";
import { createHarnessDispatchLeaseQueue } from "./dispatch-leases.ts";

type LeaseQueue = ReturnType<typeof createHarnessDispatchLeaseQueue>;
type Lease = NonNullable<Awaited<ReturnType<LeaseQueue["claim"]>>>;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
export class HarnessWorkerError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.code=code;this.name="HarnessWorkerError";}
}
function fail(code:string):never{throw new HarnessWorkerError(code);}
function validatedRun(value:unknown, expected:HarnessTestRequest):HarnessRun {
  if(!value||typeof value!=="object"||Array.isArray(value)||
    (Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail("invalid_response");
  const keys=["tenantId","adapterId","runId","externalRunId","traceId",
    "specVersionHash","testSuiteHash","status"];
  const desc=Object.getOwnPropertyDescriptors(value);
  if(Object.keys(desc).length!==keys.length||
    Object.entries(desc).some(([k,d])=>!keys.includes(k)||!("value" in d)))fail("invalid_response");
  const x=value as Record<string,unknown>;
  if(x.tenantId!==expected.tenantId||x.adapterId!==expected.adapterId||
    x.runId!==expected.runId||x.traceId!==expected.traceId||
    x.specVersionHash!==expected.specVersionHash||x.testSuiteHash!==expected.testSuiteHash||
    typeof x.externalRunId!=="string"||!ID.test(x.externalRunId)||
    !["queued","running"].includes(x.status as string))fail("invalid_response");
  return Object.fromEntries(keys.map(k=>[k,x[k]])) as unknown as HarnessRun;
}
function leaseMatches(req:HarnessTestRequest,lease:Lease):boolean {
  return req.tenantId===lease.tenantId && req.adapterId===lease.adapterId &&
    req.runId===lease.runId && req.traceId===lease.traceId &&
    req.idempotencyKey===lease.idempotencyKey && req.inputRef===lease.inputRef &&
    req.specVersionHash===lease.specVersionHash && req.testSuiteHash===lease.testSuiteHash &&
    HASH.test(req.specVersionHash) && HASH.test(req.testSuiteHash);
}
export interface HarnessDispatchTransport {
  /** Trusted operator-verified external idempotency implementation.
   * False/unknown must NEVER invoke a customer harness. */
  durableIdempotency: true;
  capabilities: HarnessAdapterCapabilities;
  /** Must enforce network deadline/abort and propagate the ORIGINAL run idempotency key. */
  invoke: (request:HarnessTestRequest, options:{
    signal:AbortSignal;timeoutMs:number;idempotencyKey:string;
  })=>Promise<unknown>;
}
export interface HarnessDispatchWorkerDeps {
  queue:Pick<LeaseQueue,"claim"|"releaseForRetry"|"acknowledge">;
  nowMs:()=>number;
  /** MUST read tenant-owned pinned request + authorized Git artifacts. */
  loadAuthorizedRequest:(lease:Lease)=>Promise<unknown>;
  /** MUST verify adapter is owned by this tenant and provider config is approved. */
  resolveAdapter:(identity:DispatchIdentity)=>Promise<HarnessDispatchTransport>;
  /** Trusted metadata-only diagnostics, never raw provider exceptions. */
  audit:(event:{tenantId:string;adapterId:string;runId:string;outcome:string})=>Promise<void>;
}
export function createHarnessDispatchWorker(deps:HarnessDispatchWorkerDeps){
  return {
    async tick(identity:DispatchIdentity,leaseMs=30000):Promise<
      {state:"idle"|"dispatched"|"retry"|"reconciliation_required";runId?:string}> {
      // The queue authenticates worker scope before claims. No provider I/O
      // occurs until immutable tenant-owned run pins and adapter capability match.
      const lease=await deps.queue.claim(identity,leaseMs);
      if(!lease)return {state:"idle"};
      // Defense in depth: even a compromised/miswired queue may not switch the
      // worker's authenticated scope to another tenant or adapter.
      if(lease.tenantId!==identity.tenantId || lease.adapterId!==identity.adapterId)
        return {state:"reconciliation_required",runId:lease.runId};
      const runId=lease.runId;
      let dispatched=false;
      async function retry(outcome:string){
        try{await deps.queue.releaseForRetry(identity,runId,lease.leaseToken,250);}
        catch{return {state:"reconciliation_required" as const,runId};}
        try{await deps.audit({tenantId:lease.tenantId,adapterId:lease.adapterId,runId,outcome});}
        catch{/* audit adapter is diagnostics only; transaction log is authoritative */}
        return {state:"retry" as const,runId};
      }
      try {
        const context=await deps.loadAuthorizedRequest(lease);
        const adapter=await deps.resolveAdapter(identity);
        if(!adapter||adapter.durableIdempotency!==true) return retry("adapter_idempotency_unverified");
        const caps=parseHarnessCapabilities(adapter.capabilities);
        if(!caps.features.execute||caps.adapterId!==lease.adapterId||
          caps.coverage.execution==="unsupported")return retry("adapter_not_executable");
        const req=validateHarnessTestRequest(context,caps);
        if(!leaseMatches(req,lease))return retry("artifact_attribution_mismatch");
        const now=deps.nowMs();
        const expires=Date.parse(lease.leaseUntil);
        const timeoutMs=Math.min(req.budget.maxDurationMs,expires-now);
        if(!Number.isFinite(now)||!Number.isFinite(expires)||timeoutMs<100)
          return retry("lease_deadline");
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),timeoutMs);
        try {
          dispatched=true;
          // Adapter is obligated to honour AbortSignal and retain provider-side
          // idempotency. A crashed worker may retry; exactly-once is NOT promised.
          // Promise.race bounds the worker's wait even if a faulty adapter
          // ignores AbortSignal. It CANNOT undo provider-side side effects.
          let onAbort:()=>void=()=>{};
          const timedOut=new Promise<never>((_resolve,reject)=>{
            onAbort=()=>reject(new HarnessWorkerError("provider_timeout"));
            controller.signal.addEventListener("abort",onAbort,{once:true});
          });
          let raw:unknown;
          try {
            raw=await Promise.race([
              Promise.resolve().then(()=>adapter.invoke(req,{
                signal:controller.signal,timeoutMs,idempotencyKey:req.idempotencyKey,
              })),
              timedOut,
            ]);
          } finally {
            controller.signal.removeEventListener("abort",onAbort);
          }
          if(controller.signal.aborted)return {state:"reconciliation_required",runId};
          const result=validatedRun(raw,req);
          try {
            await deps.queue.acknowledge(identity,runId,lease.leaseToken,result.externalRunId);
          } catch {
            // Provider may have accepted work: do not retry blindly here.
            return {state:"reconciliation_required",runId};
          }
          try{await deps.audit({tenantId:lease.tenantId,adapterId:lease.adapterId,runId,outcome:"dispatched"});}
          catch{/* no raw provider payload is captured */}
          return {state:"dispatched",runId};
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        // If provider execution began, outcome may be unknown. Conservatively
        // do not resubmit until a provider idempotency reconciliation exists.
        if(dispatched)return {state:"reconciliation_required",runId};
        return retry("dispatch_preflight_failed");
      }
    },
  };
}
