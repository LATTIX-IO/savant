import assert from "node:assert/strict";
import test from "node:test";

import {
  AIConnectionSecretStoreError,
  buildAIConnectionSecretFingerprint,
  decryptAIConnectionSecret,
  encryptAIConnectionSecret,
  readAIConnectionEncryptionKey,
} from "./ai-connection-secrets.ts";

const TEST_SECRET_ENV = {
  AI_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

const TEST_CONTEXT = {
  organizationId: "org-test-001",
  aiConnectionId: "8f1f57e3-5767-4ec6-b78e-529ad4ccd2b6",
  provider: "openai",
};

test("encryptAIConnectionSecret round-trips without exposing the raw API key", () => {
  const secretValue = "sk-test-1234567890-abcdef";
  const encrypted = encryptAIConnectionSecret(secretValue, TEST_CONTEXT, TEST_SECRET_ENV);

  assert.match(encrypted.encryptedSecret, /^v1:/);
  assert.notEqual(encrypted.encryptedSecret, secretValue);
  assert.equal(encrypted.secretFingerprint, buildAIConnectionSecretFingerprint(secretValue));
  assert.equal(
    decryptAIConnectionSecret(encrypted.encryptedSecret, TEST_CONTEXT, TEST_SECRET_ENV),
    secretValue,
  );
  assert.equal(encrypted.encryptedSecret.includes(secretValue), false);
});

test("decryptAIConnectionSecret fails closed when the context changes", () => {
  const encrypted = encryptAIConnectionSecret("sk-test-1234567890-abcdef", TEST_CONTEXT, TEST_SECRET_ENV);

  assert.throws(
    () => decryptAIConnectionSecret(encrypted.encryptedSecret, {
      ...TEST_CONTEXT,
      aiConnectionId: "16a4b067-bec7-4993-9567-a5d83b94c1be",
    }, TEST_SECRET_ENV),
    (error: unknown) => {
      assert.ok(error instanceof AIConnectionSecretStoreError);
      assert.equal(error.code, "ai_connection_secret_decrypt_failed");
      return true;
    },
  );
});

test("readAIConnectionEncryptionKey accepts 64-character hex secrets", () => {
  const key = readAIConnectionEncryptionKey({
    AI_CONNECTION_ENCRYPTION_KEY: "ab".repeat(32),
  });

  assert.ok(key);
  assert.equal(key?.length, 32);
});


test("encryptAIConnectionSecret requires a configured server-side encryption key", () => {
  assert.throws(
    () => encryptAIConnectionSecret("sk-test-1234567890-abcdef", TEST_CONTEXT, {}),
    (error: unknown) => {
      assert.ok(error instanceof AIConnectionSecretStoreError);
      assert.equal(error.code, "ai_connection_secret_key_unconfigured");
      return true;
    },
  );
});


test("PER-1550: v1 AI credentials survive a distinct v2 write key",()=>{
  const legacy=Buffer.alloc(32,0x23).toString("base64");
  const rotated={
    AI_CONNECTION_ENCRYPTION_KEY:Buffer.alloc(32,0x47).toString("base64"),
    AI_CONNECTION_ENCRYPTION_KEY_ID:"oct2026",
    AI_CONNECTION_LEGACY_ENCRYPTION_KEY:legacy,
  };
  const plain="synthetic-private-credential";
  const v1=encryptAIConnectionSecret(plain,TEST_CONTEXT,{
    AI_CONNECTION_ENCRYPTION_KEY:legacy,
  });
  assert.match(v1.encryptedSecret,/^v1:/);
  assert.equal(decryptAIConnectionSecret(v1.encryptedSecret,TEST_CONTEXT,rotated),plain);
  const v2=encryptAIConnectionSecret(plain,TEST_CONTEXT,rotated);
  assert.match(v2.encryptedSecret,/^v2:oct2026:/);
  assert.equal(v2.keyVersion,2);
  assert.equal(decryptAIConnectionSecret(v2.encryptedSecret,TEST_CONTEXT,rotated),plain);
  assert.equal(v1.secretFingerprint,v2.secretFingerprint);
  assert.throws(()=>decryptAIConnectionSecret(v2.encryptedSecret,{
    ...TEST_CONTEXT,organizationId:"other",
  },rotated),e=>e instanceof AIConnectionSecretStoreError&&
    e.code==="ai_connection_secret_decrypt_failed");
  assert.throws(()=>decryptAIConnectionSecret(
    v2.encryptedSecret.replace(":oct2026:",":otherid:"),TEST_CONTEXT,rotated),
    e=>e instanceof AIConnectionSecretStoreError&&
      e.code==="ai_connection_secret_decrypt_failed");
});
test("PER-1550: AI old v2 envelope uses an explicitly retained previous key",()=>{
  const legacy=Buffer.alloc(32,0x23).toString("base64");
  const first={
    AI_CONNECTION_ENCRYPTION_KEY:Buffer.alloc(32,0x47).toString("base64"),
    AI_CONNECTION_ENCRYPTION_KEY_ID:"oct2026",
    AI_CONNECTION_LEGACY_ENCRYPTION_KEY:legacy,
  };
  const future={
    AI_CONNECTION_ENCRYPTION_KEY:Buffer.alloc(32,0x57).toString("base64"),
    AI_CONNECTION_ENCRYPTION_KEY_ID:"nov2026",
    AI_CONNECTION_LEGACY_ENCRYPTION_KEY:legacy,
    AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS:JSON.stringify({
      oct2026:first.AI_CONNECTION_ENCRYPTION_KEY,
    }),
  };
  const old=encryptAIConnectionSecret("private",TEST_CONTEXT,first).encryptedSecret;
  assert.equal(decryptAIConnectionSecret(old,TEST_CONTEXT,future),"private");
  assert.throws(()=>decryptAIConnectionSecret(old,TEST_CONTEXT,{
    ...future,AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS:"{}",
  }),AIConnectionSecretStoreError);
  assert.throws(()=>encryptAIConnectionSecret("private",TEST_CONTEXT,{
    ...future,AI_CONNECTION_LEGACY_ENCRYPTION_KEY:undefined,
  }),e=>e instanceof AIConnectionSecretStoreError&&
    e.code==="ai_connection_secret_key_unconfigured");
});
