import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const AI_CONNECTION_ENCRYPTION_ENV_NAME = "AI_CONNECTION_ENCRYPTION_KEY";
const AI_CONNECTION_CIPHER_ALGORITHM = "aes-256-gcm";
const AI_CONNECTION_SECRET_KEY_BYTES = 32;
const AI_CONNECTION_SECRET_IV_BYTES = 12;
const AI_CONNECTION_SECRET_KEY_VERSION = 1;

type AIConnectionSecretContext = {
  organizationId: string;
  aiConnectionId: string;
  provider: string;
};

export type EncryptedAIConnectionSecret = {
  encryptedSecret: string;
  secretFingerprint: string;
  algorithm: string;
  keyVersion: number;
};

export class AIConnectionSecretStoreError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "AIConnectionSecretStoreError";
    this.code = code;
    this.status = status;
  }
}

function decodeConfiguredSecretKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const decoded = Buffer.from(trimmed, "base64");
    return decoded.length === AI_CONNECTION_SECRET_KEY_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

function buildSecretAdditionalData(context: AIConnectionSecretContext): Buffer {
  return Buffer.from(JSON.stringify({
    organizationId: context.organizationId,
    aiConnectionId: context.aiConnectionId,
    provider: context.provider,
    version: AI_CONNECTION_SECRET_KEY_VERSION,
  }), "utf8");
}

export function readAIConnectionEncryptionKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const value = env[AI_CONNECTION_ENCRYPTION_ENV_NAME];
  if (typeof value !== "string") {
    return null;
  }

  return decodeConfiguredSecretKey(value);
}

export function requireAIConnectionEncryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  const key = readAIConnectionEncryptionKey(env);

  if (!key) {
    throw new AIConnectionSecretStoreError(
      "ai_connection_secret_key_unconfigured",
      `${AI_CONNECTION_ENCRYPTION_ENV_NAME} must be configured with a 32-byte base64 or 64-char hex key before BYO-AI credentials can be stored.`,
      503,
    );
  }

  return key;
}

export function buildAIConnectionSecretFingerprint(secretValue: string): string {
  return createHash("sha256").update(secretValue, "utf8").digest("hex");
}

export function encryptAIConnectionSecret(
  secretValue: string,
  context: AIConnectionSecretContext,
  env: Record<string, string | undefined> = process.env,
): EncryptedAIConnectionSecret {
  const trimmedSecret = secretValue.trim();
  if (!trimmedSecret) {
    throw new AIConnectionSecretStoreError(
      "ai_connection_secret_required",
      "A non-empty AI provider API key is required.",
      400,
    );
  }

  const key = requireAIConnectionEncryptionKey(env);
  const iv = randomBytes(AI_CONNECTION_SECRET_IV_BYTES);
  const cipher = createCipheriv(AI_CONNECTION_CIPHER_ALGORITHM, key, iv);
  cipher.setAAD(buildSecretAdditionalData(context));

  const ciphertext = Buffer.concat([
    cipher.update(trimmedSecret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedSecret: [
      `v${AI_CONNECTION_SECRET_KEY_VERSION}`,
      iv.toString("base64"),
      authTag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":"),
    secretFingerprint: buildAIConnectionSecretFingerprint(trimmedSecret),
    algorithm: AI_CONNECTION_CIPHER_ALGORITHM,
    keyVersion: AI_CONNECTION_SECRET_KEY_VERSION,
  };
}

export function decryptAIConnectionSecret(
  encryptedSecret: string,
  context: AIConnectionSecretContext,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = requireAIConnectionEncryptionKey(env);
  const [version, ivBase64, authTagBase64, ciphertextBase64] = encryptedSecret.split(":");

  if (version !== `v${AI_CONNECTION_SECRET_KEY_VERSION}` || !ivBase64 || !authTagBase64 || !ciphertextBase64) {
    throw new AIConnectionSecretStoreError(
      "ai_connection_secret_invalid",
      "Stored AI provider credentials could not be decoded.",
      500,
    );
  }

  try {
    const decipher = createDecipheriv(
      AI_CONNECTION_CIPHER_ALGORITHM,
      key,
      Buffer.from(ivBase64, "base64"),
    );
    decipher.setAAD(buildSecretAdditionalData(context));
    decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AIConnectionSecretStoreError(
      "ai_connection_secret_decrypt_failed",
      "Stored AI provider credentials could not be decrypted with the active server key.",
      500,
    );
  }
}
