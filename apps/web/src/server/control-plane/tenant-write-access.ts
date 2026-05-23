import type { ResolvedTenantContext } from "./tenant-context.ts";

type TenantWriteAccessRow = {
  userId: string;
  isFirstMember: boolean;
  groups: string[] | null;
};

export type TenantWriteAccessDecision = {
  userId: string | null;
  role: "Owner" | "Admin" | "Development";
  reason: "first_member" | "platform_admin" | "development_fallback";
};

export interface TenantWriteAccessStore {
  resolveAccess(
    input: {
      organizationId: string;
      subject: string;
    },
  ): Promise<TenantWriteAccessRow | null>;
}

export class TenantWriteAccessError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "TenantWriteAccessError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function createDatabaseTenantWriteAccessStore(): Promise<TenantWriteAccessStore> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new TenantWriteAccessError(
      "tenant_write_access_unconfigured",
      "DATABASE_URL must be configured before repository write access can be evaluated.",
      503,
    );
  }

  const sql = getControlPlaneDatabase();

  return {
    resolveAccess: async (input) => {
      const rows = await sql<TenantWriteAccessRow[]>`
        with ordered_users as (
          select
            users.id,
            users.external_subject,
            users.status,
            row_number() over (order by users.created_at asc, users.email asc) = 1 as is_first_member
          from users
          where users.organization_id = ${input.organizationId}
        )
        select
          ordered_users.id as "userId",
          ordered_users.is_first_member as "isFirstMember",
          coalesce(
            array_agg(distinct groups.name) filter (where groups.name is not null),
            array[]::text[]
          ) as groups
        from ordered_users
        left join group_memberships on group_memberships.user_id = ordered_users.id
        left join groups on groups.id = group_memberships.group_id
        where ordered_users.external_subject = ${input.subject}
          and ordered_users.status = 'active'
        group by ordered_users.id, ordered_users.is_first_member
        limit 1
      `;

      return rows[0] ?? null;
    },
  };
}

function hasPlatformAdminGroup(groups: readonly string[]): boolean {
  return groups.some((group) => group.trim().toLowerCase() === "platform-admins");
}

export async function assertTenantWriteAccess(
  input: {
    context: ResolvedTenantContext;
    operation: string;
  },
  options?: {
    store?: TenantWriteAccessStore | undefined;
  },
): Promise<TenantWriteAccessDecision> {
  if (!input.context.identity) {
    throw new TenantWriteAccessError(
      "auth_required",
      "Sign in before performing repository write operations.",
      401,
    );
  }

  if (input.context.isDevelopmentFallback) {
    return {
      userId: null,
      role: "Development",
      reason: "development_fallback",
    };
  }

  const store = options?.store ?? await createDatabaseTenantWriteAccessStore();
  const actor = await store.resolveAccess({
    organizationId: input.context.tenant.organizationId,
    subject: input.context.identity.subject,
  });

  if (!actor) {
    throw new TenantWriteAccessError(
      "tenant_write_access_denied",
      `Only workspace Owners and platform-admins can ${input.operation} in the current secure MVP.`,
      403,
    );
  }

  if (actor.isFirstMember) {
    return {
      userId: actor.userId,
      role: "Owner",
      reason: "first_member",
    };
  }

  const groups = actor.groups ?? [];

  if (hasPlatformAdminGroup(groups)) {
    return {
      userId: actor.userId,
      role: "Admin",
      reason: "platform_admin",
    };
  }

  throw new TenantWriteAccessError(
    "tenant_write_access_denied",
    `Only workspace Owners and platform-admins can ${input.operation} in the current secure MVP.`,
    403,
  );
}