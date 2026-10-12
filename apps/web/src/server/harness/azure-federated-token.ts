/**
 * PER-1059: Azure Entra federated workload-identity exchange for Key Vault.
 * Server-only. No client secrets, browser-supplied tokens, or fallback to a
 * machine-global credential shared across customers.
 *
 * Assertion acquisition MUST come from a trusted workload identity runtime
 * configured with Entra federated credential subject/audience restrictions.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JWT=/^[a-zA-Z0-9_-]{1,8192}\.[a-zA-Z0-9_-]{1,8192}\.[a-zA-Z0-9_-]{1,8192}$/;
const TOKEN=/^[A-Za-z0-9._~-]{20,8192}$/;
const MAX_BYTES=4096;

export class HarnessFederatedIdentityError extends Error{
  readonly code:string;
  constructor(code:string){super(code);this.code=code;this.name="HarnessFederatedIdentityError";}
}
function fail(code:string):never{throw new HarnessFederatedIdentityError(code);}
async function boundedBody(response:Response,limit:number):Promise<Buffer>{
  const length=response.headers.get("content-length");
  if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>limit))fail("invalid_token_response");
  const reader=response.body?.getReader();
  if(!reader)fail("invalid_token_response");
  let size=0;
  const chunks:Buffer[]=[];
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit)fail("invalid_token_response");
      chunks.push(Buffer.from(value));
    }
  }finally{
    try{await reader.cancel();}catch{/* do not expose transport errors */}
    reader.releaseLock();
  }
  if(!size)fail("invalid_token_response");
  return Buffer.concat(chunks,size);
}
export function createAzureFederatedWorkloadTokenProvider(deps:{
  /** Static server deployment identity and Entra tenant, not customer HTTP input. */
  tenantId:string;
  clientId:string;
  /** Trusted AKS workload identity / OIDC runtime assertion supplier. */
  readFederatedAssertion:()=>Promise<string>;
  /** Approved outbound transport MUST pin TLS/DNS/IP for login.microsoftonline.com. */
  transport:(url:string,init:RequestInit)=>Promise<Response>;
  timeoutMs?:number;
}){
  if(typeof deps.tenantId!=="string"||!UUID.test(deps.tenantId)||
    typeof deps.clientId!=="string"||!UUID.test(deps.clientId))
    fail("invalid_configuration");
  const timeoutMs=deps.timeoutMs??3000;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>5000)
    fail("invalid_configuration");
  const tokenEndpoint=
    \`https://login.microsoftonline.com/\${deps.tenantId}/oauth2/v2.0/token\`;
  return async function accessToken():Promise<string>{
    // ONE shared timeout covers potentially hung workload federation and
    // token exchange. Never allow an async assertion source to hang workers.
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
    let onAbort:()=>void=()=>{};
    const deadline=new Promise<never>((_,reject)=>{
      onAbort=()=>reject(new HarnessFederatedIdentityError("identity_unavailable"));
      ctrl.signal.addEventListener("abort",onAbort,{once:true});
    });
    try{
      let assertion:string;
      try{
        assertion=await Promise.race([
          Promise.resolve().then(deps.readFederatedAssertion),deadline,
        ]);
      }catch{return fail("identity_unavailable");}
      if(typeof assertion!=="string"||assertion.length>16384||
        !JWT.test(assertion))fail("invalid_assertion");
      const request=new URLSearchParams({
        client_id:deps.clientId,
        scope:"https://vault.azure.net/.default",
        grant_type:"client_credentials",
        client_assertion_type:"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion:assertion,
      });
      const response=await Promise.race([
        Promise.resolve().then(()=>deps.transport(tokenEndpoint,{
          method:"POST",
          headers:{"content-type":"application/x-www-form-urlencoded",
            "accept":"application/json"},
          body:request.toString(),signal:ctrl.signal,
          redirect:"error",cache:"no-store",
        })),
        deadline,
      ]);
      if(!response||response.status!==200||
        response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json"){
        ctrl.abort();
        if(response?.body)void response.body.cancel().catch(()=>{});
        fail("identity_unavailable");
      }
      const raw=await Promise.race([boundedBody(response,MAX_BYTES),deadline]);
      let obj:unknown;
      try{obj=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}
      catch{return fail("invalid_token_response");}
      if(!obj||typeof obj!=="object"||Array.isArray(obj))fail("invalid_token_response");
      const value=obj as Record<string,unknown>;
      if(value.token_type!=="Bearer"||typeof value.access_token!=="string"||
        !TOKEN.test(value.access_token)||typeof value.expires_in!=="number"||
        !Number.isSafeInteger(value.expires_in)||
        value.expires_in<60||value.expires_in>86400||
        "refresh_token" in value)
        fail("invalid_token_response");
      // Return only the scoped access token, never federation assertion or
      // HTTP response metadata. The vault resolver uses it once on demand.
      return value.access_token;
    }catch(e){
      if(e instanceof HarnessFederatedIdentityError)throw e;
      return fail("identity_unavailable");
    }finally{
      ctrl.abort();
      clearTimeout(timer);
      ctrl.signal.removeEventListener("abort",onAbort);
    }
  };
}
