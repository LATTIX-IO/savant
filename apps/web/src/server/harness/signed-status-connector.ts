/**
 * PER-1059: tenant-scoped, signed status lookup for customer-owned harnesses.
 * Private backend adapter, not a public route. Never automatically redispatches
 * a held run, and never treats a provider 'not_found' as proof of nonexecution.
 */
import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MAC=/^v1=([a-f0-9]{64})$/;
const MAX_BYTES=4096;
export class HarnessStatusConnectorError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.code=code;this.name="HarnessStatusConnectorError";}
}
function fail(code:string):never{throw new HarnessStatusConnectorError(code);}
type Scope={tenantId:string;adapterId:string;runId:string;idempotencyKey:string;traceId:string};
type Connection={endpoint:string;secretRef:string};
function validateScope(x:Scope):void{
  if(!x||typeof x!=="object"||
    typeof x.tenantId!=="string"||!UUID.test(x.tenantId)||
    typeof x.adapterId!=="string"||!ID.test(x.adapterId)||
    typeof x.runId!=="string"||!ID.test(x.runId)||
    typeof x.idempotencyKey!=="string"||!ID.test(x.idempotencyKey)||
    typeof x.traceId!=="string"||!ID.test(x.traceId))fail("invalid_scope");
}
function validateEndpoint(raw:string,allowlist:readonly string[]):string{
  if(typeof raw!=="string"||raw.length>512||!Array.isArray(allowlist)||
    allowlist.length===0)fail("invalid_connection");
  let parsed:URL;
  try{parsed=new URL(raw);}catch{return fail("invalid_connection");}
  if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.port||
    parsed.search||parsed.hash||parsed.pathname!=="/v1/savant/status"||
    !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(parsed.hostname)||
    !allowlist.includes(parsed.origin))fail("invalid_connection");
  // Exact admin-owned origin alone is not a DNS/network egress security boundary.
  // The deployment MUST enforce DNS/IP egress pinning at the network gateway.
  return parsed.href;
}
function signedFrame(prefix:string,scope:Scope,stamp:string,nonce:string,raw:Uint8Array){
  return Buffer.concat([
    Buffer.from(`${prefix}\n${stamp}\n${nonce}\n${scope.tenantId}\n${scope.adapterId}\n${scope.runId}\n`,"utf8"),
    Buffer.from(raw),
  ]);
}
async function readBounded(response:Response):Promise<Buffer>{
  const len=response.headers.get("content-length");
  if(len!==null&&(!/^[0-9]+$/.test(len)||Number(len)>MAX_BYTES))
    fail("invalid_response");
  const reader=response.body?.getReader();
  if(!reader)fail("invalid_response");
  const chunks:Uint8Array[]=[];
  let n=0;
  try{
    while(true){
      const item=await reader.read();
      if(item.done)break;
      n+=item.value.byteLength;
      if(n>MAX_BYTES)fail("invalid_response");
      chunks.push(item.value);
    }
  }finally{
    try{await reader.cancel();}catch{/* do not expose stream internals */}
    reader.releaseLock();
  }
  if(n===0)fail("invalid_response");
  return Buffer.concat(chunks.map(c=>Buffer.from(c)),n);
}
export function createSignedHarnessStatusLookup(deps:{
  /** Static deployment-owned, exact-origin egress allowlist, not tenant input. */
  allowedOrigins:readonly string[];
  /** Trusted DB tenant+adapter connector binding, NOT a browser-supplied URL. */
  resolveConnection:(tenantId:string,adapterId:string)=>Promise<Connection|null>;
  /** Vault access bound to the same tenant, adapter and reference. */
  readSecret:(tenantId:string,adapterId:string,secretRef:string)=>Promise<Uint8Array|null>;
  transport:(url:string,init:RequestInit)=>Promise<Response>;
  nowMs:()=>number;
  timeoutMs?:number;
}){
  const timeoutMs=deps.timeoutMs??3000;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>5000)
    fail("invalid_configuration");
  return async function verifiedLookup(scope:Scope){
    validateScope(scope);
    const current=deps.nowMs();
    if(!Number.isFinite(current)||current<=0)fail("invalid_configuration");
    let connection:Connection|null;
    try{connection=await deps.resolveConnection(scope.tenantId,scope.adapterId);}
    catch{return fail("invalid_connection");}
    if(!connection||typeof connection.secretRef!=="string"||
      !connection.secretRef.startsWith(`vault:${scope.tenantId}:${scope.adapterId}:`)||
      !ID.test(connection.secretRef.slice(
        (`vault:${scope.tenantId}:${scope.adapterId}:`).length)))
      fail("invalid_connection");
    const endpoint=validateEndpoint(connection.endpoint,deps.allowedOrigins);
    let supplied:Uint8Array|null;
    try{supplied=await deps.readSecret(scope.tenantId,scope.adapterId,connection.secretRef);}
    catch{return fail("credential_unavailable");}
    if(!(supplied instanceof Uint8Array)||supplied.byteLength<32||
      supplied.byteLength>128)fail("credential_unavailable");
    // Own a private copy before awaiting untrusted network operations.
    const secret=Buffer.from(supplied);
    const stamp=String(Math.floor(current/1000));
    const nonce=randomBytes(16).toString("hex");
    const payload=Buffer.from(JSON.stringify({
      tenantId:scope.tenantId,adapterId:scope.adapterId,runId:scope.runId,
      idempotencyKey:scope.idempotencyKey,traceId:scope.traceId,
    }));
    const requestMac="v1="+createHmac("sha256",secret)
      .update(signedFrame("savant-harness-status-request-v1",scope,stamp,nonce,payload))
      .digest("hex");
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
    let onAbort:()=>void=()=>{};
    const timeout=new Promise<never>((_,reject)=>{
      onAbort=()=>reject(new HarnessStatusConnectorError("transport_unavailable"));
      ctrl.signal.addEventListener("abort",onAbort,{once:true});
    });
    let response:Response;
    try{
      response=await Promise.race([Promise.resolve().then(()=>deps.transport(endpoint,{
        method:"POST",headers:{
          "content-type":"application/json",
          "accept":"application/json",
          "x-savant-timestamp":stamp,
          "x-savant-nonce":nonce,
          "x-savant-signature":requestMac,
        },
        body:payload,signal:ctrl.signal,redirect:"error",cache:"no-store",
      })),timeout]);
      if(!response||response.status!==200||
        response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")
        fail("invalid_response");
      // Never allow a response originating from an unexpected verifier identity.
      if(response.headers.get("x-savant-timestamp")!==stamp||
        response.headers.get("x-savant-nonce")!==nonce)fail("invalid_response");
      const sig=response.headers.get("x-savant-signature");
      if(!sig||!MAC.test(sig))fail("invalid_response");
      const raw=await Promise.race([readBounded(response),timeout]);
      const expected=createHmac("sha256",secret)
        .update(signedFrame("savant-harness-status-response-v1",scope,stamp,nonce,raw))
        .digest();
      const actual=Buffer.from(sig.slice(3),"hex");
      if(!timingSafeEqual(expected,actual))fail("invalid_response");
      let obj:unknown;
      try{obj=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}
      catch{return fail("invalid_response");}
      if(!obj||typeof obj!=="object"||Array.isArray(obj))fail("invalid_response");
      const keys=Object.keys(obj);
      if(keys.length!==5||!["tenantId","adapterId","runId","idempotencyKey","providerState"]
        .every(x=>keys.includes(x)))fail("invalid_response");
      const x=obj as Record<string,unknown>;
      if(x.tenantId!==scope.tenantId||x.adapterId!==scope.adapterId||
        x.runId!==scope.runId||x.idempotencyKey!==scope.idempotencyKey||
        !["accepted","not_found","unknown"].includes(x.providerState as string))
        fail("invalid_response");
      return {tenantId:scope.tenantId,adapterId:scope.adapterId,
        runId:scope.runId,idempotencyKey:scope.idempotencyKey,
        providerState:x.providerState as "accepted"|"not_found"|"unknown",
        evidenceSha256:createHash("sha256").update(raw).digest("hex")};
    }catch{
      // Do not leak raw endpoint, secret, body or provider exception.
      return fail("transport_or_verification_failed");
    }finally{
      clearTimeout(timer);
      ctrl.signal.removeEventListener("abort",onAbort);
      secret.fill(0);
    }
  };
}
