import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
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
function configuredKey(env:Record<string,string|undefined>):Buffer{
  const raw=env.TEST_BENCH_ENCRYPTION_KEY;
  if(!raw)throw new TestBenchError("test_bench_key_unconfigured",503);
  const input=raw.trim();
  let key:Buffer;
  if(/^[0-9a-f]{64}$/i.test(input))key=Buffer.from(input,"hex");
  else if(/^[A-Za-z0-9_-]+$/.test(input))key=base64url(input);
  else throw new TestBenchError("test_bench_key_unconfigured",503);
  if(key.length!==32)throw new TestBenchError("test_bench_key_unconfigured",503);
  return key;
}
function aad(ctx:TestBenchCipherContext):Buffer{
  return Buffer.from(JSON.stringify({
    kind:"savant-test-bench-cases",v:1,
    organizationId:ctx.organizationId,definitionId:ctx.definitionId,
    revision:ctx.revision,commitSha:ctx.commitSha,
  }),"utf8");
}
export function encryptTestBenchCases(
  casesJson:string,ctx:TestBenchCipherContext,
  env:Record<string,string|undefined>=process.env,
):string{
  if(Buffer.byteLength(casesJson,"utf8")>16384)throw new TestBenchError("test_bench_case_bytes_exceeded",422);
  const key=configuredKey(env),nonce=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,nonce);
  cipher.setAAD(aad(ctx));
  const ciphertext=Buffer.concat([cipher.update(casesJson,"utf8"),cipher.final()]);
  return ["v1",nonce.toString("base64url"),cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")].join(":");
}
export function decryptTestBenchCases(
  blob:string,ctx:TestBenchCipherContext,
  env:Record<string,string|undefined>=process.env,
):string{
  const key=configuredKey(env);
  try{
    if(typeof blob!=="string"||blob.length>32768)throw Error("invalid");
    const parts=blob.split(":");
    if(parts.length!==4||parts[0]!=="v1")throw Error("version");
    const nonce=base64url(parts[1]!),tag=base64url(parts[2]!),ciphertext=base64url(parts[3]!);
    if(nonce.length!==12||tag.length!==16||ciphertext.length>16384)throw Error("length");
    const decipher=createDecipheriv("aes-256-gcm",key,nonce);
    decipher.setAAD(aad(ctx));decipher.setAuthTag(tag);
    const body=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    return new TextDecoder("utf-8",{fatal:true}).decode(body);
  }catch{
    throw new TestBenchError("test_bench_ciphertext_invalid",500);
  }
}
