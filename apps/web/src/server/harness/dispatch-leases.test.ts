import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessDispatchLeaseQueue, HarnessDispatchError } from "./dispatch-leases.ts";
const tenant="11111111-1111-4111-8111-111111111111";
const identity={tenantId:tenant,adapterId:"sandbox-adapter",workerId:"worker-1"};
async function denied(code:string, fn:()=>Promise<unknown>){
  await assert.rejects(fn,(e:unknown)=>e instanceof HarnessDispatchError&&e.code===code);
}
function fixture(allow=true){
  let dbCalls=0, authCalls=0;
  const sql=Object.assign(()=>{dbCalls++;throw Error("unexpected DB access");},
    {begin:()=>{dbCalls++;throw Error("unexpected transaction");}});
  const queue=createHarnessDispatchLeaseQueue({
    sql:sql as never,now:()=>new Date("2026-10-12T12:00:00Z"),
    authorizeWorker:async()=>{authCalls++;return allow;},
  });
  return {queue,counts:()=>({dbCalls,authCalls})};
}
test("PER-1059 dispatch queue denies unauthorized workers before SQL",async()=>{
  const f=fixture(false);
  await denied("unauthorized",()=>f.queue.claim(identity));
  await denied("unauthorized",()=>f.queue.acknowledge(identity,"run-1","a".repeat(64),"external-1"));
  await denied("unauthorized",()=>f.queue.renew(identity,"run-1","a".repeat(64)));
  await denied("unauthorized",()=>f.queue.releaseForRetry(identity,"run-1","a".repeat(64),100));
  assert.deepEqual(f.counts(),{dbCalls:0,authCalls:4});
});
test("PER-1059 dispatch queue rejects bad tenant, adapter and worker before IO",async()=>{
  for(const mutate of [
    {tenantId:"another"},{adapterId:"../../bad"},{workerId:"bad\nline"},
    {workerId:"x".repeat(150)},
  ]){
    const f=fixture();
    await denied("unauthorized",()=>f.queue.claim({...identity,...mutate}));
    assert.deepEqual(f.counts(),{dbCalls:0,authCalls:0});
  }
});
test("PER-1059 dispatch queue fails safe on worker-verifier outage",async()=>{
  let dbCalls=0;
  const sql=Object.assign(()=>{dbCalls++;throw Error("unexpected");},
    {begin:()=>{dbCalls++;throw Error("unexpected");}});
  const queue=createHarnessDispatchLeaseQueue({
    sql:sql as never,now:()=>new Date("2026-10-12T12:00:00Z"),
    authorizeWorker:async()=>{throw Error("secret authorization failure");},
  });
  await denied("unauthorized",()=>queue.claim(identity));
  assert.equal(dbCalls,0);
});
test("PER-1059 dispatch queue validates lease duration and retry backoff before DB access",async()=>{
  const f=fixture();
  for(const ms of [0,-10,99,60001,1.5,Infinity]){
    await denied("invalid_lease",()=>f.queue.claim(identity,ms));
    await denied("invalid_lease",()=>f.queue.renew(identity,"run-1","a".repeat(64),ms));
    await denied("invalid_retry",()=>f.queue.releaseForRetry(identity,"run-1","a".repeat(64),ms));
  }
  await denied("invalid_external_run",()=>f.queue.acknowledge(identity,"run-1","a".repeat(64),"../../x"));
  assert.equal(f.counts().dbCalls,0);
});
