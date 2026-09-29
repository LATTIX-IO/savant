// Encryption for run artifacts (inputs, outputs, trajectories). Payloads are
// redacted before encryption; encryption protects what remains at rest.
//
// When no key is configured, the ingestion service refuses to store artifacts
// and downgrades the run to outcome-level telemetry instead of storing
// plaintext.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const TELEMETRY_ENCRYPTION_ENV_NAME = "TELEMETRY_ENCRYPTION_KEY";
const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = 1;

export type ArtifactCryptoContext = {
  organizationId: string;
  runId: string;
  kind: string;
};

export class ArtifactCryptoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ArtifactCryptoError";
    this.code = code;
  }
}

export function readTelemetryEncryptionKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const value = env[TELEMETRY_ENCRYPTION_ENV_NAME]?.trim();
  if (!value) {
    return null;
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 ? decoded : null;
}

function additionalData(context: ArtifactCryptoContext): Buffer {
  return Buffer.from(JSON.stringify({ ...context, version: KEY_VERSION }), "utf8");
}

export function encryptArtifact(plaintext: string, context: ArtifactCryptoContext, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(additionalData(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [`v${KEY_VERSION}`, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptArtifact(payload: string, context: ArtifactCryptoContext, key: Buffer): string {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== `v${KEY_VERSION}` || !iv || !tag || !ciphertext) {
    throw new ArtifactCryptoError("artifact_payload_invalid", "Stored run artifact could not be decoded.");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
    decipher.setAAD(additionalData(context));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new ArtifactCryptoError("artifact_decrypt_failed", "Stored run artifact could not be decrypted with the active key.");
  }
}
