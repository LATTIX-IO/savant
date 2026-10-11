import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { authorizeCapabilityRepository } from "../src/server/workflows/capability-access.ts";
import { authorizeCapabilityArtifact } from "../src/server/workflows/capability-artifact-access.ts";
import { createCapabilityResolver } from "../src/server/workflows/capability-resolver.ts";
import { createCapabilityLinkService } from "../src/server/workflows/capability-links.ts";

const uri=process.env.DATABASE_URL;
if(process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||!uri||
 !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("Artifact ACL integration requires explicit local PostgreSQL opt-in.");
const sql=postgres(uri,{max:1,prepare:false});
const slug=randomUUID().slice(0,10);
const denied=e=>e?.code==="not_found"&&e?.status===404;
let firstOrg,foreignOrg;
try {
  [firstOrg]=await sql`insert into organizations(slug,display_name) values(${"artifact-a-"+slug},'Artifact tenant') returning id`;
  [foreignOrg]=await sql`insert into organizations(slug,display_name) values(${"artifact-b-"+slug},'Foreign tenant') returning id`;
  const [repoA]=await sql`insert into repositories(organization_id,provider_type,owner_name,repo_name,default_branch)
    values(${firstOrg.id},'github','artifact-tests',${"repo-a-"+slug},'main') returning id`;
  const [repoB]=await sql`insert into repositories(organization_id,provider_type,owner_name,repo_name,default_branch)
    values(${firstOrg.id},'github','artifact-tests',${"repo-b-"+slug},'main') returning id`;
  const [owner]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${firstOrg.id},${"owner-"+slug},${"owner-"+slug+"@example.test"},'Owner') returning id`;
  const [member]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${firstOrg.id},${"member-"+slug},${"member-"+slug+"@example.test"},'Member') returning id`;
  const [foreign]=await sql`insert into users(organization_id,external_subject,email,display_name)
    values(${foreignOrg.id},${"foreign-"+slug},${"foreign-"+slug+"@example.test"},'Foreign') returning id`;
  const ownerActor={organizationId:firstOrg.id,subject:"owner-"+slug};
  const memberActor={organizationId:firstOrg.id,subject:"member-"+slug};
  const foreignActor={organizationId:foreignOrg.id,subject:"foreign-"+slug};
  const artifact=(repoId,kind="workflow_spec",artifactId="triage")=>({
    organizationId:firstOrg.id,repositoryId:repoId,kind,artifactId,
  });
  const rule=async (repoId,kind,id,effect,principalType,principalRef)=>sql`
    insert into capability_artifact_permissions
      (organization_id,repository_id,artifact_kind,artifact_id,effect,granted_to_type,granted_to_ref)
    values(${firstOrg.id},${repoId},${kind},${id},${effect},${principalType},${principalRef})
  `;

  // Existing repository policy stays mandatory in the production authorize() chain.
  await authorizeCapabilityRepository(sql,memberActor,repoA.id);
  await authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id)); // no rules => inherit
  await assert.rejects(authorizeCapabilityArtifact(sql,foreignActor,artifact(repoA.id)),denied);
  await assert.rejects(authorizeCapabilityArtifact(sql,{organizationId:firstOrg.id,subject:foreignActor.subject},artifact(repoA.id)),denied);
  await assert.rejects(authorizeCapabilityArtifact(sql,{organizationId:firstOrg.id,subject:"unknown"},artifact(repoA.id)),denied);

  await rule(repoA.id,"workflow_spec","triage","allow","user",owner.id);
  await authorizeCapabilityArtifact(sql,ownerActor,artifact(repoA.id));
  await assert.rejects(authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id)),denied);
  // Other artifact IDs and kinds are independent and inherit repository grants.
  await authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id,"workflow_spec","other"));
  await authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id,"skill","triage"));

  await rule(repoA.id,"workflow_spec","triage","allow","role","Member");
  await authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id));
  await rule(repoA.id,"workflow_spec","triage","deny","user",member.id);
  await assert.rejects(authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id)),denied);
  await authorizeCapabilityArtifact(sql,ownerActor,artifact(repoA.id));

  const [group]=await sql`insert into groups(organization_id,name) values(${firstOrg.id},${"artifact-team-"+slug}) returning id`;
  await sql`insert into group_memberships(group_id,user_id) values(${group.id},${member.id})`;
  await rule(repoA.id,"skill","review","allow","group",group.id);
  await authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id,"skill","review"));
  await assert.rejects(authorizeCapabilityArtifact(sql,ownerActor,artifact(repoA.id,"skill","review")),denied);
  await rule(repoA.id,"skill","review","deny","role","member");
  await assert.rejects(authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id,"skill","review")),denied);

  // Cross-tenant composite FK must fail, including when repo exists in another org.
  await assert.rejects(sql`
    insert into capability_artifact_permissions
      (organization_id,repository_id,artifact_kind,artifact_id,effect,granted_to_type,granted_to_ref)
    values(${foreignOrg.id},${repoA.id},'skill','foreign','allow','user',${foreign.id})
  `,e=>e?.code==="23503");
  await assert.rejects(rule(repoA.id,"skill","bad","elevate","user",owner.id),e=>e?.code==="23514");

  // Actual PG preauthorization denies a later artifact before ANY simulated provider IO.
  const sha="a".repeat(40),digest="b".repeat(64);
  const ref=(id,repositoryId)=>({
    schemaVersion:1,kind:"workflow_spec",organizationId:firstOrg.id,
    artifactId:id,version:"1.0.0",contentHash:"sha256:"+digest,
    locator:{source:"git",repositoryId,path:"workflows/"+id+".json",commitSha:sha},
  });
  let providerReads=0;
  const resolver=createCapabilityResolver({
    async authorize(actor,reference){
      if(reference.locator.source!=="git")throw Error("invalid locator");
      await authorizeCapabilityRepository(sql,actor,reference.locator.repositoryId);
      await authorizeCapabilityArtifact(sql,actor,artifact(reference.locator.repositoryId,reference.kind,reference.artifactId));
    },
    async workflow(_actor,reference){
      providerReads++;
      return {specification:{workflowId:reference.artifactId,version:reference.version},digest,commitSha:sha};
    },
    async skill(){throw Error("unused");},
  });
  const service=createCapabilityLinkService(resolver);
  const graph={links:[{relation:"depends_on",from:ref("free",repoB.id),to:ref("restricted",repoA.id)}]};
  await rule(repoA.id,"workflow_spec","restricted","allow","user",owner.id);
  await assert.rejects(service.resolve(memberActor,graph),denied);
  assert.equal(providerReads,0,"no provider content calls before complete ACL preflight");
  await rule(repoA.id,"workflow_spec","restricted","allow","user",member.id);
  const passed=await service.resolve(memberActor,graph);
  assert.equal(passed.nodeCount,2);
  assert.equal(providerReads,2);

  await sql`update users set status='disabled' where id=${member.id}`;
  await assert.rejects(authorizeCapabilityArtifact(sql,memberActor,artifact(repoA.id,"workflow_spec","restricted")),denied);
  await sql`update users set status='active' where id=${member.id}`;
  await sql`update repositories set status='disabled' where id=${repoA.id}`;
  await assert.rejects(authorizeCapabilityArtifact(sql,ownerActor,artifact(repoA.id)),denied);
  await sql`update repositories set status='connected' where id=${repoA.id}`;

  const measurements=[];
  for(let i=0;i<20;i++){
    const started=performance.now();
    await authorizeCapabilityArtifact(sql,memberActor,artifact(repoB.id,"workflow_spec","free"));
    measurements.push(performance.now()-started);
  }
  measurements.sort((a,b)=>a-b);
  const p95=measurements[Math.ceil(measurements.length*0.95)-1];
  assert.ok(p95<3000,"local artifact ACL query guard; not a production API SLO");

  await sql`delete from repositories where id=${repoA.id}`;
  const rows=await sql`select id from capability_artifact_permissions where repository_id=${repoA.id}`;
  assert.equal(rows.length,0,"artifact ACL must cascade with repository removal");

  console.log(JSON.stringify({scope:"artifact_acl",tenantIsolation:true,readDenyOverridesAllow:true,
    groupAndRole:true,crossTenantFk:true,workflowAndSkillSeparation:true,
    linkPreflightBeforeProvider:true,cascade:true,localPostgresP95Ms:Number(p95.toFixed(3)),samples:20}));
} finally {
  if(firstOrg)await sql`delete from organizations where id=${firstOrg.id}`;
  if(foreignOrg)await sql`delete from organizations where id=${foreignOrg.id}`;
  await sql.end({timeout:5});
}
