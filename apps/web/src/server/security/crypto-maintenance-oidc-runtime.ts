/**
 * PER-1562: bounded GitHub Actions OIDC issuer trust and workload token.
 *
 * Never accept discovery/JWKS URI, trust keys, audiences or hosts from a
 * browser, PR body, signed approval or tenant-controlled connector.
 * The fetcher MUST use system-trusted TLS and approved outbound DNS/IP policy.
 */
import {createPublicKey,type JsonWebKey} from "node:crypto";
import {
  verifyGithubMaintenanceJwt,verifySignedMaintenanceApproval,
  type MaintenanceTrustPolicy,type SignedMaintenanceApproval,
  type VerifiedMaintenancePermit
} from "./crypto-maintenance-authorization.ts";

export class MaintenanceIssuerError extends Error{
  readonly code:string;
  constructor(code:string){super(code);this.code=code;this.name="MaintenanceIssuerError";}
}
const deny=(code:string):never=>{throw new MaintenanceIssuerError(code);};
export const OIDC_ISSUER="https://token.actions.githubusercontent.com";
export const OIDC_DISCOVERY=OIDC_ISSUER+"/.well-known/openid-configuration";
export const OIDC_JWKS=OIDC_ISSUER+"/.well-known/jwks";
export const OIDC_AUDIENCE="api://savant-crypto-maintenance";
const KID=/^[A-Za-z0-9_-]{5,128}$/;
const TOKEN_PATTERN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const DEFAULT_TIMEOUT=5000;
type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
export type TrustedIssuerJwk=JsonWebKey&{kid:string;alg:"RS256";use:"sig"};
function timeout(ms:number){
  if(!Number.isSafeInteger(ms)||ms<100||ms>10000)
    deny("invalid_issuer_configuration");
  const ctrl=new AbortController();
  const expired=new Promise<never>((_resolve,reject)=>{
    ctrl.signal.addEventListener("abort",()=>
      reject(new MaintenanceIssuerError("oidc_transport_unavailable")),{once:true});
  });
  const handle=setTimeout(()=>ctrl.abort(),ms);
  return {signal:ctrl.signal,expired,close(){
    clearTimeout(handle);ctrl.abort();
  }};
}
async function boundedJSON(
  fetcher:Fetcher,url:string,limit:number,
  boundary:ReturnType<typeof timeout>,authToken?:string
):Promise<Record<string,unknown>>{
  let response:Response;
  try{
    response=await Promise.race([
      Promise.resolve().then(()=>fetcher(url,{
        method:"GET",redirect:"error",cache:"no-store",signal:boundary.signal,
        headers:authToken?{
          accept:"application/json",authorization:"bearer "+authToken
        }:{accept:"application/json"}
      })),
      boundary.expired
    ]);
  }catch{return deny("oidc_transport_unavailable");}
  if(!response||response.redirected||response.status!==200||
    !["application/json","application/jwk-set+json"].includes(
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()??""))
    deny("oidc_response_invalid");
  const length=response.headers.get("content-length");
  if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>limit))
    deny("oidc_response_oversized");
  const reader=response.body?.getReader();
  if(!reader)deny("oidc_response_invalid");
  const parts:Buffer[]=[];
  let total=0;
  try{
    for(;;){
      let value:ReadableStreamReadResult<Uint8Array>;
      try{value=await Promise.race([reader!.read(),boundary.expired]);}
      catch{return deny("oidc_transport_unavailable");}
      if(value.done)break;
      total+=value.value.byteLength;
      if(total>limit)deny("oidc_response_oversized");
      parts.push(Buffer.from(value.value));
    }
  }finally{
    // Never await cancellation after an adversarial stream ignores abort;
    // a pending reader must not outlive the caller's strict deadline.
    try{void reader!.cancel().catch(()=>{});}catch{/* sanitized */}
    try{reader!.releaseLock();}catch{/* pending reads are already timed out */}
  }
  if(!total)deny("oidc_response_invalid");
  let json:unknown;
  try{json=JSON.parse(new TextDecoder("utf-8",{fatal:true})
    .decode(Buffer.concat(parts,total)));}
  catch{return deny("oidc_response_invalid");}
  if(!json||typeof json!=="object"||Array.isArray(json)||
    Object.getPrototypeOf(json)!==Object.prototype)
    deny("oidc_response_invalid");
  return json as Record<string,unknown>;
}
export async function fetchTrustedGithubIssuerKeys(
  fetcher:Fetcher=fetch,timeoutMs=DEFAULT_TIMEOUT
):Promise<readonly TrustedIssuerJwk[]>{
  const boundary=timeout(timeoutMs);
  try{
    const discovery=await boundedJSON(fetcher,OIDC_DISCOVERY,16384,boundary);
    if(discovery.issuer!==OIDC_ISSUER||discovery.jwks_uri!==OIDC_JWKS||
      !Array.isArray(discovery.id_token_signing_alg_values_supported)||
      !discovery.id_token_signing_alg_values_supported.includes("RS256"))
      deny("oidc_discovery_untrusted");
    const keys=await boundedJSON(fetcher,OIDC_JWKS,65536,boundary);
    if(!Array.isArray(keys.keys)||keys.keys.length<1||keys.keys.length>10)
      deny("oidc_jwks_untrusted");
    const seen=new Set<string>(),safe:TrustedIssuerJwk[]=[];
    for(const candidate of keys.keys as unknown[]){
      if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))
        deny("oidc_jwks_untrusted");
      const key=candidate as Record<string,unknown>;
      if(typeof key.kid!=="string"||!KID.test(key.kid)||seen.has(key.kid)||
        key.kty!=="RSA"||key.alg!=="RS256"||key.use!=="sig"||
        typeof key.n!=="string"||typeof key.e!=="string"||
        ["d","p","q","dp","dq","qi","oth","jku","x5u"].some(x=>x in key))
        deny("oidc_jwks_untrusted");
      try{
        const publicKey=createPublicKey({key:key as JsonWebKey,format:"jwk"});
        if((publicKey.asymmetricKeyDetails?.modulusLength??0)<2048)
          deny("oidc_jwks_untrusted");
      }catch{return deny("oidc_jwks_untrusted");}
      seen.add(key.kid as string);
      safe.push(Object.freeze({
        kty:"RSA",alg:"RS256",use:"sig",kid:key.kid,
        n:key.n,e:key.e
      } as TrustedIssuerJwk));
    }
    return Object.freeze(safe);
  }finally{boundary.close();}
}
type RunnerEnv={
  GITHUB_ACTIONS?:string;GITHUB_REPOSITORY?:string;
  GITHUB_REF?:string;GITHUB_EVENT_NAME?:string;
  GITHUB_WORKFLOW_REF?:string;GITHUB_SHA?:string;
  GITHUB_REPOSITORY_ID?:string;
  ACTIONS_ID_TOKEN_REQUEST_URL?:string;
  ACTIONS_ID_TOKEN_REQUEST_TOKEN?:string;
};
const EXPECTED_WORKFLOW_REF=
  "LATTIX-IO/savant/.github/workflows/crypto-maintenance.yml@refs/heads/main";
