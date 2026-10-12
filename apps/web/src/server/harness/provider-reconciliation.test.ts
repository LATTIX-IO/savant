import assert from "node:assert/strict";
import test from "node:test";
import {createHarnessProviderReconciliation,HarnessReconciliationError} from "./provider-reconciliation.ts";

const tenant="11111111-1111-4111-8111-111111111111";
const input={tenantId:tenant,adapterId:"adapter-1",runId:"run-1",
  observationId:"observation-1",actor:"security-operator"};
async function denied(code:string,fn:()=>Promise<unknown>){
  await assert.rejects(fn,(e:unknown)=>e instanceof HarnessReconciliationError&&e.code===code);
}
function fixture(allow=true){
  let queries=0,providers=0;
  const sql=Object.assign(()=>{queries++;throw Error("unexpected DB access");},
    {begin:()=>{queries++;throw Error("unexpected transaction");}});
  const store=createHarnessProviderReconciliation({
    sql:sql as never,now:()=>new Date("2026-10-12T12:00:00Z"),
    authorizeOperator:async()=>allow,
    verifiedLookup:async()=>{providers++;throw Error("unexpected remote");},
  });
  return {store,counts:()=>({queries,providers})};
}
test("PER-1059: invalid identity, adapter, run, observation or actor fail before IO",async()=>{
  for(const change of [
    {tenantId:"../../other"}, {adapterId:"evil/path"},{runId:"bad\nrun"},
    {observationId:"x".repeat(129)}, {actor:"bad/actor"},
  ]){
    const f=fixture();
    await denied("unauthorized",()=>f.store.inspectAndRecord({...input,...change}));
    assert.deepEqual(f.counts(),{queries:0,providers:0});
  }
});
test("PER-1059: unapproved tenant operator cannot trigger provider IO or DB reads",async()=>{
  const f=fixture(false);
  await denied("unauthorized",()=>f.store.inspectAndRecord(input));
  assert.deepEqual(f.counts(),{queries:0,providers:0});
});
test("PER-1059: operator verifier outage fails closed without leaking provider details",async()=>{
  let io=0;
  const sql=Object.assign(()=>{io++;throw Error("unexpected");},
    {begin:()=>{io++;throw Error("unexpected");}});
  const store=createHarnessProviderReconciliation({
    sql:sql as never,now:()=>new Date("2026-10-12T12:00:00Z"),
    authorizeOperator:async()=>{throw Error("secret auth error");},
    verifiedLookup:async()=>{io++;return {};},
  });
  await denied("unauthorized",()=>store.inspectAndRecord(input));
  assert.equal(io,0);
});
test("PER-1059: invalid clock rejected before persisted reconciliation",async()=>{
  let io=0;
  const sql=Object.assign(()=>{io++;throw Error("unexpected");},
    {begin:()=>{io++;throw Error("unexpected");}});
  const store=createHarnessProviderReconciliation({
    sql:sql as never,now:()=>new Date(NaN),
    authorizeOperator:async()=>true,
    verifiedLookup:async()=>{io++;return {};},
  });
  await denied("invalid_configuration",()=>store.inspectAndRecord(input));
  assert.equal(io,0);
});
