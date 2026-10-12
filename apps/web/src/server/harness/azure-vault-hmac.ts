/**
 * PER-1059 concrete Azure Key Vault secret resolver for customer-harness HMAC.
 * Use only with a production-approved, TLS+egress-pinned transport and a managed
 * workload identity token provider. This is not a generic HTTP fetch proxy.
 *
 * Supported opaque ref:
 *   vault:<tenant UUID>:<adapter>:<alias>.<32-hex Azure secret version>
 * Secret name is deterministically derived from all tenant/adapter/alias fields.
 * Key material lives exclusively in Key Vault; PostgreSQL stores only the ref.
 */
import { createHash } from "node:crypto";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const PINNED=/^([a-z0-9][a-z0-9-]{0,39})\.([a-f0-9]{32})$/;
const KV_NAME=/^[a-z][a-z0-9-]{1,22}[a-z0-9]$/;
const CONTENT_TYPE="application/vnd.savant.harness-hmac.base64url";
const MAX_RESPONSE_BYTES=4096;

export class HarnessAzureVaultError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.name="HarnessAzureVaultError";this.code=code;}
}
function fail(code:string):never{throw new HarnessAzureVaultError(code);}
function scoped(tenantId:string,adapterId:string,ref:string){
  if(typeof tenantId!=="string"||!UUID.test(tenantId)||
    typeof adapterId!=="string"||!IDENT.test(adapterId)||
    typeof ref!=="string"||ref.length>256)fail("invalid_scope");
  const prefix=`vault:${tenantId}:${adapterId}:`;
  if(!ref.startsWith(prefix))fail("invalid_ref");
  const found=PINNED.exec(ref.slice(prefix.length));
  if(!found)fail("invalid_ref");
  return {alias:found[1]!,version:found[2]!};
}
function secretName(tenantId:string,adapterId:string,alias:string){
  const digest=createHash("sha256")
    .update(`savant-harness-v1\0${tenantId}\0${adapterId}\0${alias}`)
    .digest("hex");
  return "savant-harness-"+digest.slice(0,48);
}
async function bounded(response:Response,max:number):Promise<Buffer>{
  const declared=response.headers.get("content-length");
  if(declared!==null&&(!/^[0-9]+$/.test(declared)||Number(declared)>max))
    fail("invalid_vault_response");
  const reader=response.body?.getReader();
  if(!reader)fail("invalid_vault_response");
  let count=0;
  const buffers:Buffer[]=[];
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      count+=chunk.value.byteLength;
      if(count>max)fail("invalid_vault_response");
      buffers.push(Buffer.from(chunk.value));
    }
  }finally{
    try{await reader.cancel();}catch{/* no response exception disclosure */}
    reader.releaseLock();
  }
  if(count===0)fail("invalid_vault_response");
  return Buffer.concat(buffers,count);
}
function decodeKey(obj:unknown,expectedId:string,atMs:number):Buffer{
  if(!obj||typeof obj!=="object"||Array.isArray(obj))fail("invalid_vault_response");
  const body=obj as Record<string,unknown>;
  if(body.id!==expectedId || body.contentType!==CONTENT_TYPE ||
    typeof body.value!=="string"||
    !/^[A-Za-z0-9_-]{43,171}$/.test(body.value))fail("invalid_vault_response");
  const attrs=body.attributes;
  if(!attrs||typeof attrs!=="object"||Array.isArray(attrs))
    fail("invalid_vault_response");
  const attr=attrs as Record<string,unknown>;
  if(attr.enabled!==true || typeof attr.exp!=="number"||
    !Number.isSafeInteger(attr.exp)||attr.exp*1000<=atMs ||
    (attr.nbf!==undefined && (typeof attr.nbf!=="number"||
      !Number.isSafeInteger(attr.nbf)||attr.nbf*1000>atMs)))
    fail("credential_unavailable");
  const key=Buffer.from(body.value,"base64url");
  if(key.length<32||key.length>128||key.toString("base64url")!==body.value)
    fail("invalid_vault_response");
  return key;
}

/** Concrete Key Vault REST reader. Caller supplies production managed identity
 * token acquisition and network policy enforced transport. */
export function createAzureKeyVaultHarnessResolver(deps:{
  vaultName:string;
  /** MUST obtain token via Azure workload identity or managed identity. */
  accessToken:()=>Promise<string>;
  /** MUST pin approved KV TLS/DNS/IP egress and deny redirects. */
  transport:(url:string,init:RequestInit)=>Promise<Response>;
  nowMs:()=>number;
  timeoutMs?:number;
}){
  if(!KV_NAME.test(deps.vaultName) || deps.vaultName.includes("--"))
    fail("invalid_configuration");
  const host=`https://${deps.vaultName}.vault.azure.net`;
  const timeoutMs=deps.timeoutMs??3000;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>5000)
    fail("invalid_configuration");
  const getToken=deps.accessToken,transport=deps.transport,nowMs=deps.nowMs;
  /** Matches status connector readSecret(tenant, adapter, vaultRef). */
  const readSecret=async(tenantId:string,adapterId:string,ref:string):Promise<Uint8Array|null>=>{
      const {alias,version}=scoped(tenantId,adapterId,ref);
      const name=secretName(tenantId,adapterId,alias);
      const id=`${host}/secrets/${name}/${version}`;
      const url=`${id}?api-version=7.4`;
      let token:string;
      try{token=await getToken();}
      catch{return fail("credential_unavailable");}
      if(typeof token!=="string"||token.length<20||token.length>8192||
        !/^[A-Za-z0-9._~-]+$/.test(token))fail("credential_unavailable");
      const time=nowMs();
      if(!Number.isFinite(time)||time<=0)fail("invalid_configuration");
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
      let onAbort:()=>void=()=>{};
      const timeout=new Promise<never>((_,reject)=>{
        onAbort=()=>reject(new HarnessAzureVaultError("vault_unavailable"));
        ctrl.signal.addEventListener("abort",onAbort,{once:true});
      });
      try{
        const response=await Promise.race([
          Promise.resolve().then(()=>transport(url,{
            method:"GET",headers:{
              "authorization":`Bearer ${token}`,
              "accept":"application/json",
            },
            signal:ctrl.signal,redirect:"error",cache:"no-store",
          })),
          timeout,
        ]);
        if(!response||response.status!==200||
          response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")
          fail("vault_unavailable");
        const raw=await Promise.race([bounded(response,MAX_RESPONSE_BYTES),timeout]);
        let value:unknown;
        try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}
        catch{return fail("invalid_vault_response");}
        return decodeKey(value,id,nowMs());
      }catch{return fail("vault_unavailable");}
      finally{
        clearTimeout(timer);
        ctrl.signal.removeEventListener("abort",onAbort);
      }
  };
  return {
    readSecret,
    /** Metadata only: check that the exact tenant/version is available. */
    async attestSecret(input:{tenantId:string;adapterId:string;secretRef:string}):Promise<boolean>{
      const key=await readSecret(input.tenantId,input.adapterId,input.secretRef);
      if(!key)return false;
      // No secret data may escape attestation.
      key.fill(0);
      return true;
    },
  };
}
