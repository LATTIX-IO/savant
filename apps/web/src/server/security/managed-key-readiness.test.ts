import assert from "node:assert/strict";
import test from "node:test";
import {inspectManagedKeyReadiness} from "./managed-key-readiness.ts";

const keyA=Buffer.alloc(32,0x11),keyB=Buffer.alloc(32,0x72);
test("PER-1551: distinct properly encoded 32-byte secrets meet shape readiness",()=>{
  const r=inspectManagedKeyReadiness({
    TEST_BENCH_ENCRYPTION_KEY:keyA.toString("base64url"),
    AI_CONNECTION_ENCRYPTION_KEY:keyB.toString("base64"),
  });
  assert.equal(r.ready,true);
  assert.deepEqual(r.missing,[]);
  assert.deepEqual(r.invalid,[]);
  assert.equal(r.domainsDistinct,true);
  assert.equal(r.versionedDualReadSupported,false);
  assert.equal(r.managedProvisioningVerified,false);
});
test("PER-1551: missing/invalid keys fail closed and cannot assert runtime readiness",()=>{
  for(const env of [
    {},
    {TEST_BENCH_ENCRYPTION_KEY:keyA.toString("hex")},
    {AI_CONNECTION_ENCRYPTION_KEY:keyB.toString("base64")},
    {TEST_BENCH_ENCRYPTION_KEY:"short",AI_CONNECTION_ENCRYPTION_KEY:keyB.toString("base64")},
    {TEST_BENCH_ENCRYPTION_KEY:keyA.toString("hex"),AI_CONNECTION_ENCRYPTION_KEY:"test"},
  ]){
    const r=inspectManagedKeyReadiness(env);
    assert.equal(r.ready,false);
    assert.ok(r.missing.length>0||r.invalid.length>0);
  }
});
test("PER-1551: reject shared secret material across both encryption domains",()=>{
  const r=inspectManagedKeyReadiness({
    TEST_BENCH_ENCRYPTION_KEY:keyA.toString("hex"),
    AI_CONNECTION_ENCRYPTION_KEY:keyA.toString("base64"),
  });
  assert.equal(r.ready,false);
  assert.equal(r.domainsDistinct,false);
});
test("PER-1551: reject malformed, ambiguous or noncanonical 32-byte encodings",()=>{
  const samples=[
    keyA.toString("base64")+" ",
    keyA.toString("base64url")+"==",
    "zz".repeat(32),
    "aa".repeat(31),
    Buffer.alloc(31,1).toString("base64url"),
    Buffer.alloc(33,1).toString("base64"),
  ];
  for(const value of samples){
    const r=inspectManagedKeyReadiness({
      TEST_BENCH_ENCRYPTION_KEY:value,
      AI_CONNECTION_ENCRYPTION_KEY:keyB.toString("base64"),
    });
    assert.equal(r.ready,false);
    assert.ok(r.invalid.includes("TEST_BENCH_ENCRYPTION_KEY"));
  }
});
test("PER-1551: output shape cannot expose secret bytes or claim rotation proof",()=>{
  const r=inspectManagedKeyReadiness({
    TEST_BENCH_ENCRYPTION_KEY:keyA.toString("base64url"),
    AI_CONNECTION_ENCRYPTION_KEY:keyB.toString("base64"),
    GIT_CREDENTIAL_ENCRYPTION_KEY:Buffer.alloc(32,0x35).toString("base64"),
  });
  const json=JSON.stringify(r);
  for(const encoded of [keyA.toString("hex"),keyA.toString("base64url"),
    keyB.toString("base64"),keyB.toString("hex")])
    assert.equal(json.includes(encoded),false);
  assert.deepEqual(Object.keys(r).sort(),[
    "ready","missing","invalid","domainsDistinct",
    "versionedDualReadSupported","managedProvisioningVerified",
  ].sort());
});
