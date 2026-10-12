import assert from "node:assert/strict";
import test from "node:test";
import {createHarnessStatusConnectorConfigStore,HarnessConnectorConfigError} from "./status-connector-config.ts";

const tenantId="11111111-1111-4111-8111-111111111111";
const adapterId="sandbox-adapter";
const endpoint="https://approved.example.com/v1/savant/status";
const secretRef=`vault:${tenantId}:${adapterId}:key-1`;
const valid={tenantId,adapterId,actor:"security-admin",endpoint,secretRef,expectedRevision:null};
async function denied(code:string,fn:()=>Promise<unknown>){
  await assert.rejects(fn,(e:unknown)=>e instanceof HarnessConnectorConfigError&&e.code===code);
}
function fixture(options:{admin?:boolean;vault?:boolean;egress?:boolean}={}){
  const calls:string[]=[];
  const sql=Object.assign(()=>{calls.push("db");throw Error("unexpected db");},
    {begin:()=>{calls.push("db");throw Error("unexpected transaction");}});
  const store=createHarnessStatusConnectorConfigStore({
    sql:sql as never,
    now:()=>new Date("2026-10-12T12:00:00Z"),
    allowedOrigins:["https://approved.example.com"],
    authorizeAdmin:async()=>{calls.push("admin");return options.admin??true;},
    attestSecret:async()=>{calls.push("vault");return options.vault??true;},
    verifyEgress:async()=>{calls.push("egress");return options.egress??true;},
  });
  return {store,calls};
}
test("PER-1059 config: unauthorized tenant admin fails before DB, vault and egress",async()=>{
  const f=fixture({admin:false});
  await denied("unauthorized",()=>f.store.save(valid));
  await denied("unauthorized",()=>f.store.activate({
    tenantId,adapterId,actor:"security-admin",expectedRevision:1,
  }));
  await denied("unauthorized",()=>f.store.disable({
    tenantId,adapterId,actor:"security-admin",expectedRevision:1,
  }));
  assert.deepEqual(f.calls,["admin","admin","admin"]);
});
test("PER-1059 config: malformed tenant, adapter and admin fail before IO",async()=>{
  const invalid=[
    {tenantId:"bad"}, {adapterId:"../other"}, {actor:"invalid/user"},
  ];
  for(const change of invalid){
    const f=fixture();
    await assert.rejects(()=>f.store.save({...valid,...change}));
    assert.ok(!f.calls.includes("db")&&!f.calls.includes("vault"));
  }
});
test("PER-1059 config: reject SSRF, foreign vault namespaces and invalid versions",async()=>{
  const invalidEndpoints=[
    "http://approved.example.com/v1/savant/status",
    "https://127.0.0.1/v1/savant/status",
    "https://localhost/v1/savant/status",
    "https://approved.example.com:8080/v1/savant/status",
    "https://name:secret@approved.example.com/v1/savant/status",
    "https://approved.example.com/v1/savant/status?token=secret",
    "https://approved.example.com/redirect",
    "https://unknown.example.com/v1/savant/status",
  ];
  for(const candidate of invalidEndpoints){
    const f=fixture();
    await denied("invalid_endpoint",()=>f.store.save({...valid,endpoint:candidate}));
    assert.ok(!f.calls.includes("vault")&&!f.calls.includes("db"));
  }
  for(const ref of ["vault:foreign:sandbox-adapter:key","https://vault.invalid","vault:"+tenantId+":other:key"]){
    const f=fixture();
    await denied("invalid_secret_ref",()=>f.store.save({...valid,secretRef:ref}));
    assert.ok(!f.calls.includes("vault")&&!f.calls.includes("db"));
  }
  for(const expectedRevision of [0,-1,1.2,Infinity]){
    const f=fixture();
    await denied("version_conflict",()=>f.store.save({...valid,expectedRevision}));
    assert.ok(!f.calls.includes("db"));
  }
});
test("PER-1059 config: vaulted key must exist prior to saving; cannot trust empty key",async()=>{
  const f=fixture({vault:false});
  await denied("credential_unavailable",()=>f.store.save(valid));
  assert.deepEqual(f.calls,["admin","vault"]);
});
test("PER-1059 config: disallowed egress and malformed read scopes fail closed",async()=>{
  const f=fixture();
  await denied("invalid_scope",()=>f.store.resolveActive("foreign","sandbox-adapter"));
  assert.deepEqual(f.calls,[]);
});
test("PER-1059 config: active connection requires PostgreSQL, not untrusted browser input",async()=>{
  const f=fixture();
  await assert.rejects(()=>f.store.resolveActive(tenantId,adapterId),/unexpected db/);
  assert.deepEqual(f.calls,["db"]);
});
