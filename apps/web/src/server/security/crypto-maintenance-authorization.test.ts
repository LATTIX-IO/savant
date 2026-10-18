import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync,sign} from "node:crypto";
import {MaintenanceAuthorizationError,verifyGithubMaintenanceJwt,
  canonicalApprovalBytes,verifySignedMaintenanceApproval
} from "./crypto-maintenance-authorization.ts";

const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
const reviewer=generateKeyPairSync("ed25519");
const otherReviewer=generateKeyPairSync("ed25519");
const jwk={...rsa.publicKey.export({format:"jwk"}),kid:"fixture-key-1",alg:"RS256",use:"sig"};
const sha="a".repeat(40),now=Date.now();
const trust={
  repositoryId:"123456",expectedMainSha:sha,
  issuer:"https://token.actions.githubusercontent.com",
  audience:"api://savant-crypto-maintenance",
  subject:"repo:LATTIX-IO/savant:environment:savant-crypto-maintenance",
  workflowRef:"LATTIX-IO/savant/.github/workflows/crypto-maintenance.yml@refs/heads/main",
  oidcJwks:[jwk],approvalPublicKey:reviewer.publicKey,
  approvalReviewerId:"901"
};
const baseClaims={
  iss:trust.issuer,aud:trust.audience,sub:trust.subject,
  repository:"LATTIX-IO/savant",repository_id:trust.repositoryId,
  ref:"refs/heads/main",workflow_ref:trust.workflowRef,sha,
  event_name:"workflow_dispatch",actor_id:"900",run_id:"118800",
  run_attempt:"1",iat:Math.floor(now/1000)-10,
  nbf:Math.floor(now/1000)-10,exp:Math.floor(now/1000)+180
};
const enc=(o:unknown)=>Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims:Record<string,unknown>={},header:Record<string,unknown>={}){
  const payload=enc({...baseClaims,...claims}),head=enc({
    alg:"RS256",kid:jwk.kid,typ:"JWT",...header
  });
  const signed=head+"."+payload;
  return signed+"."+sign("RSA-SHA256",Buffer.from(signed),
    rsa.privateKey).toString("base64url");
}
function payload(){
  return {
    schema:"savant.crypto-maintenance-approval.v1" as const,
    approvalId:"11111111-1111-4111-8111-111111111111",
    organizationId:"22222222-2222-4222-8222-222222222222",
    target:"definitions" as const,maxRows:4,activeKeyId:"oct2026",
    backupId:"backup-ci-001",backupSha256:"b".repeat(64),
    changeTicket:"PER-1560",reviewerId:"901",runnerActorId:"900",
    githubRunId:"118800",githubRunAttempt:"1",mainSha:sha,
    notBeforeMs:now-30000,expiresAtMs:now+180000
  };
}
function approved(mod:Record<string,unknown>={}){
  const data={...payload(),...mod};
  return {
    payload:data as ReturnType<typeof payload>,
    signature:sign(null,canonicalApprovalBytes(data as ReturnType<typeof payload>),
      reviewer.privateKey).toString("base64url")
  };
}
const denied=(code:string)=>(error:unknown)=>
  error instanceof MaintenanceAuthorizationError&&error.code===code;
