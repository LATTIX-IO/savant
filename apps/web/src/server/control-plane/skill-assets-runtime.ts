import "server-only";
import type { ResolvedTenantContext } from "./tenant-context.ts";
import { lookupIndexedSkillAssetSource } from "./skill-source.ts";
import { getControlPlaneDatabase } from "./database.ts";
import { getGitRuntime } from "../git/runtime.ts";
import { resolveRepositoryConnection } from "../git/connection-resolver.ts";
import { toLocator } from "../git/repository-sync-service.ts";
import { authorizeCapabilityRepository } from "../workflows/capability-access.ts";
import { authorizeCapabilityArtifact } from "../workflows/capability-artifact-access.ts";
import type { CapabilityResolveActor } from "../workflows/capability-resolver.ts";
import { SkillAssetError, readVerifiedSkillAssetSnapshot, type IndexedAssetLocation } from "./skill-assets.ts";
import type { SkillAssetResponseData } from "../../lib/ui-v2-skill-assets.ts";

/** Production adapter. The indexed skill is resolved using the same tenant
 * identifier semantics as the existing Workbench; explicit ACLs are checked
 * before any Git broker credential or provider API is invoked. */
export async function getSkillAssetResponse(
  id:string,context:ResolvedTenantContext,requestedPath:string|null,
):Promise<SkillAssetResponseData>{
  if(context.isDevelopmentFallback || !context.identity?.subject)
    throw new SkillAssetError("auth_required",401);
  const indexed=await lookupIndexedSkillAssetSource(id,context);
  if(!indexed)throw new SkillAssetError("indexed_skill_not_found",404);
  if(indexed.providerType!=="github")
    throw new SkillAssetError("asset_provider_not_supported",409);
  const actor:CapabilityResolveActor={
    organizationId:context.tenant.organizationId,subject:context.identity.subject,
  };
  const index:IndexedAssetLocation={
    organizationId:actor.organizationId,skillId:indexed.skillId,
    repositoryId:indexed.repositoryId,sourcePath:indexed.sourcePath,
    commitSha:indexed.sourceCommitSha??"",
  };
  const sql=getControlPlaneDatabase();
  return readVerifiedSkillAssetSnapshot(index,requestedPath,{
    authorizeRepository:()=>authorizeCapabilityRepository(sql,actor,index.repositoryId),
    authorizeArtifact:()=>authorizeCapabilityArtifact(sql,actor,{
      organizationId:actor.organizationId,repositoryId:index.repositoryId,
      kind:"skill",artifactId:index.skillId,
    }),
    async openProvider(){
      const runtime=await getGitRuntime();
      const repo=await runtime.stores.repositories.getRepository(actor.organizationId,index.repositoryId);
      if(!repo||repo.organizationId!==actor.organizationId||repo.provider!=="github"||!repo.providerRepositoryId)
        throw new SkillAssetError("indexed_repository_not_found",404);
      const connection=await resolveRepositoryConnection(runtime.stores,{
        organizationId:actor.organizationId,repository:repo,
      });
      if(connection.connection.authType==="legacy_env")
        throw new SkillAssetError("managed_repository_connection_required",409);
      const resolved=await runtime.broker.resolve({
        organizationId:actor.organizationId,connectionId:connection.connection.id,access:"read",
      });
      const locator=toLocator(repo);
      const access=await resolved.provider.validateRepositoryAccess(resolved.credential,locator);
      if(!access.accessible||access.repository?.providerRepositoryId!==repo.providerRepositoryId)
        throw new SkillAssetError("repository_identity_mismatch",404);
      return {
        listTree:(sha:string)=>resolved.provider.listTree(
          resolved.credential,locator,sha,{maxEntries:MAX_TREE_ENTRIES,maxDepth:16},
        ),
        readFile:(sha:string,path:string,maxBytes:number)=>resolved.provider.readFile(
          resolved.credential,locator,sha,path,{maxBytes},
        ),
      };
    },
  });
}
