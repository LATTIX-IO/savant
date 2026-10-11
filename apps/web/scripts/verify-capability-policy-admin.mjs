import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import postgres from "postgres";
import {createCapabilityPolicyAdmin} from "../src/server/workflows/capability-policy-admin.ts";
import {parsePolicyMutation, parsePolicyScope} from "../src/server/workflows/capability-policy-contract.ts";
import {authorizeCapabilityArtifact} from "../src/server/workflows/capability-artifact-access.ts";

const uri=process.env.DATABASE_URL;
if(process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||!uri||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname)){
  throw Error("Policy administration tests require isolated loopback PostgreSQL opt-in");
}
const sql=postgres(uri,{max:8,prepare:false});
const service=createCapabilityPolicyAdmin(sql),nonce=randomUUID().slice(0,10);
const errorCode=code=>e=>e?.code===code;
let org,foreignOrg;
try{
  [org]=await sql`insert into organizations(slug,display_name) values(${"pol-a-"+nonce},'Policy A') returning id`;
  [foreignOrg]=await sql`insert into organizations(slug,display_name) values(${"pol-b-"+nonce},'Policy B') returning id`;
  const [repo]=await sql`insert into repositories(organization_id,provider_type,owner_name,repo_name,default_branch)
    values(${org.id},'github','policy-tests',${"repo-"+nonce},'main') returning id`;
  const [admin]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${org.id},${"admin-"+nonce},${"admin-"+nonce+"@example.test"},'Admin') returning id`;
  const [member]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${org.id},${"member-"+nonce},${"member-"+nonce+"@example.test"},'Member') returning id`;
  const [disabled]=await sql`insert into users(organization_id,external_subject,email,display_name,status)
    values(${org.id},${"disabled-"+nonce},${"disabled-"+nonce+"@example.test"},'Disabled','disabled') returning id`;
  const [outsider]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${foreignOrg.id},${"foreign-"+nonce},${"foreign-"+nonce+"@example.test"},'Foreign') returning id`;
  const [foreignGroup]=await sql`insert into groups(organization_id,name)
    values(${foreignOrg.id},${"foreign-"+nonce}) returning id`;
  const adminActor={organizationId:org.id,subject:"admin-"+nonce};
  const memberActor={organizationId:org.id,subject:"member-"+nonce};
  const foreignActor={organizationId:foreignOrg.id,subject:"foreign-"+nonce};
  const scope=parsePolicyScope({repositoryId:repo.id,kind:"workflow_spec",artifactId:"triage"});
  const rule=(override={})=>parsePolicyMutation({...scope,
    operation:"grant",effect:"allow",principalType:"user",principalRef:member.id,
    requestId:randomUUID(),...override});
  const initial=await service.list(adminActor,scope);
  assert.deepEqual(initial,{revision:0,rules:[]});
  await assert.rejects(service.list(memberActor,scope),errorCode("forbidden"));
  await assert.rejects(service.list(foreignActor,scope),errorCode("not_found"));
  await assert.rejects(service.mutate(memberActor,rule(),0),errorCode("forbidden"));
  await assert.rejects(service.mutate(foreignActor,rule(),0),errorCode("not_found"));
  await assert.rejects(service.mutate(adminActor,rule({principalRef:outsider.id}),0),errorCode("principal_not_found"));
  await assert.rejects(service.mutate(adminActor,rule({principalRef:disabled.id}),0),errorCode("principal_not_found"));
  await assert.rejects(service.mutate(adminActor,rule({principalType:"group",principalRef:foreignGroup.id}),0),errorCode("principal_not_found"));
  const firstRule=rule();
  const first=await service.mutate(adminActor,firstRule,0);
  assert.deepEqual(first,{revision:1,changed:true,replayed:false});
  const replay=await service.mutate(adminActor,firstRule,0);
  assert.deepEqual(replay,{revision:1,changed:true,replayed:true});
  await assert.rejects(service.mutate(adminActor,{...firstRule,effect:"deny"},1),errorCode("policy_idempotency_conflict"));
  await assert.rejects(service.mutate(adminActor,rule(),0),errorCode("policy_revision_conflict"));
  let state=await service.list(adminActor,scope);
  assert.equal(state.revision,1);
  assert.equal(state.rules.length,1);
  assert.equal(state.rules[0].principalRef,member.id);
  const noOp=await service.mutate(adminActor,rule(),1);
  assert.deepEqual(noOp,{revision:1,changed:false,replayed:false});
  const revoked=await service.mutate(adminActor,rule({operation:"revoke"}),1);
  assert.deepEqual(revoked,{revision:2,changed:true,replayed:false});
  assert.deepEqual(await service.list(adminActor,scope),{revision:2,rules:[]});
  const concurrent=await Promise.allSettled([
    service.mutate(adminActor,rule({effect:"allow"}),2),
    service.mutate(adminActor,rule({effect:"deny"}),2),
  ]);
  assert.equal(concurrent.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(concurrent.filter(x=>x.status==="rejected"&&x.reason.code==="policy_revision_conflict").length,1);
  state=await service.list(adminActor,scope);
  assert.equal(state.revision,3);
  assert.equal(state.rules.length,1);
  const audit=await sql`select actor_ref,request_id,payload_redacted from audit_events
    where organization_id=${org.id} and action='artifact_policy_mutated'`;
  assert.equal(audit.length,4,"Only unique committed operations should have transactional audit records");
  for(const record of audit){
    assert.equal(record.actor_ref,adminActor.subject);
    assert.equal(JSON.stringify(record.payload_redacted).includes(member.id),false);
    assert.equal(JSON.stringify(record.payload_redacted).includes("@example"),false);
  }
  // Offboarding must prevent NEW grants but must not trap stale existing rules.
  await sql`update users set status='disabled' where id=${member.id}`;
  await assert.rejects(service.mutate(adminActor,rule(),3),errorCode("principal_not_found"));
  const clean=await service.mutate(adminActor,rule({
    operation:"revoke",effect:state.rules[0].effect,principalRef:member.id,
  }),3);
  assert.deepEqual(clean,{revision:4,changed:true,replayed:false});
  await sql`update users set status='active' where id=${member.id}`;
  assert.equal((await service.list(adminActor,scope)).rules.length,0);
  const [group]=await sql`insert into groups(organization_id,name) values(${org.id},'platform-admins') returning id`;
  await sql`insert into group_memberships(group_id,user_id) values(${group.id},${member.id})`;
  await service.list(memberActor,scope);
  await sql`delete from group_memberships where group_id=${group.id} and user_id=${member.id}`;
  await assert.rejects(service.list(memberActor,scope),errorCode("forbidden"));
  const timings=[];
  for(let i=0;i<20;i++){
    const start=performance.now();
    await service.list(adminActor,scope);
    timings.push(performance.now()-start);
  }
  timings.sort((a,b)=>a-b);
  const p95=timings[Math.ceil(timings.length*0.95)-1];
  assert.ok(p95<3000,"Local policy inspector benchmark is a generous regression ceiling, not an API SLO");
  console.log(JSON.stringify({scope:"capability_policy_admin",twoTenant:true,revisionConflict:true,
    retrySafe:true,disabledPrincipalDenied:true,groupAdmin:true,atomicAudit:true,
    concurrencySerialized:true,localPgP95Ms:Number(p95.toFixed(3)),samples:timings.length}));
}finally{
  if(org)await sql`delete from organizations where id=${org.id}`;
  if(foreignOrg)await sql`delete from organizations where id=${foreignOrg.id}`;
  await sql.end({timeout:5});
}