export function assertTrustedMaintenanceRunner(env:RunnerEnv){
  if(env.GITHUB_ACTIONS!=="true"||env.GITHUB_REPOSITORY!=="LATTIX-IO/savant"||
    env.GITHUB_REF!=="refs/heads/main"||
    env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    env.GITHUB_WORKFLOW_REF!==EXPECTED_WORKFLOW_REF||
    !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA??"")||
    !/^[1-9][0-9]{0,15}$/.test(env.GITHUB_REPOSITORY_ID??""))
    deny("runner_not_protected_main_dispatch");
  return Object.freeze({
    sha:env.GITHUB_SHA!,repositoryId:env.GITHUB_REPOSITORY_ID!
  });
}
export async function requestGithubRunnerOidcToken(
  env:RunnerEnv,fetcher:Fetcher=fetch,timeoutMs=DEFAULT_TIMEOUT
):Promise<string>{
  assertTrustedMaintenanceRunner(env);
  const raw=env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token=env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if(typeof raw!=="string"||raw.length>4096||
    typeof token!=="string"||token.length<16||token.length>8192||
    /[\r\n]/.test(token))
    deny("runner_oidc_credentials_unavailable");
  let u:URL;
  try{u=new URL(raw as string);}catch{return deny("runner_oidc_url_invalid");}
  if(u.protocol!=="https:"||u.port||u.username||u.password||u.hash||
    !/^[a-z0-9-]+\.actions\.githubusercontent\.com$/.test(u.hostname)||
    !u.pathname.startsWith("/")||u.pathname.length<2)
    deny("runner_oidc_url_invalid");
  u.searchParams.set("audience",OIDC_AUDIENCE);
  const boundary=timeout(timeoutMs);
  try{
    const body=await boundedJSON(fetcher,u.href,20000,boundary,token);
    if(typeof body.value!=="string"||body.value.length>16384||
      !TOKEN_PATTERN.test(body.value))
      deny("runner_oidc_response_invalid");
    // No JWT claims are trusted until the issuer-signed token is separately
    // verified with the pinned repository, workflow, environment and audience.
    return body.value as string;
  }finally{boundary.close();}
}


/** Read-only attestation of a protected maintainer run.
 * Any actual DB migration is a SEPARATE transactionally replay-fenced step
 * requiring real, independently recovered managed keys and restricted DB role.
 */
export async function verifyProtectedMaintenanceAdmission(input:{
  env:RunnerEnv;
  /** Pinned admin-owned identity, audience and independent review key material.
   * Must come from privileged deployment configuration, NOT from the approval.
   */
  policy:Omit<MaintenanceTrustPolicy,"oidcJwks">;
  signedApproval:SignedMaintenanceApproval;
  fetcher?:Fetcher;
  nowMs:number;
}):Promise<VerifiedMaintenancePermit>{
  const runtime=assertTrustedMaintenanceRunner(input.env);
  if(input.policy.repositoryId!==runtime.repositoryId||
    input.policy.expectedMainSha!==runtime.sha||
    input.policy.issuer!==OIDC_ISSUER||
    input.policy.audience!==OIDC_AUDIENCE)
    deny("runner_trust_policy_mismatch");
  const fetcher=input.fetcher??fetch;
  // Trust comes from the authenticated issuer (not an unverified JWT header).
  const jwks=await fetchTrustedGithubIssuerKeys(fetcher);
  const signedJwt=await requestGithubRunnerOidcToken(input.env,fetcher);
  const trustedPolicy={...input.policy,oidcJwks:jwks};
  const identity=verifyGithubMaintenanceJwt(
    signedJwt,trustedPolicy,input.nowMs);
  return verifySignedMaintenanceApproval(
    input.signedApproval,identity,trustedPolicy,input.nowMs);
}
