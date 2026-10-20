import assert from "node:assert/strict";
import test from "node:test";
import {createHarnessSigningKeyRegistry,HarnessSigningKeyError} from "./signing-key-registry.ts";

const tenant="11111111-1111-4111-8111-111111111111";
const ref="vault:"+tenant+":adapter-a:version-1";
function fixture(admin=true,secret:Uint8Array|null=Buffer.alloc(32,0x51)) {
  let dbCalls=0, vaultCalls=0, authCalls=0;
  const db=Object.assign(()=>{dbCalls++;throw Error("unexpected database call");},
    {begin:()=>{dbCalls++;throw Error("unexpected database transaction");}});
  const registry=createHarnessSigningKeyRegistry({
    sql:db as never,now:()=>new Date("2026-10-12T12:00:00Z"),
    authorizeAdmin:async()=>{authCalls++;return admin;},
    readSecret:async()=>{vaultCalls++;return secret;},
  });
  return {registry,counts:()=>({dbCalls,vaultCalls,authCalls})};
}
function activation(changes:Record<string,unknown>={}) {
  return {
    tenantId:tenant,adapterId:"adapter-a",actor:"owner",
    secretRef:ref,version:1,
    notBefore:new Date("2026-10-11T12:00:00Z"),
    expiresAt:new Date("2026-11-11T12:00:00Z"),
    ...changes,
  };
}
async function denied(code:string,action:()=>Promise<unknown>) {
  await assert.rejects(action,(e:unknown)=>e instanceof HarnessSigningKeyError && e.code===code);
}
test("PER-1059 key registry: revoked/untrusted admin cannot register or revoke",async()=>{
  const f=fixture(false);
  await denied("unauthorized",()=>f.registry.activate(activation()));
  await denied("unauthorized",()=>f.registry.revoke({tenantId:tenant,adapterId:"adapter-a",actor:"owner",version:1}));
  assert.deepEqual(f.counts(),{dbCalls:0,vaultCalls:0,authCalls:2});
});
test("PER-1059 key registry: reject malformed identity, cross-tenant vault refs, no secret and bad lifetime",async()=>{
  const invalid=[
    {tenantId:"different-tenant"}, {adapterId:"bad/adapter"},
    {secretRef:"https://private-secret"}, {secretRef:"vault:other:adapter-a:version-1"},
    {secretRef:"vault:"+tenant+":adapter-b:version-1"}, {secretRef:ref+"\ncontent"},
    {version:0}, {version:1.5},{graceMs:86400001},{graceMs:-1},
    {expiresAt:new Date("2026-10-12T12:00:00Z")},
    {expiresAt:new Date("2027-10-12T12:00:00Z")},
    {notBefore:new Date("2026-10-13T12:00:00Z")},
  ];
  for(const value of invalid) {
    const f=fixture();
    await assert.rejects(()=>f.registry.activate(activation(value)));
    assert.equal(f.counts().dbCalls,0);
  }
  for(const secret of [null,new Uint8Array(0),new Uint8Array(31),new Uint8Array(129)]) {
    const f=fixture(true,secret);
    await denied("vault_unavailable",()=>f.registry.activate(activation()));
    assert.equal(f.counts().dbCalls,0);
  }
});
test("PER-1059 key registry: no active credential is not accepted from spoofed tenant",async()=>{
  const f=fixture();
  await denied("invalid_scope",()=>f.registry.resolveSecrets("../../other","adapter-a"));
  await denied("invalid_scope",()=>f.registry.resolveSecrets(tenant,"bad/adapter"));
  assert.equal(f.counts().dbCalls,0);
});
test("PER-1059 key registry: cryptographic vault failures are sanitized",async()=>{
  const f=fixture(true,null);
  await denied("vault_unavailable",()=>f.registry.activate(activation()));
  assert.equal(f.counts().dbCalls,0);
});
