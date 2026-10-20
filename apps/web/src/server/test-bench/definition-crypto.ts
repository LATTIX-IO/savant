import {createCipheriv,createDecipheriv,createHmac,randomBytes} from "node:crypto";
import {readKeyring,selectV2Key,VersionedKeyringError,
  type DomainKeyring} from "../security/versioned-aead-keyring.ts";
import {TestBenchError} from "./definition-contract.ts";

export type TestBenchCipherContext={
  organizationId:string;definitionId:string;revision:number;commitSha:string;
};
const B64=/^[A-Za-z0-9_-]+$/;
function base64url(value:string):Buffer{
  if(!B64.test(value))throw new TestBenchError("test_bench_ciphertext_invalid",500);
  const result=Buffer.from(value,"base64url");
  if(result.toString("base64url")!==value)throw new TestBenchError("test_bench_ciphertext_invalid",500);
  return result;
}
const cfg={
  activeEnv:"TEST_BENCH_ENCRYPTION_KEY",
  activeIdEnv:"TEST_BENCH_ENCRYPTION_KEY_ID",
  legacyEnv:"TEST_BENCH_LEGACY_ENCRYPTION_KEY",
  previousEnv:"TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS",
  encoding:"base64url" as const,
};
function keys(env:Record<string,string|undefined>):DomainKeyring{
  try{return readKeyring(env,cfg);}
  catch(error){
    if(error instanceof VersionedKeyringError)
      throw new TestBenchError("test_bench_key_unconfigured",503);
    throw error;
  }
}
function aad(ctx:TestBenchCipherContext,version:1|2=1,keyId?:string):Buffer{
  const legacy={
    kind:"savant-test-bench-cases",v:1,
    organizationId:ctx.organizationId,definitionId:ctx.definitionId,
    revision:ctx.revision,commitSha:ctx.commitSha,
  };
  // Preserve byte-identical legacy AAD. The v2 key ID is authenticated,
  // and ciphertext cannot be downgraded by replacing its version prefix.
  return Buffer.from(JSON.stringify(version===1?legacy:{
    ...legacy,v:2,keyId,
  }),"utf8");
}
export function encryptTestBenchCases(
  casesJson:string,ctx:TestBenchCipherContext,
  env:Record<string,string|undefined>=process.env,
  maxBytes:16384|65536=16384,
):string{
  if(Buffer.byteLength(casesJson,"utf8")>maxBytes)throw new TestBenchError("test_bench_case_bytes_exceeded",422);
  const ring=keys(env),nonce=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",ring.activeKey,nonce);
  cipher.setAAD(aad(ctx,ring.activeId?2:1,ring.activeId??undefined));
  const ciphertext=Buffer.concat([cipher.update(casesJson,"utf8"),cipher.final()]);
  const encoded=[nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),ciphertext.toString("base64url")];
  return ring.activeId?["v2",ring.activeId,...encoded].join(":"):
    ["v1",...encoded].join(":");
}
export function decryptTestBenchCases(
  blob:string,ctx:TestBenchCipherContext,
  env:Record<string,string|undefined>=process.env,
  maxBytes:16384|65536=16384,
):string{
  const ring=keys(env);
  try{
    if(typeof blob!=="string"||blob.length>Math.ceil(maxBytes*4/3)+180)
      throw Error("invalid");
    const parts=blob.split(":");
    const v2=parts[0]==="v2"&&parts.length===5;
    if(!v2&&(parts[0]!=="v1"||parts.length!==4))throw Error("version");
    const offset=v2?2:1;
    const key=v2?selectV2Key(ring,parts[1]!):ring.legacyKey;
    const nonce=base64url(parts[offset]!);
    const tag=base64url(parts[offset+1]!);
    const ciphertext=base64url(parts[offset+2]!);
    if(nonce.length!==12||tag.length!==16||ciphertext.length>maxBytes)
      throw Error("length");
    const decipher=createDecipheriv("aes-256-gcm",key,nonce);
    decipher.setAAD(aad(ctx,v2?2:1,v2?parts[1]!:undefined));
    decipher.setAuthTag(tag);
    const body=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    return new TextDecoder("utf-8",{fatal:true}).decode(body);
  }catch{
    throw new TestBenchError("test_bench_ciphertext_invalid",500);
  }
}

/** Keyed, domain-separated idempotency fingerprint: never hash low-entropy
 * user case prompts into a publicly guessable unkeyed DB fingerprint.
 */
export function testBenchRequestDigest(
  payloadJson:string,organizationId:string,
  env:Record<string,string|undefined>=process.env,
):string{
  // Unexpired v1 request IDs MUST keep their original fingerprint across
  // AES rotations. Retain explicit v1 key for this HMAC until a separately
  // approved digest migration; never substitute the newest AES key.
  const key=keys(env).legacyKey;
  const derived=createHmac("sha256",key)
    .update("savant:test-bench:create-request-hmac:v1").digest();
  return createHmac("sha256",derived)
    .update(organizationId,"utf8").update("\n").update(payloadJson,"utf8")
    .digest("hex");
}
