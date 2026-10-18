/**
 * PER-1560 — signature-verified maintenance identity and independent approval.
 *
 * This module is intentionally server-only. A caller-supplied role/scope,
 * decoded JWT payload, or unverified approval document is NEVER authority.
 * Trust roots must come from a privileged workload/KMS configuration, never
 * a tenant request, pull-request payload, or repository checkout.
 */
import {
  createPublicKey,verify as cryptoVerify,createHash,
  type KeyObject,type JsonWebKey
} from "node:crypto";

export class MaintenanceAuthorizationError extends Error{
  readonly code:string;
  constructor(code:string){super(code);this.name="MaintenanceAuthorizationError";this.code=code;}
}
const deny=(code:string):never=>{throw new MaintenanceAuthorizationError(code);};
const SHA=/^[0-9a-f]{40}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const DEC=/^[1-9][0-9]{0,15}$/;
const KID=/^[A-Za-z0-9_-]{5,128}$/;
const B64=/^[A-Za-z0-9_-]+$/;
const APPROVAL_FIELDS=[
  "schema","approvalId","organizationId","target","maxRows","activeKeyId",
  "backupId","backupSha256","changeTicket","reviewerId","runnerActorId",
  "githubRunId","githubRunAttempt","mainSha","notBeforeMs","expiresAtMs"
] as const;
export type MaintenanceApprovalPayload={
  schema:"savant.crypto-maintenance-approval.v1";
  approvalId:string;organizationId:string;
  target:"definitions"|"runs"|"ai-secrets";
  maxRows:number;activeKeyId:string;backupId:string;backupSha256:string;
  changeTicket:string;reviewerId:string;runnerActorId:string;
  githubRunId:string;githubRunAttempt:string;mainSha:string;
  notBeforeMs:number;expiresAtMs:number;
};
export type SignedMaintenanceApproval={payload:MaintenanceApprovalPayload;signature:string};
export type VerifiedMaintenanceIdentity={
  actorId:string;runId:string;runAttempt:string;sha:string;subject:string;
};
export type MaintenanceTrustPolicy={
  repositoryId:string;expectedMainSha:string;
  issuer:string;audience:string;subject:string;workflowRef:string;
  /** Only externally verified issuer keys; never take a JWK from the JWT header. */
  oidcJwks:ReadonlyArray<JsonWebKey&{kid?:string;alg?:string;use?:string}>;
  /** Independent reviewer's pinned public Ed25519 signing key. */
  approvalPublicKey:KeyObject;
};
function object(value:unknown):Record<string,unknown>{
  try{
    if(!value||typeof value!=="object"||Array.isArray(value)||
      (Object.getPrototypeOf(value as object)!==Object.prototype&&Object.getPrototypeOf(value)!==null))
      deny("invalid_attestation_shape");
    const d=Object.getOwnPropertyDescriptors(value as object);
    if(Reflect.ownKeys(value).length!==Object.keys(d).length ||
      Object.values(d).some(x=>!("value" in x)))deny("invalid_attestation_shape");
    return Object.fromEntries(Object.entries(d).map(([k,x])=>[k,x.value]));
  }catch{return deny("invalid_attestation_shape");}
}
function exact(value:Record<string,unknown>,keys:readonly string[]){
  if(Object.keys(value).length!==keys.length||
    keys.some(k=>!Object.hasOwn(value,k)))deny("invalid_attestation_shape");
}
function b64(s:unknown,max:number):Buffer{
  if(typeof s!=="string"||s.length>max||!B64.test(s))
    deny("invalid_attestation_encoding");
  const decoded=Buffer.from(s as string,"base64url");
  if(!decoded.length||decoded.toString("base64url")!==s)
    deny("invalid_attestation_encoding");
  return decoded;
}
function safeJson(s:Buffer,max:number):Record<string,unknown>{
  if(s.length>max)deny("invalid_attestation_size");
  try{return object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(s)));}
  catch{return deny("invalid_attestation_encoding");}
}
function time(nowMs:number):number{
  if(!Number.isSafeInteger(nowMs)||nowMs<1)deny("invalid_trusted_clock");
  return nowMs;
}
function numberString(s:unknown):s is string{
  return typeof s==="string"&&DEC.test(s)&&Number.isSafeInteger(Number(s));
}
function policy(p:MaintenanceTrustPolicy){
  if(!p||!numberString(p.repositoryId)||!SHA.test(p.expectedMainSha)||
    p.issuer!=="https://token.actions.githubusercontent.com"||
    p.audience!=="api://savant-crypto-maintenance"||
    p.subject!=="repo:LATTIX-IO/savant:environment:savant-crypto-maintenance"||
    p.workflowRef!=="LATTIX-IO/savant/.github/workflows/crypto-maintenance.yml@refs/heads/main"||
    !Array.isArray(p.oidcJwks)||p.oidcJwks.length<1||p.oidcJwks.length>10||
    !p.approvalPublicKey||p.approvalPublicKey.type!=="public"||
    p.approvalPublicKey.asymmetricKeyType!=="ed25519")deny("untrusted_maintenance_policy");
}
/** Verify RSA-SHA256 JWT signature against a previously authenticated trusted JWKS,
 * THEN inspect the bounded time, GitHub Actions workflow and environment claims.
 * Public key refresh and TLS issuer pinning belong to the privileged identity adapter.
 */
