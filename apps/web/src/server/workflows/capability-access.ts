import type { ControlPlaneSql } from "../control-plane/database.ts";
import { CapabilityResolveError, type CapabilityResolveActor } from "./capability-resolver.ts";

type Row={status:string;permission_count:number;allowed:boolean};

/** Membership and explicit repository ACLs evaluated inside a tenant-scoped SQL query. */
export async function authorizeCapabilityRepository(
  sql:ControlPlaneSql,actor:CapabilityResolveActor,repositoryId:string,
):Promise<void>{
  if(!actor.subject||!actor.organizationId)throw new CapabilityResolveError("auth_required",401);
  const rows=await sql<Row[]>`
    select r.status,
      (select count(*)::int from repository_permissions p where p.repository_id=r.id) as permission_count,
      exists(
        select 1 from repository_permissions p
        where p.repository_id=r.id
          and p.permission_key in ('read','source:read','repository:read')
          and (
            (p.granted_to_type='user' and (p.granted_to_ref=u.id::text or p.granted_to_ref=${actor.subject}))
            or (p.granted_to_type='role' and lower(p.granted_to_ref)='member')
            or (p.granted_to_type='group' and exists(
              select 1 from group_memberships gm join groups g on g.id=gm.group_id
              where gm.user_id=u.id and g.organization_id=r.organization_id
                and (p.granted_to_ref=g.id::text or p.granted_to_ref=g.name)
            ))
          )
      ) as allowed
    from repositories r
    join users u on u.organization_id=r.organization_id
      and u.external_subject=${actor.subject} and u.status='active'
    where r.id=${repositoryId} and r.organization_id=${actor.organizationId}
    limit 1
  `;
  const row=rows[0];
  if(!row||row.status==="disabled"||(row.permission_count>0&&!row.allowed))
    throw new CapabilityResolveError("not_found",404);
}
