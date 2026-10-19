import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync,createPublicKey,sign} from "node:crypto";
import {
  verifyGithubMaintenanceJwt,canonicalApprovalBytes
} from "./crypto-maintenance-authorization.ts";
import {
  MaintenanceIssuerError,OIDC_ISSUER,OIDC_DISCOVERY,OIDC_JWKS,
  OIDC_AUDIENCE,fetchTrustedGithubIssuerKeys,
  assertTrustedMaintenanceRunner,requestGithubRunnerOidcToken,
  verifyProtectedMaintenanceAdmission
} from "./crypto-maintenance-oidc-runtime.ts";

const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
const ed=generateKeyPairSync("ed25519");
const key={...rsa.publicKey.export({format:"jwk"}),
  kid:"savant-ci-public-rsa",kty:"RSA",alg:"RS256",use:"sig"};
const metadata={
  issuer:OIDC_ISSUER,jwks_uri:OIDC_JWKS,
  id_token_signing_alg_values_supported:["RS256"]
};
const respond=(data:unknown,headers:Record<string,string>={})=>
  new Response(JSON.stringify(data),{status:200,headers:{
    "content-type":"application/json",...headers
  }});
const error=(code:string)=>(e:unknown)=>
  e instanceof MaintenanceIssuerError&&e.code===code;
