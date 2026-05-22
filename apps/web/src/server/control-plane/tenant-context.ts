import "server-only";

import { auth0 } from "@/lib/auth0";
import {
  buildAuthenticatedIdentity,
  type AuthenticatedIdentity,
  type AuthSessionUser,
} from "@/lib/auth0-session";
import { normalizeWorkspaceSlug } from "@/lib/onboarding";
import { ORG } from "@/lib/savant-data";
import { buildTenantAppPath } from "@/lib/tenant-paths";

import {
  getControlPlaneDatabase,
  isControlPlaneDatabaseConfigured,
} from "./database";

export class TenantContextError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "TenantContextError";
    this.code = code;
    this.status = status;
  }
}

export type TenantMembership = {
  organizationId: string;
  workspaceName: string;
  workspaceSlug: string;
  isDefault: boolean;
  isLastUsed: boolean;
};

export type ResolvedTenantContext = {
  identity: AuthenticatedIdentity | null;
  tenant: TenantMembership;
  memberships: TenantMembership[];
  isDevelopmentFallback: boolean;
};

type TenantMembershipRow = {
  organization_id: string;
  workspace_name: string;
  workspace_slug: string;
  is_default: boolean;
  is_last_used: boolean;
  user_created_at: Date | string;
};

const DEVELOPMENT_DEFAULT_WORKSPACE_SLUG = normalizeWorkspaceSlug(ORG.name) ?? "workspace";

function normalizeTenantSlugOrThrow(workspaceSlug: string): string {
  const normalized = normalizeWorkspaceSlug(workspaceSlug);

  if (!normalized) {
    throw new TenantContextError(
      "workspace_slug_invalid",
      "A valid workspace slug is required to resolve tenant context.",
      400,
    );
  }

  return normalized;
}

function titleCaseToken(token: string): string {
  return `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`;
}

function buildDevelopmentWorkspaceName(workspaceSlug: string): string {
  const tokens = workspaceSlug.split("-").filter(Boolean);
  if (tokens.length === 0) {
    return "Workspace";
  }

  return tokens.map(titleCaseToken).join(" ");
}

function buildDevelopmentTenantMembership(workspaceSlug: string): TenantMembership {
  return {
    organizationId: `development-${workspaceSlug}`,
    workspaceName: buildDevelopmentWorkspaceName(workspaceSlug),
    workspaceSlug,
    isDefault: true,
    isLastUsed: true,
  };
}

function mapMembershipRow(row: TenantMembershipRow): TenantMembership {
  return {
    organizationId: row.organization_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    isDefault: Boolean(row.is_default),
    isLastUsed: Boolean(row.is_last_used),
  };
}

function sortMemberships(memberships: TenantMembership[]): TenantMembership[] {
  return [...memberships].sort((left, right) => {
    const leftRank = left.isDefault ? 0 : left.isLastUsed ? 1 : 2;
    const rightRank = right.isDefault ? 0 : right.isLastUsed ? 1 : 2;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.workspaceName.localeCompare(right.workspaceName);
  });
}

export function choosePreferredTenantMembership(
  memberships: TenantMembership[],
): TenantMembership | null {
  return sortMemberships(memberships)[0] ?? null;
}

export async function listTenantMembershipsForSubject(
  auth0Subject: string,
): Promise<TenantMembership[]> {
  if (!isControlPlaneDatabaseConfigured) {
    return [];
  }

  const sql = getControlPlaneDatabase();
  const rows = await sql<TenantMembershipRow[]>`
    select
      organizations.id as organization_id,
      organizations.display_name as workspace_name,
      organizations.slug as workspace_slug,
      coalesce(user_preferences.default_organization_id = organizations.id, false) as is_default,
      coalesce(user_preferences.last_organization_id = organizations.id, false) as is_last_used,
      users.created_at as user_created_at
    from organizations
    inner join users on users.organization_id = organizations.id
    left join user_preferences on user_preferences.auth0_subject = ${auth0Subject}
    where users.external_subject = ${auth0Subject}
      and users.status = 'active'
    order by users.created_at asc
  `;

  const uniqueMemberships = new Map<string, TenantMembership>();
  for (const row of rows) {
    if (!uniqueMemberships.has(row.organization_id)) {
      uniqueMemberships.set(row.organization_id, mapMembershipRow(row));
    }
  }

  return sortMemberships([...uniqueMemberships.values()]);
}

