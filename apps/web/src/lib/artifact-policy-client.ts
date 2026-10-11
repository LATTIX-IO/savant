export class ArtifactPolicyClientError extends Error {
  constructor(readonly code: string, readonly status = 422) { super(code); this.name = "ArtifactPolicyClientError"; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export type ArtifactScope = {repositoryId:string;kind:"skill"|"workflow_spec";artifactId:string};
export type ArtifactPolicyRule = {id:string;effect:"allow"|"deny";principalType:"user"|"group"|"role";principalRef:string};
export type ArtifactPolicyList = {revision:number;rules:ArtifactPolicyRule[]};
export type ArtifactPolicyMutation = Omit<ArtifactPolicyRule,"id"> & {operation:"grant"|"revoke";requestId:string};
const fail = (code:string,status=422):never => {throw new ArtifactPolicyClientError(code,status);};
export function makeArtifactPolicyScope(repositoryId:string,kind:string,artifactId:string):ArtifactScope {
  if(!UUID.test(repositoryId)||!["skill","workflow_spec"].includes(kind)||!ARTIFACT.test(artifactId)||artifactId.includes(".."))fail("invalid_policy_scope");
  return {repositoryId:repositoryId.toLowerCase(),kind:kind as ArtifactScope["kind"],artifactId};
}
export function buildArtifactPolicyEndpoint(scope:ArtifactScope,workspaceSlug:string):string {
  const s=makeArtifactPolicyScope(scope.repositoryId,scope.kind,scope.artifactId);
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(workspaceSlug))fail("workspace_slug_required",400);
  const params=new URLSearchParams({...s,workspaceSlug});
  return "/api/capabilities/policies/v1?"+params.toString();
}
function validateResponse(payload:unknown,etag:string|null,mutation:boolean):ArtifactPolicyList | {revision:number;changed:boolean;replayed:boolean} {
  if(!payload||typeof payload!=="object"||!("data" in payload))fail("invalid_policy_response",502);
  const data=(payload as {data:unknown}).data;
  if(!data||typeof data!=="object")fail("invalid_policy_response",502);
  const d=data as Record<string,unknown>;
  if(!Number.isSafeInteger(d.revision)||(d.revision as number)<0||etag!==`"v${d.revision}"`)fail("invalid_policy_response",502);
  if(mutation){
    if(typeof d.changed!=="boolean"||typeof d.replayed!=="boolean")fail("invalid_policy_response",502);
    return {revision:d.revision as number,changed:d.changed,replayed:d.replayed};
  }
  if(!Array.isArray(d.rules)||d.rules.length>=250||!d.rules.every((r:unknown)=>{
    if(!r||typeof r!=="object")return false;
    const rule=r as Record<string,unknown>;
    return typeof rule.id==="string"&&UUID.test(rule.id)&&["allow","deny"].includes(rule.effect as string)&&
      ["user","group","role"].includes(rule.principalType as string)&&typeof rule.principalRef==="string"&&
      (rule.principalType==="role"?rule.principalRef==="member":UUID.test(rule.principalRef));
  }))fail("invalid_policy_response",502);
  return {revision:d.revision as number,rules:d.rules as ArtifactPolicyRule[]};
}
async function result(response:Response,mutation:boolean) {
  if(!response.ok){
    let code="policy_request_failed";
    try {
      const payload:unknown=await response.json();
      const candidate=(payload as {error?:{code?:unknown}})?.error?.code;
      if(typeof candidate==="string"&&/^[a-z][a-z0-9_]{1,70}$/.test(candidate))code=candidate;
    }catch{}
    throw new ArtifactPolicyClientError(code,response.status);
  }
  let data:unknown;
  try{data=await response.json();}catch{fail("invalid_policy_response",502);}
  return validateResponse(data,response.headers.get("ETag"),mutation);
}
export async function listArtifactPolicies(scope:ArtifactScope,workspaceSlug:string,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<ArtifactPolicyList> {
  const response=await fetcher(buildArtifactPolicyEndpoint(scope,workspaceSlug),{credentials:"same-origin",cache:"no-store",signal});
  return await result(response,false) as ArtifactPolicyList;
}
export async function postArtifactPolicyMutation(scope:ArtifactScope,mutation:ArtifactPolicyMutation,revision:number,workspaceSlug:string,fetcher:typeof fetch=fetch):Promise<{revision:number;changed:boolean;replayed:boolean}> {
  const endpoint=buildArtifactPolicyEndpoint(scope,workspaceSlug);
  if(!Number.isSafeInteger(revision)||revision<0)fail("policy_precondition_required",428);
  const {operation,effect,principalType,principalRef,requestId}=mutation;
  if(!["grant","revoke"].includes(operation)||!["allow","deny"].includes(effect)||!["user","group","role"].includes(principalType)||
    (principalType==="role"?principalRef!=="member":!UUID.test(principalRef))||!UUID.test(requestId))fail("invalid_policy_mutation");
  const body={...scope,operation,effect,principalType,principalRef,requestId};
  const response=await fetcher(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","If-Match":`"v${revision}"`},body:JSON.stringify(body)});
  return await result(response,true) as {revision:number;changed:boolean;replayed:boolean};
}
export function describeArtifactPolicy(rules:ArtifactPolicyRule[]):string {
  return rules.length===0
    ? "No additional artifact restrictions. Repository access remains required."
    : "Denies override allows. Rules restrict repository-authorized access; this list does not prove any individual principal's effective access.";
}
