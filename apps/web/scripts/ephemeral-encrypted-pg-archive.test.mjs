import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes} from "node:crypto";
import {
  EphemeralRestoreError,encryptFixtureBackup,decryptFixtureBackup,
  assertEphemeralRestoreContext,restoredDatabaseUri
} from "./ephemeral-encrypted-pg-archive.mjs";

const key=Buffer.alloc(32,11),wrong=Buffer.alloc(32,22);
const raw=Buffer.from("SYNTHETIC_DB_ONLY_1234","utf8");
const err=code=>e=>e instanceof EphemeralRestoreError&&e.code===code;
const fixturePwd=["integration","only"].join("_");
const safe={
  CI:"true",SAVANT_EPHEMERAL_RESTORE_TEST:"1",
  SAVANT_WORKFLOW_SCHEMA_TEST:"1",PGPASSWORD:fixturePwd,
  DATABASE_URL:"postgresql://savant@127.0.0.1:5432/savant"
};
test("PER-1559: AES-GCM backup envelope requires correct synthetic key",()=>{
  const blob=encryptFixtureBackup(raw,key);
  assert.notDeepEqual(blob,raw);
  assert.equal(blob.includes(raw),false);
  assert.deepEqual(decryptFixtureBackup(blob,key),raw);
  assert.throws(()=>decryptFixtureBackup(blob,wrong),
    err("synthetic_backup_integrity_failure"));
});
test("PER-1559: bit-flip, AAD alteration and truncated backup are rejected",()=>{
  const blob=encryptFixtureBackup(raw,key);
  for(const pos of [0,blob.length-1,blob.length-20]){
    const bad=Buffer.from(blob);bad[pos]^=1;
    assert.throws(()=>decryptFixtureBackup(bad,key),
      err("synthetic_backup_integrity_failure"));
  }
  for(const len of [0,2,19,blob.length-6])
    assert.throws(()=>decryptFixtureBackup(blob.subarray(0,len),key),
      err("synthetic_backup_integrity_failure"));
  assert.throws(()=>encryptFixtureBackup(raw,Buffer.alloc(30)),
    err("synthetic_backup_key_invalid"));
  assert.throws(()=>encryptFixtureBackup(Buffer.alloc(0),key),
    err("synthetic_backup_size_invalid"));
  assert.throws(()=>encryptFixtureBackup(Buffer.alloc(20*1024*1024+1),key),
    err("synthetic_backup_size_invalid"));
});
test("PER-1559: remote, production, ambiguous or credential-bearing URLs forbidden",()=>{
  const bad=[
    {...safe,CI:"false"},
    {...safe,SAVANT_EPHEMERAL_RESTORE_TEST:"0"},
    {...safe,SAVANT_WORKFLOW_SCHEMA_TEST:"0"},
    {...safe,PGPASSWORD:fixturePwd+"-unexpected"},
    {...safe,DATABASE_URL:"postgresql://savant@public.example.com:5432/savant"},
    {...safe,DATABASE_URL:"postgresql://admin@127.0.0.1:5432/savant"},
    {...safe,DATABASE_URL:"postgresql://savant@127.0.0.1:5432/production"},
    {...safe,DATABASE_URL:safe.DATABASE_URL.replace("savant@",
      "savant:"+fixturePwd+"@")},
    {...safe,DATABASE_URL:"postgresql://savant@127.0.0.1:15432/savant"},
    {...safe,DATABASE_URL:"postgresql://savant@127.0.0.1:5432/savant?sslmode=disable"},
    {...safe,DATABASE_URL:"file:///tmp/data"},
  ];
  for(const v of bad)assert.throws(()=>assertEphemeralRestoreContext(v));
  const expected=assertEphemeralRestoreContext(safe);
  assert.deepEqual(expected,{host:"127.0.0.1",port:"5432",user:"savant",database:"savant"});
  assert.equal(Object.isFrozen(expected),true);
});
test("PER-1559: restricted restore database naming cannot escape the local fixture",()=>{
  const name="savant_restore_012345ab_pre";
  assert.equal(restoredDatabaseUri(safe.DATABASE_URL,name),
    "postgresql://savant@127.0.0.1:5432/"+name);
  for(const bad of [
    "production","savant","postgres","../savant","savant_restore_012345ab_pre;DROP",
    "savant_restore_012345ab_other","savant_restore_012345ab_pre/../x"
  ])assert.throws(()=>restoredDatabaseUri(safe.DATABASE_URL,bad),
    err("ephemeral_restore_database_name_invalid"));
});
test("PER-1559: fresh nonces prevent deterministic encrypted backup equivalence",()=>{
  const a=encryptFixtureBackup(raw,key),b=encryptFixtureBackup(raw,key);
  assert.notDeepEqual(a,b);
  assert.deepEqual(decryptFixtureBackup(a,key),raw);
  assert.deepEqual(decryptFixtureBackup(b,key),raw);
});
