import "server-only";

import type { CapabilityReferenceV1 } from "@savant/types/capability-reference";
import { getControlPlaneDatabase } from "../control-plane/database.ts";
import { getGitRuntime } from "../git/runtime.ts";
import { resolveRepositoryConnection } from "../git/connection-resolver.ts";
import type { ConnectedRepositoryRecord } from "../git/types.ts";
import { workflowArtifacts } from "./runtime.ts";
import { WorkflowArtifactError } from "./workflow-artifacts.ts";
import { GitProviderError } from "../git/errors.ts";
import { CapabilityResolveError, createCapabilityResolver, type CapabilityResolveActor } from "./capability-resolver.ts";
import { authorizeCapabilityRepository } from "./capability-access.ts";

const MAX_SKILL_BYTES=512_000;
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
  let bytes:Buffer;
  try{
    bytes=await resolved.provider.readFile(
      resolved.credential,locator,reference.locator.commitSha,reference.locator.path,{maxBytes:MAX_SKILL_BYTES},
    );
  }catch(error){
    if(error instanceof GitProviderError&&error.status===404)throw new CapabilityResolveError("not_found",404);
    throw error;
  }
  if(bytes.byteLength>MAX_SKILL_BYTES)throw new CapabilityResolveError("content_oversized",413);
  let content:string;
  try{content=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch{throw new CapabilityResolveError("integrity_mismatch",409);}
  return {content,commitSha:reference.locator.commitSha};
}

export const capabilityResolver=createCapabilityResolver({
  async authorize(actor,reference){
    if(reference.locator.source!=="git")throw new CapabilityResolveError("unsupported_kind",409);
    await authorizeCapabilityRepository(getControlPlaneDatabase(),actor,reference.locator.repositoryId);
    if(reference.kind==="skill")await authorizeIndexedSkill(actor,reference);
  },
  async workflow(actor,reference){
    if(reference.locator.source!=="git")throw new CapabilityResolveError("not_found",404);
    try{
      const result=await workflowArtifacts.get({organizationId:actor.organizationId,actor:actor.subject},reference.locator.repositoryId,reference.artifactId,reference.locator.commitSha);
      return {specification:result.specification,digest:result.digest,commitSha:result.commitSha};
    }catch(error){
      if(error instanceof WorkflowArtifactError){
        if(error.status===404)throw new CapabilityResolveError("not_found",404);
        if(error.code==="workflow_integrity_failed")throw new CapabilityResolveError("integrity_mismatch",409);
      }
      throw error;
    }
  },
  skill:pinnedSkillContent,
});
