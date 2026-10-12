import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessEventQuarantine, HarnessQuarantineError } from "./event-quarantine.ts";

const org="11111111-1111-4111-8111-111111111111";
const good={
  tenantId:org,adapterId:"sandbox-adapter",runId:"run-1",
  deliveryId:"delivery-1",payloadSha256:"a".repeat(64),reason:"invalid_event" as const,
};
function fixture(){
  let calls=0;
  const fake=Object.assign(()=>{calls++;throw new Error("unexpected database I/O");},
    {begin:()=>{calls++;throw new Error("unexpected database transaction");}});
  const store=createHarnessEventQuarantine({sql:fake as never,now:()=>new Date("2026-10-12T12:00:00Z")});
  return {store,calls:()=>calls};
}
async function denied(code:string,fn:()=>Promise<unknown>){
  await assert.rejects(fn,(e:unknown)=>e instanceof HarnessQuarantineError&&e.code===code);
}
test("PER-1059 quarantine: reject invalid tenant, adapters, delivery and hashes before I/O",async()=>{
  const invalid=[
    {...good,tenantId:"invalid-tenant"},
    {...good,adapterId:"bad/path"},
    {...good,runId:"../../run"},
    {...good,deliveryId:"bad\nmessage"},
    {...good,deliveryId:"x".repeat(129)},
    {...good,payloadSha256:"z".repeat(64)},
    {...good,payloadSha256:"short"},
    {...good,reason:"raw_content"},
  ];
  for(const candidate of invalid){
    const f=fixture();
    await denied("invalid_quarantine",()=>f.store.record(candidate as typeof good));
    assert.equal(f.calls(),0);
  }
});
test("PER-1059 quarantine: tenant-unscoped purge is denied before I/O",async()=>{
  const f=fixture();
  await denied("unauthorized",()=>f.store.purgeExpired("not-an-organization-uuid"));
  assert.equal(f.calls(),0);
});
test("PER-1059 quarantine: invalid injected clock cannot create receipts",async()=>{
  let calls=0;
  const fake=Object.assign(()=>{calls++;throw Error("bad");},{begin:()=>{calls++;throw Error("bad");}});
  const store=createHarnessEventQuarantine({sql:fake as never,now:()=>new Date(NaN)});
  await denied("invalid_configuration",()=>store.record(good));
  assert.equal(calls,0);
});
