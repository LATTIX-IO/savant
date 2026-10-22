import type { ControlPlaneSql } from "../control-plane/database.ts";
import { CapabilityResolveError, type CapabilityResolveActor } from "./capability-resolver.ts";
import { authorizeCapabilityRepository } from "./capability-access.ts";
import { authorizeCapabilityArtifact } from "./capability-artifact-access.ts";

export type IndexedWorkflowSummary = {
  workflowId: string;
  version: string;
  sourceCommitSha: string;
  indexedAt: string;
};

/** Rebuildable Git-derived discovery hints; never proof the referenced Git file still exists. */
export async function listReadableIndexedWorkflows(
  sql: ControlPlaneSql,
  actor: CapabilityResolveActor,
  repositoryId: string,
): Promise<IndexedWorkflowSummary[]> {
  if(!actor.subject || !actor.organizationId || !repositoryId) throw new CapabilityResolveError("not_found",404);
  // Deny before consulting the existence of workflow IDs or their Git metadata.
  await authorizeCapabilityRepository(sql,actor,repositoryId);
  const rows=await sql<Array<{workflow_id:string;specification_version:string;
    source_commit_sha:string;indexed_at:Date|string}>>`
    select distinct on (workflow_id)
      workflow_id,specification_version,source_commit_sha,indexed_at
    from workflow_artifact_versions
    where organization_id=${actor.organizationId} and repository_id=${repositoryId}
    order by workflow_id,indexed_at desc,source_commit_sha desc
    limit 100
  `;
  const visible:IndexedWorkflowSummary[]=[];
  for(const row of rows){
    try {
      await authorizeCapabilityArtifact(sql,actor,{
        organizationId:actor.organizationId,repositoryId,
        kind:"workflow_spec",artifactId:row.workflow_id,
      });
    }catch(error){
      if(error instanceof CapabilityResolveError&&error.status===404)continue;
      throw error;
    }
    visible.push({
      workflowId:row.workflow_id,version:row.specification_version,
      sourceCommitSha:row.source_commit_sha,
      indexedAt:new Date(row.indexed_at).toISOString(),
    });
  }
  return visible;
}
