/**
 * PER-1059: read AKS's rotating projected service-account assertion.
 *
 * The trusted deployment injects AZURE_FEDERATED_TOKEN_FILE and mount root.
 * Kubernetes projection uses symlinks; resolve each read, permit symlinks
 * WITHIN the trusted mount, and prevent traversal outside it.
 *
 * Claims validation is defense in depth. Entra is responsible for
 * cryptographically validating the OIDC assertion and federation policy.
 */
import {constants} from "node:fs";
import {open,realpath} from "node:fs/promises";
import {isAbsolute,relative,resolve,sep} from "node:path";

const MAX_BYTES=16384;
const B64=/^[A-Za-z0-9_-]+$/;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// Kubernetes namespace is a DNS label (max 63 chars); a ServiceAccount name
// is a DNS subdomain (max 253 chars), so dots are valid between labels.
const DNS_LABEL=/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
function validServiceAccountSubject(value:string):boolean{
  const segments=value.split(":");
  if(segments.length!==4||segments[0]!=="system"||
    segments[1]!=="serviceaccount")return false;
  const namespace=segments[2]!,serviceAccount=segments[3]!;
  return namespace.length<=63&&DNS_LABEL.test(namespace)&&
    serviceAccount.length>0&&serviceAccount.length<=253&&
    serviceAccount.split(".").every(label=>label.length<=63&&DNS_LABEL.test(label));
}
export class HarnessProjectedIdentityError extends Error{
  readonly code:string;
  constructor(code:string){super(code);this.code=code;this.name="HarnessProjectedIdentityError";}
}
function fail(code:string):never{throw new HarnessProjectedIdentityError(code);}
function inside(root:string,file:string):boolean{
  const rel=relative(root,file);
  return rel!=="" && rel!==".." && !rel.startsWith(".."+sep) && !isAbsolute(rel);
}
function claimsSegment(part:string):Record<string,unknown>{
  if(!B64.test(part)||part.length>MAX_BYTES)fail("invalid_assertion");
  let value:unknown;
  try{
    const encoded=Buffer.from(part,"base64url");
    if(encoded.toString("base64url")!==part || encoded.length>MAX_BYTES)fail("invalid_assertion");
    value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(encoded));
  }catch{return fail("invalid_assertion");}
  if(!value||typeof value!=="object"||Array.isArray(value))
    fail("invalid_assertion");
  return value as Record<string,unknown>;
}
export function createAksProjectedAssertionReader(deps:{
  /** Deployment-provided AZURE_FEDERATED_TOKEN_FILE, never browser input. */
  tokenFilePath:string;
  /** Read-only AKS projection directory (contains ..data symlink). */
  trustedMountRoot:string;
  /** Exact OIDC issuer and service-account subject provisioned in Entra FIC. */
  expectedIssuer:string;
  expectedSubject:string;
  /** Direct federation; identity binding proxy audience is NOT interchangeable. */
  expectedAudience?:string;
  nowMs:()=>number;
}){
  if(typeof deps.tokenFilePath!=="string"||!isAbsolute(deps.tokenFilePath)||
    deps.tokenFilePath.length>4096||deps.tokenFilePath.includes("\0")||
    typeof deps.trustedMountRoot!=="string"||!isAbsolute(deps.trustedMountRoot)||
    deps.trustedMountRoot.length>4096||deps.trustedMountRoot.includes("\0"))
    fail("invalid_configuration");
  const root=resolve(deps.trustedMountRoot);
  const tokenPath=resolve(deps.tokenFilePath);
  // Refuse lexical traversal before ever accessing the filesystem.
  if(!inside(root,tokenPath)||tokenPath!==deps.tokenFilePath)
    fail("invalid_configuration");
  let issuer:URL;
  try{issuer=new URL(deps.expectedIssuer);}catch{return fail("invalid_configuration");}
  if(issuer.protocol!=="https:"||issuer.username||issuer.password||
    issuer.search||issuer.hash||!issuer.hostname||
    typeof deps.expectedIssuer!=="string"||deps.expectedIssuer.length>512||
    typeof deps.expectedSubject!=="string"||!validServiceAccountSubject(deps.expectedSubject))
    fail("invalid_configuration");
  const audience=deps.expectedAudience??"api://AzureADTokenExchange";
  if(audience!=="api://AzureADTokenExchange")fail("invalid_configuration");
  const expectedIssuer=deps.expectedIssuer,expectedSubject=deps.expectedSubject;
  return async function readFederatedAssertion():Promise<string>{
    let body:string;
    try{
      const canonicalRoot=await realpath(root);
      const canonicalFile=await realpath(tokenPath);
      // Kubernetes token and ..data symlinks may change during rotation;
      // never follow them outside the trusted projected volume.
      if(!inside(canonicalRoot,canonicalFile))fail("assertion_unavailable");
      const handle=await open(canonicalFile,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{
        const stat=await handle.stat();
        if(!stat.isFile()||stat.size===0||stat.size>MAX_BYTES)
          fail("assertion_unavailable");
        const raw=await handle.readFile();
        if(raw.length>MAX_BYTES)fail("assertion_unavailable");
        body=new TextDecoder("utf-8",{fatal:true}).decode(raw);
      }finally{await handle.close();}
    }catch{return fail("assertion_unavailable");}
    // Projected tokens may carry a single terminal newline, but whitespace
    // elsewhere is never normalized into a seemingly valid assertion.
    if(body.endsWith("\n"))body=body.slice(0,-1);
    if(body.length>MAX_BYTES||!JWT.test(body))fail("invalid_assertion");
    const [headerPart,payloadPart]=body.split(".");
    const header=claimsSegment(headerPart!);
    const payload=claimsSegment(payloadPart!);
    if(!["RS256","ES256"].includes(header.alg as string)||
      payload.iss!==expectedIssuer||payload.sub!==expectedSubject||
      !(payload.aud===audience||
        (Array.isArray(payload.aud)&&payload.aud.length===1&&payload.aud[0]===audience)))
      fail("invalid_assertion");
    const time=deps.nowMs();
    if(!Number.isFinite(time)||time<=0)fail("invalid_configuration");
    const now=Math.floor(time/1000);
    if(typeof payload.exp!=="number"||!Number.isSafeInteger(payload.exp)||
      payload.exp<=now+30||payload.exp>now+86460||
      (payload.nbf!==undefined&&
        (typeof payload.nbf!=="number"||!Number.isSafeInteger(payload.nbf)||
         payload.nbf>now+60))||
      (payload.iat!==undefined&&
        (typeof payload.iat!=="number"||!Number.isSafeInteger(payload.iat)||
         payload.iat>now+60)))
      fail("invalid_assertion");
    return body;
  };
}