export function verifyGithubMaintenanceJwt(
  jwt:string,trust:MaintenanceTrustPolicy,nowMs:number
):VerifiedMaintenanceIdentity{
  policy(trust);
  const now=time(nowMs);
  if(typeof jwt!=="string"||jwt.length>16384)deny("invalid_oidc_token");
  const pieces=jwt.split(".");
  if(pieces.length!==3)deny("invalid_oidc_token");
  const header=safeJson(b64(pieces[0],600),400);
  exact(header,["alg","kid","typ"]);
  if(header.alg!=="RS256"||header.typ!=="JWT"||
    typeof header.kid!=="string"||!KID.test(header.kid))
    deny("untrusted_oidc_algorithm");
  const keys=trust.oidcJwks.filter(k=>k.kid===header.kid);
  if(keys.length!==1)deny("untrusted_oidc_key");
  const jwk=object(keys[0]);
  if(jwk.kty!=="RSA"||jwk.alg!=="RS256"||jwk.use!=="sig"||
    typeof jwk.n!=="string"||typeof jwk.e!=="string")
    deny("untrusted_oidc_key");
  let key:KeyObject;
  try{
    key=createPublicKey({key:jwk as JsonWebKey,format:"jwk"});
    if((key.asymmetricKeyDetails?.modulusLength??0)<2048)
      deny("untrusted_oidc_key");
  }catch{return deny("untrusted_oidc_key");}
  const signature=b64(pieces[2],2048);
  let valid=false;
  try{valid=cryptoVerify("RSA-SHA256",
    Buffer.from(pieces[0]+"."+pieces[1],"ascii"),key,signature);}
  catch{return deny("oidc_signature_invalid");}
  if(!valid)deny("oidc_signature_invalid");
  const c=safeJson(b64(pieces[1],11000),8192);
  if(c.iss!==trust.issuer||c.aud!==trust.audience||
    c.sub!==trust.subject||c.repository!=="LATTIX-IO/savant"||
    c.repository_id!==trust.repositoryId||
    c.ref!=="refs/heads/main"||c.workflow_ref!==trust.workflowRef||
    c.sha!==trust.expectedMainSha||c.event_name!=="workflow_dispatch"||
    !numberString(c.actor_id)||!numberString(c.run_id)||
    !numberString(c.run_attempt))deny("oidc_workload_scope_denied");
  if(typeof c.exp!=="number"||typeof c.nbf!=="number"||
    typeof c.iat!=="number"||
    ![c.exp,c.nbf,c.iat].every(Number.isSafeInteger)||
    c.exp*1000<=now||c.nbf*1000>now+20000||
    c.iat*1000>now+20000||now-c.iat*1000>300000||
    c.exp-c.iat>600||c.exp<=c.nbf)
    deny("oidc_token_expired");
  return Object.freeze({
    actorId:c.actor_id as string,runId:c.run_id as string,
    runAttempt:c.run_attempt as string,sha:c.sha as string,
    subject:"gha-"+(c.actor_id as string)
  });
}
/** Stable, fixed-field canonical bytes shared with an offline approver.
 * Object key order and unknown fields cannot change signed semantics.
 */
