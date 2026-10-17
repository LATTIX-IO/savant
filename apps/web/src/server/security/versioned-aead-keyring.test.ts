import assert from "node:assert/strict";
import test from "node:test";
import {readKeyring,selectV2Key,VersionedKeyringError} from "./versioned-aead-keyring.ts";

const cfg={
  activeEnv:"TEST_BENCH_ENCRYPTION_KEY",
  activeIdEnv:"TEST_BENCH_ENCRYPTION_KEY_ID",
  previousEnv:"TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS",
  legacyEnv:"TEST_BENCH_LEGACY_ENCRYPTION_KEY",
  encoding:"base64url" as const,
};
const first=Buffer.alloc(32,23).toString("base64url");
const second=Buffer.alloc(32,84).toString("base64url");
const third=Buffer.alloc(32,178).toString("base64url");
const invalid=(env:Record<string,string|undefined>)=>
  assert.throws(()=>readKeyring(env,cfg),VersionedKeyringError);
test("PER-1550: pre-existing v1 key settings select old key without rotation",()=>{
  const ring=readKeyring({TEST_BENCH_ENCRYPTION_KEY:first},cfg);
  assert.equal(ring.activeId,null);
  assert.deepEqual(ring.activeKey,ring.legacyKey);
  assert.throws(()=>selectV2Key(ring,"unexpected"),VersionedKeyringError);
});
test("PER-1550: explicit versioned key ID, v1 legacy and previous lookup only",()=>{
  const ring=readKeyring({
    TEST_BENCH_ENCRYPTION_KEY:third,
    TEST_BENCH_ENCRYPTION_KEY_ID:"oct2026",
    TEST_BENCH_LEGACY_ENCRYPTION_KEY:first,
    TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:JSON.stringify({sept2026:second}),
  },cfg);
  assert.equal(ring.activeId,"oct2026");
  assert.deepEqual(selectV2Key(ring,"oct2026"),Buffer.from(third,"base64url"));
  assert.deepEqual(selectV2Key(ring,"sept2026"),Buffer.from(second,"base64url"));
  assert.deepEqual(ring.legacyKey,Buffer.from(first,"base64url"));
  for(const kid of ["missing","bad:delimiter","SEPT2026",""])assert.throws(
    ()=>selectV2Key(ring,kid),VersionedKeyringError);
});
test("PER-1550: missing legacy, ambiguous key IDs and malformed historical catalog fail closed",()=>{
  const active={
    TEST_BENCH_ENCRYPTION_KEY:second,
    TEST_BENCH_ENCRYPTION_KEY_ID:"oct2026",
    TEST_BENCH_LEGACY_ENCRYPTION_KEY:first,
  };
  invalid({...active,TEST_BENCH_LEGACY_ENCRYPTION_KEY:undefined});
  invalid({...active,TEST_BENCH_ENCRYPTION_KEY_ID:"Invalid ID"});
  invalid({...active,TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:"[]" });
  invalid({...active,TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:"not json"});
  invalid({...active,TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:JSON.stringify({oct2026:third})});
  invalid({...active,TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:JSON.stringify({sep2026:second})});
  invalid({...active,TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:JSON.stringify({sep2026:"invalid"})});
  invalid({...active,TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:JSON.stringify(
    Object.fromEntries(Array.from({length:9},(_,i)=>["old"+i,first])))});
  invalid({TEST_BENCH_ENCRYPTION_KEY:first,TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS:"{}"});
});
test("PER-1550: no key contents appear in thrown messages",()=>{
  const raw=first+"  ";
  try{readKeyring({TEST_BENCH_ENCRYPTION_KEY:raw},cfg);assert.fail("expected denial");}
  catch(error){
    assert.ok(error instanceof VersionedKeyringError);
    assert.equal(error.message.includes(first),false);
  }
});
