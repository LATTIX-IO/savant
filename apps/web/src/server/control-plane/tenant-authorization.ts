import type { TransactionSql } from "postgres";

import type { ControlPlaneSql } from "./database.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";

export class TenantAuthorizationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "TenantAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

type TenantActorRow = {
  id: string;
  email: string;
  is_first_member: boolean;
  groups: string[] | null;
};

export type AuthorizedTenantAdminActor = {
  userId: string;
  email: string;
  role: "Owner" | "Admin";
  groups: string[];
};

type TenantSqlExecutor = ControlPlaneSql | TransactionSql;

function hasPlatformAdminGroup(groups: readonly string[]): boolean {
  return groups.some((group) => group.toLowerCase() === "platform-admins");
}

async function requireTenantAdminActorRow(
  sql: TenantSqlExecutor,
  context: ResolvedTenantContext,
): Promise<TenantActorRow> {
  if (!context.identity) {
    throw new TenantAuthorizationError(
      "auth_required",
      "Sign in before performing this tenant-scoped action.",
      401,
    );
  }

  const rows = await sql<TenantActorRow[]>`
    with ordered_users as (
      select
        users.id,
        users.email,
        row_number() over (order by users.created_at asc, users.email asc) = 1 as is_first_member
      from users
      where users.organization_id = ${context.tenant.organizationId}
        and users.external_subject = ${context.identity.subject}
        and users.status = 'active'
    )
    select
      ordered_users.id,
      ordered_users.email,
      ordered_users.is_first_member,
      coalesce(
        array_agg(distinct groups.name) filter (where groups.name is not null),
        array[]::text[]
      ) as groups
    from ordered_users
    left join group_memberships on group_memberships.user_id = ordered_users.id
    left join groups on groups.id = group_memberships.group_id
    group by ordered_users.id, ordered_users.email, ordered_users.is_first_member
    limit 1
  `;

  const actor = rows[0];
  if (!actor) {
    throw new TenantAuthorizationError(
      "tenant_actor_not_found",
      "The current authenticated user could not be resolved inside the selected workspace.",
      403,
    );
  }

  return actor;
}

export async function requireTenantAdminActor(
  sql: TenantSqlExecutor,
  context: ResolvedTenantContext,
): Promise<AuthorizedTenantAdminActor> {
  const actor = await requireTenantAdminActorRow(sql, context);
  const groups = [...(actor.groups ?? [])];
  const isOwner = actor.is_first_member;
  const isAdmin = isOwner || hasPlatformAdminGroup(groups);

  if (!isAdmin) {
    throw new TenantAuthorizationError(
      "tenant_admin_required",
      "Only workspace owners or platform-admin members can manage AI connections.",
      403,
    );
  }

  return {
    userId: actor.id,
    email: actor.email,
    role: isOwner ? "Owner" : "Admin",
    groups,
  };
}