export function canonicalApprovalBytes(input:MaintenanceApprovalPayload):Buffer{
  const p=object(input);
  exact(p,APPROVAL_FIELDS);
  if(p.schema!=="savant.crypto-maintenance-approval.v1"||
    typeof p.approvalId!=="string"||!UUID.test(p.approvalId)||
    typeof p.organizationId!=="string"||!UUID.test(p.organizationId)||
    !["definitions","runs","ai-secrets"].includes(p.target as string)||
    !Number.isSafeInteger(p.maxRows)||Number(p.maxRows)<1||Number(p.maxRows)>20||
    typeof p.activeKeyId!=="string"||!ID.test(p.activeKeyId)||
    typeof p.backupId!=="string"||!ID.test(p.backupId)||
    typeof p.backupSha256!=="string"||!DIGEST.test(p.backupSha256)||
    typeof p.changeTicket!=="string"||!/^PER-[1-9][0-9]{0,6}$/.test(p.changeTicket)||
    !numberString(p.reviewerId)||!numberString(p.runnerActorId)||
    !numberString(p.githubRunId)||!numberString(p.githubRunAttempt)||
    typeof p.mainSha!=="string"||!SHA.test(p.mainSha)||
    !Number.isSafeInteger(p.notBeforeMs)||!Number.isSafeInteger(p.expiresAtMs)||
    Number(p.expiresAtMs)<=Number(p.notBeforeMs)||
    Number(p.expiresAtMs)-Number(p.notBeforeMs)>900000)
    deny("invalid_maintenance_approval");
  return Buffer.from(JSON.stringify(
    Object.fromEntries(APPROVAL_FIELDS.map(k=>[k,p[k]]))),"utf8");
}
export type VerifiedMaintenancePermit={
  approvalId:string;organizationId:string;
  target:"definitions"|"runs"|"ai-secrets";
  maxRows:number;activeKeyId:string;backupId:string;backupSha256:string;
  changeTicket:string;reviewerId:string;actorId:string;
  runId:string;runAttempt:string;mainSha:string;
  approvalSha256:string;
};
export function verifySignedMaintenanceApproval(
  signed:SignedMaintenanceApproval,identity:VerifiedMaintenanceIdentity,
  trust:MaintenanceTrustPolicy,nowMs:number
):VerifiedMaintenancePermit{
  policy(trust);const now=time(nowMs);
  const record=object(signed);
  exact(record,["payload","signature"]);
  const body=canonicalApprovalBytes(record.payload as MaintenanceApprovalPayload);
  const sig=b64(record.signature,512);
  if(sig.length!==64)deny("invalid_approval_signature");
  if(!cryptoVerify(null,body,trust.approvalPublicKey,sig))
    deny("approval_signature_invalid");
  const p=object(record.payload);
  if(p.runnerActorId!==identity.actorId||
    p.reviewerId===identity.actorId||
    p.githubRunId!==identity.runId||
    p.githubRunAttempt!==identity.runAttempt||
    p.mainSha!==identity.sha||p.mainSha!==trust.expectedMainSha||
    Number(p.notBeforeMs)>now||Number(p.expiresAtMs)<=now)
    deny("approval_not_valid_for_execution");
  return Object.freeze({
    approvalId:p.approvalId as string,
    organizationId:p.organizationId as string,
    target:p.target as VerifiedMaintenancePermit["target"],
    maxRows:p.maxRows as number,activeKeyId:p.activeKeyId as string,
    backupId:p.backupId as string,backupSha256:p.backupSha256 as string,
    changeTicket:p.changeTicket as string,reviewerId:p.reviewerId as string,
    actorId:identity.actorId,runId:identity.runId,
    runAttempt:identity.runAttempt,mainSha:identity.sha,
    approvalSha256:createHash("sha256").update(body).digest("hex")
  });
}