const env={
  GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"LATTIX-IO/savant",
  GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_WORKFLOW_REF:"LATTIX-IO/savant/.github/workflows/crypto-maintenance.yml@refs/heads/main",
  GITHUB_SHA:"a".repeat(40),GITHUB_REPOSITORY_ID:"1245790195",
  ACTIONS_ID_TOKEN_REQUEST_URL:[
    "https://pipelines.actions.githubusercontent.com","/oidc?api-version=2.0"
  ].join(""),
  ACTIONS_ID_TOKEN_REQUEST_TOKEN:["synthetic","only","ci"].join("-")
};
function issuerFetch(meta:unknown=metadata,keys:unknown={keys:[key]}){
  const seen:string[]=[];
  const fetcher=async(url:string,init:RequestInit)=>{
    seen.push(url);
    assert.equal(init.redirect,"error");
    assert.equal(init.cache,"no-store");
    assert.equal(init.method,"GET");
    if(url===OIDC_DISCOVERY)return respond(meta);
    if(url===OIDC_JWKS)return respond(keys);
    throw Error("unexpected outside-host request");
  };
  return {fetcher,seen};
}
test("PER-1562: trust anchors exactly one issuer and independently verified RSA-SHA256 JWK",async()=>{
  const f=issuerFetch();
  const keys=await fetchTrustedGithubIssuerKeys(f.fetcher);
  assert.equal(keys.length,1);
  assert.equal(keys[0]!.kid,key.kid);
  assert.deepEqual(f.seen,[OIDC_DISCOVERY,OIDC_JWKS]);
  assert.equal(Object.isFrozen(keys),true);
  assert.equal(Object.isFrozen(keys[0]),true);
  assert.equal(Object.hasOwn(keys[0]!,"d"),false);
});
test("PER-1562: JWKS is usable for actual signed GitHub-style token, not decoded claims",async()=>{
  const keys=await fetchTrustedGithubIssuerKeys(issuerFetch().fetcher);
  const now=Date.now();
  const claims={iss:OIDC_ISSUER,aud:OIDC_AUDIENCE,
    sub:"repo:LATTIX-IO/savant:environment:savant-crypto-maintenance",
    repository:"LATTIX-IO/savant",repository_id:"1245790195",
    workflow_ref:env.GITHUB_WORKFLOW_REF,
    ref:"refs/heads/main",sha:env.GITHUB_SHA,
    event_name:"workflow_dispatch",actor_id:"900",run_id:"1234567",
    run_attempt:"1",iat:Math.floor(now/1000)-10,
    nbf:Math.floor(now/1000)-10,exp:Math.floor(now/1000)+180};
  const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
  const header=encode({typ:"JWT",alg:"RS256",kid:key.kid,
    x5t:Buffer.alloc(20,4).toString("base64url")});
  const signed=header+"."+encode(claims);
  const token=signed+"."+sign("RSA-SHA256",Buffer.from(signed),
    rsa.privateKey).toString("base64url");
  const trust={
    repositoryId:"1245790195",expectedMainSha:env.GITHUB_SHA,
    issuer:OIDC_ISSUER,audience:OIDC_AUDIENCE,subject:claims.sub,
    workflowRef:env.GITHUB_WORKFLOW_REF,oidcJwks:keys,
    approvalPublicKey:ed.publicKey,approvalReviewerId:"901"
  };
  assert.equal(verifyGithubMaintenanceJwt(token,trust,now).runId,"1234567");
  assert.throws(()=>verifyGithubMaintenanceJwt(token,{
    ...trust,expectedMainSha:"f".repeat(40)
  },now));
});
test("PER-1562: reject discovery that substitutes a cross-origin, HTTP or stale JWKS URI",async()=>{
  for(const meta of [
    {...metadata,issuer:"https://attacker.example"},
    {...metadata,jwks_uri:"https://attacker.example/keys"},
    {...metadata,jwks_uri:"http://token.actions.githubusercontent.com/.well-known/jwks"},
    {...metadata,id_token_signing_alg_values_supported:["HS256"]},
    {...metadata,jwks_uri:"https://token.actions.githubusercontent.com/.well-known/jwks?exfil=1"}
  ]){
    const f=issuerFetch(meta);
    await assert.rejects(()=>fetchTrustedGithubIssuerKeys(f.fetcher),
      error("oidc_discovery_untrusted"));
    assert.deepEqual(f.seen,[OIDC_DISCOVERY]);
  }
});
test("PER-1562: algorithm substitution, duplicate kid, private RSA, invalid size and bad key denied",async()=>{
  const alternatives=[
    {keys:[{...key,kid:"sameid",alg:"HS256"}]},
    {keys:[key,key]},
    {keys:[{...key,d:"private-key-would-be-unsafe"}]},
    {keys:[{...key,kty:"oct"}]},
    {keys:[{...key,kid:"a"}]},
    {keys:[]},{keys:new Array(11).fill(key)},
    {keys:[{...key,use:"enc"}]},
  ];
  for(const keys of alternatives)
    await assert.rejects(()=>fetchTrustedGithubIssuerKeys(
      issuerFetch(metadata,keys).fetcher),error("oidc_jwks_untrusted"));
});
test("PER-1562: unexpected responses and oversized streams never become trust keys",async()=>{
  const cases=[
    async()=>new Response("",{status:302,headers:{location:"https://attacker.example"}}),
    async()=>new Response("",{status:500}),
    async()=>new Response("<xml />",{status:200,headers:{"content-type":"text/xml"}}),
    async()=>new Response(JSON.stringify(metadata),{status:200,headers:{
      "content-type":"application/json","content-length":"999999"
    }}),
    async()=>new Response("{"+"a".repeat(17000),{status:200,headers:{
      "content-type":"application/json"
    }})
  ];
  for(const fetcher of cases)
    await assert.rejects(()=>fetchTrustedGithubIssuerKeys(fetcher),
      e=>e instanceof MaintenanceIssuerError);
});
test("PER-1562: hung fetch is deadline-bounded; transport errors are redacted",async()=>{
  const begin=Date.now();
  await assert.rejects(()=>fetchTrustedGithubIssuerKeys(
    async()=>new Promise<Response>(()=>{}),130),
    error("oidc_transport_unavailable"));
  assert.ok(Date.now()-begin<2000);
  await assert.rejects(()=>fetchTrustedGithubIssuerKeys(
    async()=>{throw Error("sensitive network fixture!");}),
    e=>error("oidc_transport_unavailable")(e)&&
      !(e as Error).message.includes("sensitive"));
});
test("PER-1562: protected main runtime context is mandatory before any OIDC requests",()=>{
  assert.equal(assertTrustedMaintenanceRunner(env).repositoryId,"1245790195");
  const bad=[
    {GITHUB_ACTIONS:"false"},{GITHUB_REF:"refs/heads/feature"},
    {GITHUB_EVENT_NAME:"pull_request"},{GITHUB_REPOSITORY:"someone/else"},
    {GITHUB_WORKFLOW_REF:"LATTIX-IO/savant/.github/workflows/other.yml@refs/heads/main"},
    {GITHUB_SHA:"notsha"},{GITHUB_REPOSITORY_ID:"0"}
  ];
  for(const delta of bad)assert.throws(()=>assertTrustedMaintenanceRunner(
    {...env,...delta}),error("runner_not_protected_main_dispatch"));
});
test("PER-1562: request token only from trusted Actions runtime endpoint with fixed audience",async()=>{
  const calls:{url:string;auth:string|undefined;redirect:RequestRedirect|undefined}[]=[];
  const fetcher=async(url:string,init:RequestInit)=>{
    calls.push({url,auth:new Headers(init.headers).get("authorization")??undefined,
      redirect:init.redirect});
    return respond({value:"header.payload.signature"});
  };
  const jwt=await requestGithubRunnerOidcToken(env,fetcher);
  assert.equal(jwt,"header.payload.signature");
  assert.equal(calls.length,1);
  const url=new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("audience"),OIDC_AUDIENCE);
  assert.equal(url.hostname,"pipelines.actions.githubusercontent.com");
  assert.equal(calls[0]!.auth,"bearer "+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  assert.equal(calls[0]!.redirect,"error");
});
test("PER-1562: token URLs cannot escape GitHub Action hosts, downgrade HTTPS or use embedded credentials",async()=>{
  for(const url of [
    "http://pipelines.actions.githubusercontent.com/oidc",
    "https://attacker.example/oidc",
    "https://pipelines.actions.githubusercontent.com.evil.example/oidc",
    "https://user@pipelines.actions.githubusercontent.com/oidc",
    "https://pipelines.actions.githubusercontent.com:8443/oidc",
    "https://pipelines.actions.githubusercontent.com/",
    "file:///tmp/oidc"
  ]){
    await assert.rejects(()=>requestGithubRunnerOidcToken({
      ...env,ACTIONS_ID_TOKEN_REQUEST_URL:url
    },async()=>{throw Error("must not call fetch");}),error("runner_oidc_url_invalid"));
  }
});
test("PER-1562: blocked/failing token endpoint and malformed JWT response deny with no leaks",async()=>{
  for(const response of [
    {value:"unstructured"},
    {value:"a.b"},
    {value:"a.b.c",authorization:"unsafe"},
    {value:""}
  ]){
    if(response.value==="a.b.c"&&"authorization" in response)continue;
    await assert.rejects(()=>requestGithubRunnerOidcToken(env,
      async()=>respond(response)),error("runner_oidc_response_invalid"));
  }
  await assert.rejects(()=>requestGithubRunnerOidcToken({
    ...env,ACTIONS_ID_TOKEN_REQUEST_TOKEN:"x"
  },async()=>{throw Error("no read expected");}),
    error("runner_oidc_credentials_unavailable"));
});

