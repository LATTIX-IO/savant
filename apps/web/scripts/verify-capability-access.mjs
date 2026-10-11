import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { authorizeCapabilityRepository } from "../src/server/workflows/capability-access.ts";

const uri=process.env.DATABASE_URL;
if(process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||!uri||!["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname)){
  throw Error("Capability ACL integration tests require explicit loopback PostgreSQL opt-in");
}
const sql=postgres(uri,{max:1,prepare:false});
const slug=randomUUID().slice(0,10);
let a,b;
const denied=(error)=>error?.code==="not_found"&&error?.status===404;
try{
  [a]=await sql`insert into organizations(slug,display_name) values(${"cap-a-"+slug},'Cap A') returning id`;
  [b]=await sql`insert into organizations(slug,display_name) values(${"cap-b-"+slug},'Cap B') returning id`;
  const [repo]=await sql`insert into repositories(organization_id,provider_type,owner_name,repo_name,default_branch)
    values(${a.id},'github','capability-tests',${"repo-"+slug},'main') returning id`;
  const [owner]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${a.id},${"owner-"+slug},${"owner-"+slug+"@example.test"},'Owner') returning id`;
  const [member]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${a.id},${"member-"+slug},${"member-"+slug+"@example.test"},'Member') returning id`;
  const [foreign]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${b.id},${"foreign-"+slug},${"foreign-"+slug+"@example.test"},'Foreign') returning id`;
  const ownerActor={organizationId:a.id,subject:"owner-"+slug};
  const memberActor={organizationId:a.id,subject:"member-"+slug};
  const foreignActor={organizationId:b.id,subject:"foreign-"+slug};
  await authorizeCapabilityRepository(sql,ownerActor,repo.id);
  await assert.rejects(authorizeCapabilityRepository(sql,foreignActor,repo.id),denied);
  await assert.rejects(authorizeCapabilityRepository(sql,{organizationId:a.id,subject:foreignActor.subject},repo.id),denied);
  await assert.rejects(authorizeCapabilityRepository(sql,{organizationId:a.id,subject:"unknown"},repo.id),denied);
  await sql`insert into repository_permissions(repository_id,permission_key,granted_to_type,granted_to_ref)
    values(${repo.id},'read','user',${owner.id})`;
  await authorizeCapabilityRepository(sql,ownerActor,repo.id);
  await assert.rejects(authorizeCapabilityRepository(sql,memberActor,repo.id),denied);
  await sql`insert into repository_permissions(repository_id,permission_key,granted_to_type,granted_to_ref)
    values(${repo.id},'source:read','user',${member.id})`;
  await authorizeCapabilityRepository(sql,memberActor,repo.id);
  await sql`delete from repository_permissions where repository_id=${repo.id}`;
  await sql`insert into repository_permissions(repository_id,permission_key,granted_to_type,granted_to_ref)
    values(${repo.id},'unrecognized-write','role','Member')`;
  await assert.rejects(authorizeCapabilityRepository(sql,memberActor,repo.id),denied);
  await sql`delete from repository_permissions where repository_id=${repo.id}`;
  const [group]=await sql`insert into groups(organization_id,name) values(${a.id},${"qa-"+slug}) returning id`;
  await sql`insert into group_memberships(group_id,user_id) values(${group.id},${member.id})`;
  await sql`insert into repository_permissions(repository_id,permission_key,granted_to_type,granted_to_ref)
    values(${repo.id},'read','group',${group.id})`;
  await authorizeCapabilityRepository(sql,memberActor,repo.id);
  await assert.rejects(authorizeCapabilityRepository(sql,ownerActor,repo.id),denied);
  await sql`update repositories set status='disabled' where id=${repo.id}`;
  await assert.rejects(authorizeCapabilityRepository(sql,memberActor,repo.id),denied);
  await sql`update repositories set status='connected' where id=${repo.id}`;
  const times=[];
  for(let i=0;i<20;i++){
    const start=performance.now();
    await authorizeCapabilityRepository(sql,memberActor,repo.id);
    times.push(performance.now()-start);
  }
  times.sort((x,y)=>x-y);
  const p95=times[Math.ceil(times.length*0.95)-1];
  assert.ok(p95<3000,"Local DB ACL p95 regression guard is not production SLO");
  console.log(JSON.stringify({scope:"capability_acl",tenantIsolation:true,explicitAcl:true,
    groupGrant:true,unknownPermissionDenied:true,disabledDenied:true,
    localPgP95Ms:Number(p95.toFixed(3)),samples:times.length}));
}finally{
  if(a)await sql`delete from organizations where id=${a.id}`;
  if(b)await sql`delete from organizations where id=${b.id}`;
  await sql.end({timeout:5});
}
