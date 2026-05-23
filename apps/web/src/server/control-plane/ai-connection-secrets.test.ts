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