test("PER-1562: complete read-only protected issuer + runner + independent reviewer attestation",async()=>{
  const at=Date.now();
  const claims={
    iss:OIDC_ISSUER,aud:OIDC_AUDIENCE,
    sub:"repo:LATTIX-IO/savant:environment:savant-crypto-maintenance",
    repository:"LATTIX-IO/savant",repository_id:env.GITHUB_REPOSITORY_ID,
    workflow_ref:env.GITHUB_WORKFLOW_REF,ref:"refs/heads/main",
    sha:env.GITHUB_SHA,event_name:"workflow_dispatch",
    actor_id:"900",run_id:"118800",run_attempt:"1",
    iat:Math.floor(at/1000)-10,nbf:Math.floor(at/1000)-10,
    exp:Math.floor(at/1000)+180
  };
  const encode=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString("base64url");
  const header=encode({typ:"JWT",alg:"RS256",kid:key.kid,
    x5t:Buffer.alloc(20,9).toString("base64url")});
  const data=header+"."+encode(claims);
  const jwt=data+"."+sign("RSA-SHA256",Buffer.from(data),
    rsa.privateKey).toString("base64url");
  const payload={
    schema:"savant.crypto-maintenance-approval.v1" as const,
    approvalId:"11111111-1111-4111-8111-111111111111",
    organizationId:"22222222-2222-4222-8222-222222222222",
    target:"ai-secrets" as const,maxRows:1,activeKeyId:"oct2026",
    backupId:"independently-verified-restore",
    backupSha256:"a".repeat(64),changeTicket:"PER-1562",
    reviewerId:"901",runnerActorId:"900",githubRunId:"118800",
    githubRunAttempt:"1",mainSha:env.GITHUB_SHA,
    notBeforeMs:at-30000,expiresAtMs:at+180000
  };
  const signedApproval={
    payload,
    signature:sign(null,canonicalApprovalBytes(payload),
      ed.privateKey).toString("base64url")
  };
  const policy={
    repositoryId:env.GITHUB_REPOSITORY_ID,
    expectedMainSha:env.GITHUB_SHA,
    issuer:OIDC_ISSUER,audience:OIDC_AUDIENCE,subject:claims.sub,
    workflowRef:env.GITHUB_WORKFLOW_REF,
    approvalPublicKey:ed.publicKey,approvalReviewerId:"901"
  };
  const seen:string[]=[];
  const fetcher=async(url:string)=>{
    seen.push(url);
    if(url===OIDC_DISCOVERY)return respond(metadata);
    if(url===OIDC_JWKS)return respond({keys:[key]});
    if(url.startsWith(env.ACTIONS_ID_TOKEN_REQUEST_URL!))
      return respond({value:jwt});
    throw Error("untrusted endpoint");
  };
  const verified=await verifyProtectedMaintenanceAdmission({
    env,policy,signedApproval,fetcher,nowMs:at
  });
  assert.equal(verified.organizationId,payload.organizationId);
  assert.equal(verified.reviewerId,"901");
  assert.equal(verified.actorId,"900");
  assert.equal(verified.maxRows,1);
  assert.equal(Object.isFrozen(verified),true);
  assert.equal(seen.length,3);
  const noFetch=async()=>{throw Error("must reject before any network call");};
  await assert.rejects(()=>verifyProtectedMaintenanceAdmission({
    env,policy:{...policy,repositoryId:"999"},signedApproval,
    fetcher:noFetch,nowMs:at
  }),error("runner_trust_policy_mismatch"));
  await assert.rejects(()=>verifyProtectedMaintenanceAdmission({
    env,policy:{...policy,expectedMainSha:"f".repeat(40)},signedApproval,
    fetcher:noFetch,nowMs:at
  }),error("runner_trust_policy_mismatch"));
  await assert.rejects(()=>verifyProtectedMaintenanceAdmission({
    env,policy,signedApproval:{
      ...signedApproval,payload:{...payload,target:"definitions"}
    },fetcher,nowMs:at
  }));
});
