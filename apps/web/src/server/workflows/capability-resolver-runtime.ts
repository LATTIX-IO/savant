import "server-only";

import type { CapabilityReferenceV1 } from "@savant/types/capability-reference";
import { getControlPlaneDatabase } from "../control-plane/database.ts";
import { getGitRuntime } from "../git/runtime.ts";
import { resolveRepositoryConnection } from "../git/connection-resolver.ts";
import type { ConnectedRepositoryRecord } from "../git/types.ts";
import { workflowArtifacts } from "./runtime.ts";
import { CapabilityResolveError, createCapabilityResolver, type CapabilityResolveActor } from "./capability-resolver.ts";

type RepoAuthRow={
  status:string; actor_id:string | null; permission_count:number; allowed:boolean;
};
const MAX_SKILL_BYTES=512_000;
async function authorizeRepository(actor:CapabilityResolveActor,reference:CapabilityReferenceV1):Promise<void>{
  if(reference.locator.source!=="git")throw new CapabilityResolveError("unsupported_kind",409);
  const sql=getControlPlaneDatabase();
  const rows=await sql<RepoAuthRow[]>`
    select r.status, u.id as actor_id,
      (select count(*)::int from repository_permissions p where p.repository_id=r.id) as permission_count,
      exists (
        select 1 from repository_permissions p
        where p.repository_id=r.id
          and p.permission_key in ('read', 'source:read', 'repository:read')
          and (
            (p.granted_to_type='user' and (p.granted_to_ref=u.id::text or p.granted_to_ref=${actor.subject}))
            or (p.granted_to_type='role' and lower(p.granted_to_ref)='member')
            or (p.granted_to_type='group' and exists (
              select 1 from group_memberships gm join groups g on g.id=gm.group_id
              where gm.user_id=u.id and (p.granted_to_ref=g.id::text or p.granted_to_ref=g.name)
            ))
          )
      ) as allowed
    from repositories r
    inner join users u on u.organization_id=r.organization_id
      and u.external_subject=${actor.subject} and u.status='active'
    where r.id=${reference.locator.repositoryId} and r.organization_id=${actor.organizationId}
    limit 1
  `;
  const row=rows[0];
  if(!row||row.status==="disabled"||(row.permission_count>0&&!row.allowed))
    throw new CapabilityResolveError("not_found",404);
}
async function authorizeIndexedSkill(actor:CapabilityResolveActor,reference:CapabilityReferenceV1):Promise<void>{
  if(reference.locator.source!=="git")throw new CapabilityResolveError("not_found",404);
  const sql=getControlPlaneDatabase();
  const rows=await sql<{source_path:string;metadata_version:string|null;source_commit_sha:string}[]>`
    select i.source_path,i.metadata_version,i.source_commit_sha
    from indexed_skills i
    inner join repositories r on r.id=i.repository_id and r.organization_id=i.organization_id
    where i.organization_id=${actor.organizationId} and i.repository_id=${reference.locator.repositoryId}
      and i.skill_id=${reference.artifactId} and i.source_commit_sha=${reference.locator.commitSha}
      and r.status<>'disabled'
    order by i.last_indexed_at desc limit 1
  `;
  const row=rows[0];
  if(!row)throw new CapabilityResolveError("not_found",404);
  const path=/\.md$/i.test(row.source_path)?row.source_path:row.source_path.replace(/\/+$/,"")+"/SKILL.md";
  if(path!==reference.locator.path)throw new CapabilityResolveError("not_found",404);
  if(!row.metadata_version)throw new CapabilityResolveError("provenance_incomplete",409);
  if(row.metadata_version!==reference.version)throw new CapabilityResolveError("integrity_mismatch",409);
}
/** Reverify immutable provider identity before each pinned read. */
async function pinnedSkillContent(actor:CapabilityResolveActor,reference:CapabilityReferenceV1){
  if(reference.locator.source!=="git")throw new CapabilityResolveError("not_found",404);
  await authorizeIndexedSkill(actor,reference);
  const git=await getGitRuntime();
  const repo:ConnectedRepositoryRecord|null=await git.stores.repositories.getRepository(actor.organizationId,reference.locator.repositoryId);
  if(!repo||repo.organizationId!==actor.organizationId||!repo.providerRepositoryId)
    throw new CapabilityResolveError("not_found",404);
  const conn=await resolveRepositoryConnection(git.stores,{organizationId:actor.organizationId,repository:repo});
  const resolved=await git.broker.resolve({organizationId:actor.organizationId,connectionId:conn.connection.id,access:"read"});
  const locator={
    provider:repo.provider,host:repo.host??(repo.provider==="github"?"github.com":""),
    owner:repo.owner,name:repo.name,fullName:repo.fullName,providerRepositoryId:repo.providerRepositoryId,
    ...(repo.project?{project:repo.project}:{}),
  };
  const access=await resolved.provider.validateRepositoryAccess(resolved.credential,locator);
  if(!access.accessible||access.repository?.providerRepositoryId!==repo.providerRepositoryId)
    throw new CapabilityResolveError("not_found",404);
  const bytes=await resolved.provider.readFile(
    resolved.credential,locator,reference.locator.commitSha,reference.locator.path,{maxBytes:MAX_SKILL_BYTES},
  );
  if(bytes.byteLength>MAX_SKILL_BYTES)throw new CapabilityResolveError("content_oversized",413);
  let content:string;
  try{content=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch{throw new CapabilityResolveError("integrity_mismatch",409);}
  return {content,commitSha:reference.locator.commitSha};
}

export const capabilityResolver=createCapabilityResolver({
  async authorize(actor,reference){
    await authorizeRepository(actor,reference);
    if(reference.kind==="skill")await authorizeIndexedSkill(actor,reference);
  },
  async workflow(actor,reference){
    if(reference.locator.source!=="git")throw new CapabilityResolveError("not_found",404);
    const result=await workflowArtifacts.get(actor,reference.locator.repositoryId,reference.artifactId,reference.locator.commitSha);
    return {specification:result.specification,digest:result.digest,commitSha:result.commitSha};
  },
  skill:pinnedSkillContent,
});
