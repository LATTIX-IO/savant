import assert from "node:assert/strict";
import test from "node:test";
import type {HarnessTestRequest,HarnessAdapterCapabilities} from "@savant/types/harness-adapter";
import {createHarnessDispatchWorker} from "./dispatch-worker.ts";
const tenant="11111111-1111-4111-8111-111111111111";
const identity={tenantId:tenant,adapterId:"sandbox-adapter",workerId:"worker-a"};
const h="a".repeat(64), t="b".repeat(64);
const req:HarnessTestRequest={
  tenantId:tenant,adapterId:"sandbox-adapter",actor:"qa-reviewer",
  runId:"run-1",traceId:"trace-1",idempotencyKey:"idem-run-1",
  specVersionHash:h,testSuiteHash:t,inputRef:"fixture-one",
  budget:{maxDurationMs:5000,maxCostUsd:0.25},
  capture:{level:"metadata",retentionDays:7,residency:"us-east-1"},
};
const caps:HarnessAdapterCapabilities={
  protocol:{major:1,minor:0},adapterId:"sandbox-adapter",
  features:{execute:true,observe:true,cancel:true,events:true},
  coverage:{execution:"partial",observation:"partial"},
  limits:{maxConcurrency:2,maxDurationMs:10000,maxCostUsd:1},
};
function fixture(options:{
  noWork?:boolean;idempotent?:boolean;context?:unknown;run?:unknown;
  providerThrows?:boolean;ackThrows?:boolean;leaseUntil?:string;
}={}){
  const calls:string[]=[];
  const lease={
    tenantId:tenant,adapterId:"sandbox-adapter",runId:req.runId,
    traceId:req.traceId,idempotencyKey:req.idempotencyKey,inputRef:req.inputRef,
    specVersionHash:req.specVersionHash,testSuiteHash:req.testSuiteHash,
    leaseToken:"f".repeat(64),leaseUntil:options.leaseUntil??"2026-10-12T12:00:30.000Z",
    attempt:1,generation:1,
  };
  const result={tenantId:tenant,adapterId:"sandbox-adapter",runId:req.runId,
    externalRunId:"provider-job-1",traceId:req.traceId,
    specVersionHash:req.specVersionHash,testSuiteHash:req.testSuiteHash,status:"queued"};
  const adapter={
    durableIdempotency: options.idempotent===false?false:true,
    capabilities:caps,
    invoke:async (input:HarnessTestRequest,settings:{idempotencyKey:string;signal:AbortSignal;timeoutMs:number})=>{
      calls.push("invoke");
      assert.deepEqual(input,req);
      assert.equal(settings.idempotencyKey,req.idempotencyKey);
      assert.ok(settings.timeoutMs>0&&settings.timeoutMs<=5000);
      assert.equal(settings.signal.aborted,false);
      if(options.providerThrows)throw Error("provider-secret-do-not-expose");
      return options.run??result;
    },
  };
  const queue={
    claim:async (who:typeof identity)=>{calls.push("claim");assert.deepEqual(who,identity);return options.noWork?null:lease;},
    releaseForRetry:async (_:typeof identity,runId:string,token:string,ms:number)=>{
      calls.push("retry");
      assert.equal(runId,req.runId);assert.equal(token,lease.leaseToken);assert.equal(ms,250);
      return {state:"retry" as const,attempt:1,retryAfterMs:250};
    },
    acknowledge:async (_:typeof identity,runId:string,token:string,external:string)=>{
      calls.push("ack");
      assert.equal(runId,req.runId);assert.equal(token,lease.leaseToken);
      assert.equal(external,"provider-job-1");
      if(options.ackThrows)throw Error("late cancel");
      return {runId,externalRunId:external,status:"running" as const};
    },
  };
  const worker=createHarnessDispatchWorker({
    queue,
    nowMs:()=>Date.parse("2026-10-12T12:00:00.000Z"),
    loadAuthorizedRequest:async()=>{calls.push("load");return options.context??req;},
    resolveAdapter:async()=>{calls.push("resolve");return adapter as never;},
    audit:async event=>{calls.push("audit:"+event.outcome);},
  });
  return {worker,calls};
}
test("PER-1059: no work means no provider, storage or artifact reads",async()=>{
  const f=fixture({noWork:true});
  assert.deepEqual(await f.worker.tick(identity),{state:"idle"});
  assert.deepEqual(f.calls,["claim"]);
});
test("PER-1059: dispatch pinned, budgeted context with the original provider idempotency key",async()=>{
  const f=fixture();
  assert.deepEqual(await f.worker.tick(identity),{state:"dispatched",runId:req.runId});
  assert.deepEqual(f.calls,["claim","load","resolve","invoke","ack","audit:dispatched"]);
});
test("PER-1059: unverified provider idempotency cannot execute an AI workload",async()=>{
  const f=fixture({idempotent:false});
  assert.deepEqual(await f.worker.tick(identity),{state:"retry",runId:req.runId});
  assert.deepEqual(f.calls,["claim","load","resolve","retry","audit:adapter_idempotency_unverified"]);
});
test("PER-1059: forged tenant, run, trace, input and immutable hashes fail before provider IO",async()=>{
  for(const change of [
    {tenantId:"22222222-2222-4222-8222-222222222222"},
    {runId:"foreign-run"},{adapterId:"other-adapter"},{traceId:"wrong-trace"},
    {idempotencyKey:"changed"},{inputRef:"forged-input"},{specVersionHash:t},
    {testSuiteHash:h},
  ]){
    const f=fixture({context:{...req,...change}});
    assert.equal((await f.worker.tick(identity)).state,"retry");
    assert.ok(!f.calls.includes("invoke")&&!f.calls.includes("ack"));
  }
});
test("PER-1059: rejected raw/unknown context never reaches provider or audit",async()=>{
  const raw=Object.assign({},req,{prompt:"PRIVATE_PROMPT"});
  const f=fixture({context:raw});
  assert.equal((await f.worker.tick(identity)).state,"retry");
  assert.ok(!f.calls.includes("invoke"));
});
test("PER-1059: malformed provider response must NOT be marked running or blindly retried",async()=>{
  for(const invalid of [
    {...req,status:"running",externalRunId:"provider-1"}, // extra request-only fields
    {tenantId:"foreign",adapterId:req.adapterId,runId:req.runId,
      traceId:req.traceId,specVersionHash:h,testSuiteHash:t,externalRunId:"provider-1",status:"running"},
    {tenantId,adapterId:req.adapterId,runId:req.runId,traceId:req.traceId,
      specVersionHash:h,testSuiteHash:t,externalRunId:"provider-1",status:"succeeded"},
  ]){
    const f=fixture({run:invalid});
    assert.equal((await f.worker.tick(identity)).state,"reconciliation_required");
    assert.ok(f.calls.includes("invoke")&&!f.calls.includes("ack")&&!f.calls.includes("retry"));
  }
});
test("PER-1059: uncertain provider failure or post-dispatch cancellation require reconciliation",async()=>{
  const provider=fixture({providerThrows:true});
  assert.equal((await provider.worker.tick(identity)).state,"reconciliation_required");
  assert.ok(!provider.calls.includes("retry"));
  const raced=fixture({ackThrows:true});
  assert.equal((await raced.worker.tick(identity)).state,"reconciliation_required");
  assert.ok(!raced.calls.includes("retry"));
});
test("PER-1059: expired lease is never dispatched",async()=>{
  const f=fixture({leaseUntil:"2026-10-12T12:00:00.050Z"});
  assert.equal((await f.worker.tick(identity)).state,"retry");
  assert.ok(!f.calls.includes("invoke"));
});
