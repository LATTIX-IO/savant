import type { ControlPlaneSql } from "../control-plane/database.ts";
import { PolicyAdminError, policyMutationDigest, type PolicyScope, type PolicyMutation } from "./capability-policy-contract.ts";

export type PolicyActor={organizationId:string;subject:string};
export type PolicyRule={
  id:string;effect:"allow"|"deny";principalType:"user"|"group"|"role";principalRef:string;
};
type RevisionRow={revision:string|number};
type RuleRow={id:string;effect:"allow"|"deny";granted_to_type:PolicyRule["principalType"];granted_to_ref:string};
type ReplayRow={payload_digest:string;resulting_revision:string|number;changed:boolean};
type ActorRow={id:string;status:string;admin:boolean};
function failure(code:string,status:number):never{throw new PolicyAdminError(code,status);}
function revisionNumber(input:number|string):number{
  const result=Number(input);
  if(!Number.isSafeInteger(result)||result<0)failure("policy_storage_unavailable",503);
  return result;
}
/** All authorizations and writes run in the SAME transaction as revision/audit changes. */
export function createCapabilityPolicyAdmin(sql:ControlPlaneSql){
  async function authorizeAdmin(tx:ControlPlaneSql,actor:PolicyActor,scope:PolicyScope):Promise<void>{
    if(!actor.subject||!actor.organizationId)failure("auth_required",401);
    const rows=await tx<ActorRow[]>`
      with ordered_users as (
        select id,external_subject,status,
          row_number() over (order by created_at asc,email asc)=1 as first_member
        from users where organization_id=${actor.organizationId}
      )
      select u.id,r.status,
        (u.first_member or exists(
          select 1 from group_memberships gm
          join groups g on g.id=gm.group_id
          where gm.user_id=u.id and g.organization_id=${actor.organizationId}
          and lower(g.name)='platform-admins'
        )) as admin
      from ordered_users u
      join repositories r on r.organization_id=${actor.organizationId}
        and r.id=${scope.repositoryId}
      where u.external_subject=${actor.subject} and u.status='active'
      limit 1
    `;
    const row=rows[0];
    if(!row||row.status==="disabled")failure("not_found",404);
    if(!row.admin)failure("forbidden",403);
  }
  async function validatePrincipal(tx:ControlPlaneSql,actor:PolicyActor,input:PolicyMutation):Promise<void>{
    if(input.principalType==="role")return;
    if(input.principalType==="user"){
      const rows=await tx<{id:string}[]>`
        select id from users where organization_id=${actor.organizationId}
        and id=${input.principalRef} and status='active' for share
      `;
      if(!rows[0])failure("principal_not_found",422);
    }else{
      const rows=await tx<{id:string}[]>`
        select id from groups where organization_id=${actor.organizationId}
        and id=${input.principalRef} for share
      `;
      if(!rows[0])failure("principal_not_found",422);
    }
  }
  return {
    async list(actor:PolicyActor,scope:PolicyScope):Promise<{revision:number;rules:PolicyRule[]}>{
      return sql.begin(async tx=>{
        await authorizeAdmin(tx as ControlPlaneSql,actor,scope);
        const versions=await tx<RevisionRow[]>`
          select revision from capability_artifact_policy_revisions
          where organization_id=${actor.organizationId}
          and repository_id=${scope.repositoryId} and artifact_kind=${scope.kind}
          and artifact_id=${scope.artifactId} for share
        `;
        const rows=await tx<RuleRow[]>`
          select id,effect,granted_to_type,granted_to_ref
          from capability_artifact_permissions
          where organization_id=${actor.organizationId} and repository_id=${scope.repositoryId}
          and artifact_kind=${scope.kind} and artifact_id=${scope.artifactId}
          and permission_key='read'
          order by effect,granted_to_type,granted_to_ref
          limit 250
        `;
        if(rows.length===250)failure("policy_rule_limit",409);
        return {
          revision:versions[0]?revisionNumber(versions[0].revision):0,
          rules:rows.map(r=>({id:r.id,effect:r.effect,principalType:r.granted_to_type,principalRef:r.granted_to_ref})),
        };
      });
    },
    async mutate(actor:PolicyActor,input:PolicyMutation,expectedRevision:number):Promise<{
      revision:number;changed:boolean;replayed:boolean;
    }>{
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
        failure("policy_precondition_required",428);
      const hash=policyMutationDigest(input);
      return sql.begin(async tx=>{
        await authorizeAdmin(tx as ControlPlaneSql,actor,input);
        await tx`
          insert into capability_artifact_policy_revisions
            (organization_id,repository_id,artifact_kind,artifact_id)
          values (${actor.organizationId},${input.repositoryId},${input.kind},${input.artifactId})
          on conflict do nothing
        `;
        const versions=await tx<RevisionRow[]>`
          select revision from capability_artifact_policy_revisions
          where organization_id=${actor.organizationId} and repository_id=${input.repositoryId}
          and artifact_kind=${input.kind} and artifact_id=${input.artifactId} for update
        `;
        const current=versions[0]?revisionNumber(versions[0].revision):0;
        const replay=await tx<ReplayRow[]>`
          select payload_digest,resulting_revision,changed
          from capability_artifact_policy_requests
          where organization_id=${actor.organizationId} and repository_id=${input.repositoryId}
          and artifact_kind=${input.kind} and artifact_id=${input.artifactId}
          and request_id=${input.requestId} limit 1
        `;
        if(replay[0]){
          if(replay[0].payload_digest!==hash)failure("policy_idempotency_conflict",409);
          return {revision:revisionNumber(replay[0].resulting_revision),changed:replay[0].changed,replayed:true};
        }
        if(current!==expectedRevision)failure("policy_revision_conflict",409);
        await validatePrincipal(tx as ControlPlaneSql,actor,input);
        let changed:boolean;
        if(input.operation==="grant"){
          const rows=await tx<{id:string}[]>`
            insert into capability_artifact_permissions
              (organization_id,repository_id,artifact_kind,artifact_id,
               permission_key,effect,granted_to_type,granted_to_ref)
            values (${actor.organizationId},${input.repositoryId},${input.kind},${input.artifactId},
              'read',${input.effect},${input.principalType},${input.principalRef})
            on conflict do nothing returning id
          `;
          changed=rows.length>0;
        }else{
          const rows=await tx<{id:string}[]>`
            delete from capability_artifact_permissions
            where organization_id=${actor.organizationId} and repository_id=${input.repositoryId}
            and artifact_kind=${input.kind} and artifact_id=${input.artifactId}
            and permission_key='read' and effect=${input.effect}
            and granted_to_type=${input.principalType} and granted_to_ref=${input.principalRef}
            returning id
          `;
          changed=rows.length>0;
        }
        const next=current+(changed?1:0);
        if(changed)await tx`
          update capability_artifact_policy_revisions set revision=${next},updated_at=now()
          where organization_id=${actor.organizationId} and repository_id=${input.repositoryId}
            and artifact_kind=${input.kind} and artifact_id=${input.artifactId}
        `;
        await tx`
          insert into capability_artifact_policy_requests
            (organization_id,repository_id,artifact_kind,artifact_id,request_id,
             payload_digest,resulting_revision,changed)
          values (${actor.organizationId},${input.repositoryId},${input.kind},${input.artifactId},
            ${input.requestId},${hash},${next},${changed})
        `;
        // Audit is committed atomically with the rule and revision; failure rolls back ALL changes.
        const safeAudit=JSON.stringify({
          operation:input.operation,kind:input.kind,effect:input.effect,
          principalType:input.principalType,revision:next,changed,
          requestDigest:hash.slice(0,16),
        });
        await tx`
          insert into audit_events
            (organization_id,actor_type,actor_ref,category,action,target_type,target_ref,request_id,payload_redacted)
          values (${actor.organizationId},'user',${actor.subject},'repo',
            'artifact_policy_mutated','capability',${input.kind+":"+input.artifactId},
            ${input.requestId},${safeAudit}::jsonb)
        `;
        return {revision:next,changed,replayed:false};
      });
    },
  };
}