export async function upsertUserTenantPreference(
  auth0Subject: string,
  organizationId: string,
  options?: { setDefault?: boolean },
): Promise<void> {
  if (!isControlPlaneDatabaseConfigured) {
    return;
  }

  const sql = getControlPlaneDatabase();
  const setDefault = options?.setDefault ?? false;

  await sql`
    insert into user_preferences (
      auth0_subject,
      default_organization_id,
      last_organization_id
    )
    values (
      ${auth0Subject},
      ${setDefault ? organizationId : null},
      ${organizationId}
    )
    on conflict (auth0_subject) do update
    set
      default_organization_id = case
        when ${setDefault} then excluded.default_organization_id
        else coalesce(user_preferences.default_organization_id, excluded.last_organization_id)
      end,
      last_organization_id = excluded.last_organization_id,
      updated_at = now()
  `;
}

export async function resolvePreferredTenantAppPath(
  user: AuthSessionUser | null | undefined,
  appPath: string,
): Promise<string | null> {
  if (!isControlPlaneDatabaseConfigured) {
    return process.env.NODE_ENV === "production"
      ? null
      : buildTenantAppPath(DEVELOPMENT_DEFAULT_WORKSPACE_SLUG, appPath);
  }

  const identity = buildAuthenticatedIdentity(user);
  if (!identity) {
    return null;
  }

  const preferredMembership = choosePreferredTenantMembership(
    await listTenantMembershipsForSubject(identity.subject),
  );

  if (!preferredMembership) {
    return "/onboarding";
  }

  return buildTenantAppPath(preferredMembership.workspaceSlug, appPath);
}

export async function resolveTenantMembershipForUser(
  user: AuthSessionUser | null | undefined,
  workspaceSlug: string,
): Promise<ResolvedTenantContext> {
  const normalizedWorkspaceSlug = normalizeTenantSlugOrThrow(workspaceSlug);

  if (!isControlPlaneDatabaseConfigured) {
    if (process.env.NODE_ENV === "production") {
      throw new TenantContextError(
        "tenant_persistence_unconfigured",
        "DATABASE_URL must be configured before tenant routes can serve production traffic.",
        503,
      );
    }

    const developmentTenant = buildDevelopmentTenantMembership(normalizedWorkspaceSlug);
    return {
      identity: buildAuthenticatedIdentity(user),
      tenant: developmentTenant,
      memberships: [developmentTenant],
      isDevelopmentFallback: true,
    };
  }

  const identity = buildAuthenticatedIdentity(user);
  if (!identity) {
    throw new TenantContextError(
      "auth_required",
      "Sign in before accessing a tenant-scoped workspace route.",
      401,
    );
  }

  const memberships = await listTenantMembershipsForSubject(identity.subject);
  const tenant = memberships.find((membership) => membership.workspaceSlug === normalizedWorkspaceSlug);

  if (!tenant) {
    throw new TenantContextError(
      "tenant_access_denied",
      "That workspace was not found for the current authenticated user.",
      404,
    );
  }

  return {
    identity,
    tenant,
    memberships,
    isDevelopmentFallback: false,
  };
}

export async function authorizeTenantRequest(request: Request): Promise<ResolvedTenantContext> {
  const requestUrl = new URL(request.url);
  const workspaceSlug = requestUrl.searchParams.get("workspaceSlug");

  if (!workspaceSlug) {
    throw new TenantContextError(
      "workspace_slug_required",
      "workspaceSlug is required for tenant-scoped control-plane requests.",
      400,
    );
  }

  const session = auth0 ? await auth0.getSession() : null;
  return resolveTenantMembershipForUser(session?.user, workspaceSlug);
}
