import { createHash } from "node:crypto";

export class PolicyAdminError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code:string,status:number){
    super(code);this.name="PolicyAdminError";this.code=code;this.status=status;
  }
}
export type PolicyScope={
  repositoryId:string;
  kind:"skill"|"workflow_spec";
  artifactId:string;
};
export type PolicyMutation=PolicyScope&{
  operation:"grant"|"revoke";
  effect:"allow"|"deny";
  principalType:"user"|"group"|"role";
  principalRef:string;
  requestId:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
function safeRecord(value:unknown):value is Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.values(descriptors).some(x=>!("value" in x)))return false;
  if(Object.keys(descriptors).some(x=>["__proto__","constructor","prototype"].includes(x)))return false;
  return true;
}
function normalizeScope(raw:unknown,keys:readonly string[],errorCode:string):PolicyScope{
  if(!safeRecord(raw))throw new PolicyAdminError(errorCode,422);
  if(Object.keys(raw).some(k=>!keys.includes(k)))throw new PolicyAdminError(errorCode,422);
  const repositoryId=raw.repositoryId,kind=raw.kind,artifactId=raw.artifactId;
  if(typeof repositoryId!=="string"||!UUID.test(repositoryId)||typeof artifactId!=="string"||
     !ARTIFACT.test(artifactId)||artifactId.includes("..")|| !["skill","workflow_spec"].includes(kind as string))
    throw new PolicyAdminError(errorCode,422);
  return {repositoryId:repositoryId.toLowerCase(),kind:kind as PolicyScope["kind"],artifactId};
}
export function parsePolicyScope(raw:unknown):PolicyScope{
  return normalizeScope(raw,["repositoryId","kind","artifactId"],"invalid_policy_scope");
}
export function parsePolicyMutation(raw:unknown):PolicyMutation{
  const keyset=["repositoryId","kind","artifactId","operation","effect","principalType","principalRef","requestId"] as const;
  const base=normalizeScope(raw,keyset,"invalid_policy_mutation");
  if(!safeRecord(raw))throw new PolicyAdminError("invalid_policy_mutation",422);
  const {operation,effect,principalType,principalRef,requestId}=raw;
  if((operation!=="grant"&&operation!=="revoke")||
    (effect!=="allow"&&effect!=="deny")||
    (principalType!=="user"&&principalType!=="group"&&principalType!=="role")||
    typeof principalRef!=="string"||typeof requestId!=="string"||!UUID.test(requestId)||
    (principalType==="role" ? principalRef!=="member" : !UUID.test(principalRef)))
    throw new PolicyAdminError("invalid_policy_mutation",422);
  return {...base,operation,effect,principalType,principalRef:
    principalType==="role"?"member":principalRef.toLowerCase(),requestId:requestId.toLowerCase()};
}
export function parsePolicyIfMatch(raw:string|null|undefined):number{
  const m=typeof raw==="string"?/^"v(0|[1-9][0-9]*)"$/.exec(raw):null;
  if(!m||!Number.isSafeInteger(Number(m[1])))throw new PolicyAdminError("policy_precondition_required",428);
  return Number(m[1]);
}
export function policyETag(revision:number):string{return `"v${revision}"`;}
export function policyMutationDigest(input:PolicyMutation):string{
  // Canonical field order: stable retry integrity even with different JSON property order.
  const bytes=JSON.stringify([
    input.repositoryId,input.kind,input.artifactId,
    input.operation,input.effect,input.principalType,input.principalRef,
  ]);
  return createHash("sha256").update(bytes,"utf8").digest("hex");
}