const identity=()=>verifyGithubMaintenanceJwt(token(),trust,now);
test("PER-1560: RS256 issuer key and exact protected workload claims verified",()=>{
  const i=identity();
  assert.deepEqual(i,{actorId:"900",runId:"118800",runAttempt:"1",
    sha,subject:"gha-900"});
  assert.equal(Object.isFrozen(i),true);
});
test("PER-1560: independently Ed25519-signed, short-lived tenant/ticket/key/backup plan binds run and actor",()=>{
  const p=verifySignedMaintenanceApproval(approved(),identity(),trust,now);
  assert.equal(p.organizationId,payload().organizationId);
  assert.equal(p.maxRows,4);
  assert.equal(p.target,"definitions");
  assert.equal(p.reviewerId,"901");
  assert.equal(p.actorId,"900");
  assert.equal(p.runId,"118800");
  assert.match(p.approvalSha256,/^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(p),true);
});
test("PER-1560: forged bearer, modified payload and bad signature deny",()=>{
  const original=token(),pieces=original.split(".");
  const forged=pieces[0]+"."+enc({...baseClaims,actor_id:"901"})+"."+pieces[2];
  assert.throws(()=>verifyGithubMaintenanceJwt(forged,trust,now),
    denied("oidc_signature_invalid"));
  assert.throws(()=>verifyGithubMaintenanceJwt(pieces[0]+"."+pieces[1]+"."+
    (pieces[2]![0]==="A"?"B":"A")+pieces[2]!.slice(1),trust,now),
    denied("oidc_signature_invalid"));
  assert.throws(()=>verifyGithubMaintenanceJwt("arbitrary",trust,now));
});
test("PER-1560: unsigned, injected algorithm and unsupported key IDs never select trust key",()=>{
  for(const header of [
    {alg:"none"},{alg:"HS256"},{kid:"attacker-key"},{jwk:jwk},
    {crit:["b64"]},{typ:"not-jwt"}
  ])assert.throws(()=>verifyGithubMaintenanceJwt(token({},header),trust,now));
  assert.throws(()=>verifyGithubMaintenanceJwt(token(),{
    ...trust,oidcJwks:[{...jwk,kid:"different"}]
  },now),denied("untrusted_oidc_key"));
  assert.throws(()=>verifyGithubMaintenanceJwt(token(),{
    ...trust,oidcJwks:[jwk,jwk]
  },now),denied("untrusted_oidc_key"));
});
test("PER-1560: wrong issuer, audience, environment, repository identity, branch, workflow and commit deny",()=>{
  const changes=[
    {iss:"https://attacker.invalid"},{aud:"other"},
    {sub:"repo:LATTIX-IO/savant:ref:refs/heads/main"},
    {sub:"repo:LATTIX-IO/savant:environment:production"},
    {repository:"another/repo"},{repository_id:"11"},{ref:"refs/heads/feature"},
    {workflow_ref:"LATTIX-IO/savant/.github/workflows/other.yml@refs/heads/main"},
    {event_name:"pull_request"},{sha:"c".repeat(40)},
    {actor_id:"not-identity"},{run_id:"0"},{run_attempt:"0"}
  ];
  for(const change of changes)assert.throws(()=>
    verifyGithubMaintenanceJwt(token(change),trust,now),
    denied("oidc_workload_scope_denied"));
});
test("PER-1560: expired, not-yet-valid, old, overlong or incomplete OIDC assertions deny",()=>{
  for(const claims of [
    {exp:Math.floor(now/1000)-1},
    {nbf:Math.floor(now/1000)+100},
    {iat:Math.floor(now/1000)-900},
    {iat:Math.floor(now/1000)+120},
    {exp:Math.floor(now/1000)+900},
    {exp:"tomorrow"},{nbf:null},{iat:null}
  ])assert.throws(()=>verifyGithubMaintenanceJwt(token(claims),trust,now),
    denied("oidc_token_expired"));
});
test("PER-1560: caller cannot change exact repo trust policy",()=>{
  for(const alt of [
    {repositoryId:"0"},{expectedMainSha:"f".repeat(40)},
    {issuer:"https://attacker.invalid"},
    {audience:"a-different-audience"},
    {subject:"repo:LATTIX-IO/savant:environment:production"},
    {workflowRef:"LATTIX-IO/savant/.github/workflows/other.yml@refs/heads/main"}
  ])assert.throws(()=>verifyGithubMaintenanceJwt(token(),{...trust,...alt},now));
});
test("PER-1560: approval signature tampering and wrong reviewer key fail closed",()=>{
  const signed=approved(),i=identity();
  assert.throws(()=>verifySignedMaintenanceApproval({
    ...signed,payload:{...signed.payload,target:"runs"}
  },i,trust,now),denied("approval_signature_invalid"));
  assert.throws(()=>verifySignedMaintenanceApproval(signed,i,{
    ...trust,approvalPublicKey:otherReviewer.publicKey
  },now),denied("approval_signature_invalid"));
  assert.throws(()=>verifySignedMaintenanceApproval({
    ...signed,signature:signed.signature.slice(0,-1)+"Z"
  },i,trust,now));
});
test("PER-1560: approval cannot authorize another operator, run, attempt or commit",()=>{
  const i=identity();
  const mutations=[
    {reviewerId:"900"},{reviewerId:"902"},{runnerActorId:"901"},
    {githubRunId:"118801"},{githubRunAttempt:"2"},{mainSha:"c".repeat(40)},
    {notBeforeMs:now+50000},{expiresAtMs:now-5000}
  ];
  for(const change of mutations){
    const signed=approved(change);
    assert.throws(()=>verifySignedMaintenanceApproval(signed,i,trust,now),
      denied("approval_not_valid_for_execution"));
  }
});
test("PER-1560: invalid grants reject unknown fields, accessors, IDs and overbroad batches",()=>{
  const p=payload();
  for(const change of [
    {maxRows:0},{maxRows:21},{maxRows:1.5},{target:"all"},
    {organizationId:"not-uuid"},{approvalId:"not-uuid"},{activeKeyId:"invalid?"},
    {backupSha256:"none"},{backupId:"../backup"},{changeTicket:"PER-0"},
    {notBeforeMs:now+200000},{expiresAtMs:now+3600000},
    {reviewerId:"0"},{githubRunAttempt:"0"}
  ])assert.throws(()=>canonicalApprovalBytes({...p,...change} as never));
  assert.throws(()=>canonicalApprovalBytes({...p,extra:"allow"} as never),
    denied("invalid_attestation_shape"));
  const accessor=Object.defineProperty({...p},"target",{
    enumerable:true,get(){throw Error("private content");}
  });
  assert.throws(()=>canonicalApprovalBytes(accessor),
    denied("invalid_attestation_shape"));
});
test("PER-1560: canonical signature bytes independent of object property order",()=>{
  const p=payload();const reversed=Object.fromEntries(Object.entries(p).reverse());
  assert.deepEqual(canonicalApprovalBytes(p),canonicalApprovalBytes(reversed as never));
});
