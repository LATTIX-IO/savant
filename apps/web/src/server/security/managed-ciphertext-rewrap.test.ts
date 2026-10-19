import assert from "node:assert/strict";
import test from "node:test";
import type {Sql} from "postgres";
import {createManagedCiphertextRewrapper,RewrapDenied} from "./managed-ciphertext-rewrap.ts";

const fake={} as Sql;
const rewrapper=createManagedCiphertextRewrapper(fake);
const org="12345678-1234-4234-8234-123456789abc";
const actor={scope:"platform-crypto-operator" as const,subject:"security-operator"};
const old=Buffer.alloc(32,11).toString("base64url");
const next=Buffer.alloc(32,22).toString("base64url");
const cfg={
  TEST_BENCH_ENCRYPTION_KEY:next,TEST_BENCH_ENCRYPTION_KEY_ID:"oct2026",
  TEST_BENCH_LEGACY_ENCRYPTION_KEY:old,
};
const err=(code:string)=>(e:unknown)=>e instanceof RewrapDenied&&e.code===code;
test("PER-1555: crypto operator scope is mandatory before database access",async()=>{
  await assert.rejects(()=>rewrapper.preview({...actor,scope:"tenant"} as never,org),
    err("crypto_rewrap_operator_forbidden"));
  await assert.rejects(()=>rewrapper.preview({...actor,subject:"not valid;"} as never,org),
    err("crypto_rewrap_operator_forbidden"));
  await assert.rejects(()=>rewrapper.preview(actor,"not-a-uuid"),
    err("crypto_rewrap_tenant_scope_invalid"));
  await assert.rejects(()=>rewrapper.rewrapNext(actor,{
    organizationId:org,target:"other" as never,maxRows:1,
  },cfg),err("crypto_rewrap_target_invalid"));
});
test("PER-1555: bounded batch prevents unreviewed large rewrites",async()=>{
  for(const n of [0,21,-1,Infinity,1.5,NaN]){
    await assert.rejects(()=>rewrapper.rewrapNext(actor,{
      organizationId:org,target:"definitions",maxRows:n,
    },cfg),err("crypto_rewrap_batch_limit_invalid"));
  }
});
test("PER-1555: dual-read v2 key ID and original escrow are required",async()=>{
  await assert.rejects(()=>rewrapper.rewrapNext(actor,{
    organizationId:org,target:"definitions",maxRows:1,
  },{TEST_BENCH_ENCRYPTION_KEY:old}),err("crypto_rewrap_v2_key_required"));
  await assert.rejects(()=>rewrapper.rewrapNext(actor,{
    organizationId:org,target:"definitions",maxRows:1,
  },{TEST_BENCH_ENCRYPTION_KEY:next,
    TEST_BENCH_ENCRYPTION_KEY_ID:"oct2026",
  }),err("crypto_rewrap_keyring_unavailable"));
  await assert.rejects(()=>rewrapper.rewrapNext(actor,{
    organizationId:org,target:"ai-secrets",maxRows:1,
  },cfg),err("crypto_rewrap_keyring_unavailable"));
});
