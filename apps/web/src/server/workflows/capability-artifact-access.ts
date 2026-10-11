import type { ControlPlaneSql } from "../control-plane/database.ts";
import { CapabilityResolveError, type CapabilityResolveActor } from "./capability-resolver.ts";

/**
 * Artifact rules are an ADDITIONAL restriction, not a replacement for
 * authorizeCapabilityRepository. This module never accesses Git or content.
 */
export function evaluateArtifactReadDecision(input: {
  ruleCount: number; allow: boolean; deny: boolean;
}): boolean {
  const {ruleCount,allow,deny}=input;
  if (!Number.isSafeInteger(ruleCount)||ruleCount<0||deny) return false;
  if (ruleCount===0) return !allow;
  return allow;
}
type DecisionRow={status:string;rule_count:number;has_allow:boolean;has_deny:boolean};
export async function authorizeCapabilityArtifact(
  sql:ControlPlaneSql,
  actor:CapabilityResolveActor,
  reference:{
    organizationId:string;
    kind:"skill"|"workflow_spec";
    artifactId:string;
    repositoryId:string;
  },
):Promise<void>{
  if (!actor.organizationId||!actor.subject)throw new CapabilityResolveError("auth_required",401);
  if(reference.organizationId!==actor.organizationId||!reference.repositoryId||!reference.artifactId)
    throw new CapabilityResolveError("not_found",404);
  const rows=await sql<DecisionRow[]>`
    select r.status,
      (select count(*)::int from capability_artifact_permissions p
        where p.organization_id=r.organization_id and p.repository_id=r.id
          and p.artifact_kind=${reference.kind} and p.artifact_id=${reference.artifactId}
          and p.permission_key='read') as rule_count,
      exists (select 1 from capability_artifact_permissions p
        where p.organization_id=r.organization_id and p.repository_id=r.id
          and p.artifact_kind=${reference.kind} and p.artifact_id=${reference.artifactId}
          and p.permission_key='read' and p.effect='allow'
          and (
            (p.granted_to_type='user' and (p.granted_to_ref=u.id::text or p.granted_to_ref=${actor.subject}))
            or (p.granted_to_type='role' and lower(p.granted_to_ref)='member')
            or (p.granted_to_type='group' and exists(
              select 1 from group_memberships gm join groups g on g.id=gm.group_id
              where gm.user_id=u.id and g.organization_id=r.organization_id
                and (p.granted_to_ref=g.id::text or p.granted_to_ref=g.name)
            ))
          )) as has_allow,
      exists (select 1 from capability_artifact_permissions p
        where p.organization_id=r.organization_id and p.repository_id=r.id
          and p.artifact_kind=${reference.kind} and p.artifact_id=${reference.artifactId}
          and p.permission_key='read' and p.effect='deny'
          and (
            (p.granted_to_type='user' and (p.granted_to_ref=u.id::text or p.granted_to_ref=${actor.subject}))
            or (p.granted_to_type='role' and lower(p.granted_to_ref)='member')
            or (p.granted_to_type='group' and exists(
              select 1 from group_memberships gm join groups g on g.id=gm.group_id
              where gm.user_id=u.id and g.organization_id=r.organization_id
                and (p.granted_to_ref=g.id::text or p.granted_to_ref=g.name)
            ))
          )) as has_deny
    from repositories r
    join users u on u.organization_id=r.organization_id
      and u.external_subject=${actor.subject} and u.status='active'
    where r.organization_id=${actor.organizationId} and r.id=${reference.repositoryId}
    limit 1
  `;
  const row=rows[0];
  if(!row||row.status==='disabled'||!evaluateArtifactReadDecision({
    ruleCount:row.rule_count,allow:row.has_allow,deny:row.has_deny,
  }))throw new CapabilityResolveError("not_found",404);
}
