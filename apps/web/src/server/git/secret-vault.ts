import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { GitProviderError } from "./errors.ts";
import type { ProviderCredential } from "./types.ts";

/**
 * Envelope encryption for Git provider credentials.
 *
 * The key is read from the runtime environment (a deployment secret manager
 * such as Vercel encrypted env, AWS Secrets Manager, Azure Key Vault or GCP
 * Secret Manager) and is never stored in the database that holds ciphertext.
 * Ciphertext is bound to its owner through AES-GCM additional authenticated
 * data, so a row copied to another organization or connection fails to decrypt.
 */

const KEY_ENV_NAME = "GIT_CREDENTIAL_ENCRYPTION_KEY";
const PREVIOUS_KEY_ENV_NAME = "GIT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS";
const CIPHER = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
export const GIT_SECRET_KEY_VERSION = 1;

export type Env = Record<string, string | undefined>;

export type GitSecretBinding =
  | { purpose: "connection_credential"; organizationId: string; connectionId: string }
  | { purpose: "oauth_state"; organizationId: string; stateHash: string };

export type EncryptedGitSecret = {
  encryptedPayload: string;
  fingerprint: string;
  algorithm: string;
  keyVersion: number;
};

function decodeKey(value: string | undefined): Buffer | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  const decoded = Buffer.from(trimmed, "base64");
  return decoded.length === KEY_BYTES ? decoded : null;
}

export function isGitCredentialVaultConfigured(env: Env = process.env): boolean {
  return decodeKey(env[KEY_ENV_NAME]) !== null;
}

function requireKeys(env: Env): Buffer[] {
  const primary = decodeKey(env[KEY_ENV_NAME]);

  if (!primary) {
    throw new GitProviderError(
      "PROVIDER_NOT_CONFIGURED",
      `${KEY_ENV_NAME} must be configured with a 32-byte base64 or 64-char hex key before Git provider credentials can be stored.`,
      { status: 503 },
    );
  }

  const previous = decodeKey(env[PREVIOUS_KEY_ENV_NAME]);
  return previous ? [primary, previous] : [primary];
}

function buildAdditionalData(binding: GitSecretBinding): Buffer {
  return Buffer.from(JSON.stringify({ ...binding, version: GIT_SECRET_KEY_VERSION }), "utf8");
}

export function fingerprintSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export function encryptGitSecret(plaintext: string, binding: GitSecretBinding, env: Env = process.env): EncryptedGitSecret {
  const [key] = requireKeys(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key as Buffer, iv);
  cipher.setAAD(buildAdditionalData(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    encryptedPayload: [
      `v${GIT_SECRET_KEY_VERSION}`,
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(":"),
    fingerprint: fingerprintSecret(plaintext),
    algorithm: CIPHER,
    keyVersion: GIT_SECRET_KEY_VERSION,
  };
}

export function decryptGitSecret(encryptedPayload: string, binding: GitSecretBinding, env: Env = process.env): string {
  const keys = requireKeys(env);
  const [version, ivBase64, tagBase64, ciphertextBase64] = encryptedPayload.split(":");

  if (version !== `v${GIT_SECRET_KEY_VERSION}` || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "Stored Git provider credentials could not be decoded.", { status: 500 });
  }

  for (const key of keys) {
    try {
      const decipher = createDecipheriv(CIPHER, key, Buffer.from(ivBase64, "base64"));
      decipher.setAAD(buildAdditionalData(binding));
      decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextBase64, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Try the next (previous) key.
    }
  }

  throw new GitProviderError(
    "AUTH_REQUIRED",
    "Stored Git provider credentials could not be decrypted with the active server key. Reauthorize the connection.",
    { status: 500 },
  );
}

export function encryptProviderCredential(
  credential: ProviderCredential,
  binding: Extract<GitSecretBinding, { purpose: "connection_credential" }>,
  env: Env = process.env,
): EncryptedGitSecret {
  return encryptGitSecret(JSON.stringify(credential), binding, env);
}

export function decryptProviderCredential(
  encryptedPayload: string,
  binding: Extract<GitSecretBinding, { purpose: "connection_credential" }>,
  env: Env = process.env,
): ProviderCredential {
  const parsed: unknown = JSON.parse(decryptGitSecret(encryptedPayload, binding, env));

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "Stored Git provider credentials have an invalid shape.", { status: 500 });
  }

  return parsed as ProviderCredential;
}
