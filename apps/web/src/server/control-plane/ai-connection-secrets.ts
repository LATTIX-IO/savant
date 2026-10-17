import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {readKeyring,selectV2Key,VersionedKeyringError, type DomainKeyring} from "../security/versioned-aead-keyring.ts";

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

const keyringConfig={
  activeEnv:"AI_CONNECTION_ENCRYPTION_KEY",
  activeIdEnv:"AI_CONNECTION_ENCRYPTION_KEY_ID",
  legacyEnv:"AI_CONNECTION_LEGACY_ENCRYPTION_KEY",
  previousEnv:"AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS",
  encoding:"base64" as const,
};
function configuredKeyring(env:Record<string,string|undefined>):DomainKeyring{
  try{return readKeyring(env,keyringConfig);}
  catch(error){
    if(error instanceof VersionedKeyringError)
      throw new AIConnectionSecretStoreError(
        "ai_connection_secret_key_unconfigured",
        "Managed AI connection key material is unavailable or malformed.",
        503,
      );
    throw error;
  }
}
function buildSecretAdditionalData(
  context:AIConnectionSecretContext,version:1|2=1,keyId?:string,
):Buffer{
  const legacy={
    organizationId:context.organizationId,
    aiConnectionId:context.aiConnectionId,
    provider:context.provider,
    version:AI_CONNECTION_SECRET_KEY_VERSION,
  };
  return Buffer.from(JSON.stringify(version===1?legacy:{
    ...legacy,version:2,keyId,
  }),"utf8");
}
export function readAIConnectionEncryptionKey(
  env:Record<string,string|undefined>=process.env,
):Buffer|null{
  try{return configuredKeyring(env).activeKey;}
  catch{return null;}
}
export function requireAIConnectionEncryptionKey(
  env:Record<string,string|undefined>=process.env,
):Buffer{
  return configuredKeyring(env).activeKey;
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

  const ring=configuredKeyring(env);
  const iv = randomBytes(AI_CONNECTION_SECRET_IV_BYTES);
  const cipher = createCipheriv(AI_CONNECTION_CIPHER_ALGORITHM, ring.activeKey, iv);
  cipher.setAAD(buildSecretAdditionalData(context,ring.activeId?2:1,
    ring.activeId??undefined));

  const ciphertext = Buffer.concat([
    cipher.update(trimmedSecret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedSecret: [
      ring.activeId?"v2":"v1",
      ...(ring.activeId?[ring.activeId]:[]),
      iv.toString("base64"),
      authTag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":"),
    secretFingerprint: buildAIConnectionSecretFingerprint(trimmedSecret),
    algorithm: AI_CONNECTION_CIPHER_ALGORITHM,
    keyVersion: ring.activeId?2:1,
  };
}

export function decryptAIConnectionSecret(
  encryptedSecret: string,
  context: AIConnectionSecretContext,
  env: Record<string, string | undefined> = process.env,
): string {
  const ring=configuredKeyring(env);
  try{
    if(typeof encryptedSecret!=="string"||encryptedSecret.length>8192)
      throw Error("envelope");
    const parts=encryptedSecret.split(":");
    const isV2=parts[0]==="v2"&&parts.length===5;
    if(!isV2&&(parts[0]!=="v1"||parts.length!==4))
      throw Error("version");
    const start=isV2?2:1;
    const key=isV2?selectV2Key(ring,parts[1]!):ring.legacyKey;
    const ivText=parts[start]!,tagText=parts[start+1]!,cipherText=parts[start+2]!;
    // All newly written and historical v1 strings use standard base64.
    const canonical=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if(![ivText,tagText,cipherText].every(x=>x&&canonical.test(x)))
      throw Error("base64");
    const iv=Buffer.from(ivText,"base64"),tag=Buffer.from(tagText,"base64");
    const data=Buffer.from(cipherText,"base64");
    if(iv.length!==12||tag.length!==16||
      iv.toString("base64")!==ivText||tag.toString("base64")!==tagText||
      data.toString("base64")!==cipherText)throw Error("length");
    const decipher=createDecipheriv(AI_CONNECTION_CIPHER_ALGORITHM,key,iv);
    decipher.setAAD(buildSecretAdditionalData(context,isV2?2:1,
      isV2?parts[1]:undefined));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data),decipher.final()]).toString("utf8");
  }catch{
    throw new AIConnectionSecretStoreError(
      "ai_connection_secret_decrypt_failed",
      "Stored AI provider credentials could not be decrypted with the configured key version.",
      500,
    );
  }
}
