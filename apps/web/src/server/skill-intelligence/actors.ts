import "server-only";

import { resolveReviewerRole, type ReviewActor } from "../../lib/skill-intelligence/recommendation-workflow.ts";
import { getControlPlaneDatabase } from "../control-plane/database.ts";
import type { ResolvedTenantContext } from "../control-plane/tenant-context.ts";

import { SkillIntelligenceError } from "./service.ts";

export type IntelligenceActor = {
  subject: string;
  userId: string | null;
  displayName: string;
  email: string;
  isAdmin: boolean;
  groups: string[];
  isFirstMember: boolean;
};

type ActorRow = {
  id: string;
  email: string;
  display_name: string;
  is_first_member: boolean;
  groups: string[] | null;
};

export async function resolveIntelligenceActor(context: ResolvedTenantContext): Promise<IntelligenceActor> {
  if (!context.identity) {
    if (context.isDevelopmentFallback) {
      return {
        subject: "development",
        userId: null,
        displayName: "Local developer",
        email: "local@savant.dev",
        isAdmin: true,
        groups: ["platform-admins"],
        isFirstMember: true,
      };
    }
    throw new SkillIntelligenceError("auth_required", "Sign in before performing this action.", 401);
  }

  if (context.isDevelopmentFallback) {
    return {
      subject: context.identity.subject,
      userId: null,
      displayName: context.identity.displayName,
      email: context.identity.email,
      isAdmin: true,
      groups: ["platform-admins"],
      isFirstMember: true,
    };
  }

  const sql = getControlPlaneDatabase();
  const rows = await sql<ActorRow[]>`
    with ordered_users as (
      select users.id, users.email, users.display_name, users.external_subject, users.status,
        row_number() over (order by users.created_at asc, users.email asc) = 1 as is_first_member
      from users
      where users.organization_id = ${context.tenant.organizationId}
    )
    select ordered_users.id, ordered_users.email, ordered_users.display_name, ordered_users.is_first_member,
      coalesce(array_agg(distinct groups.name) filter (where groups.name is not null), array[]::text[]) as groups
    from ordered_users
    left join group_memberships on group_memberships.user_id = ordered_users.id
    left join groups on groups.id = group_memberships.group_id
    where ordered_users.external_subject = ${context.identity.subject}
      and ordered_users.status = 'active'
    group by ordered_users.id, ordered_users.email, ordered_users.display_name, ordered_users.is_first_member
    limit 1
  `;

  const row = rows[0];
  if (!row) {
    throw new SkillIntelligenceError("tenant_actor_not_found", "The current user is not an active member of this workspace.", 403);
  }

  const groups = row.groups ?? [];
  return {
    subject: context.identity.subject,
    userId: row.id,
    displayName: row.display_name || row.email,
    email: row.email,
    isAdmin: row.is_first_member || groups.some((group) => group.toLowerCase() === "platform-admins"),
    groups,
    isFirstMember: row.is_first_member,
  };
}

export function requireAdmin(actor: IntelligenceActor, operation: string): void {
  if (!actor.isAdmin) {
    throw new SkillIntelligenceError(
      "tenant_admin_required",
      `Only workspace Owners and platform-admins can ${operation}.`,
      403,
    );
  }
}

/** Reviewer authorization under Savant RBAC: Owner, platform-admins, skill-reviewers, or the skill owner. */
export function requireReviewer(
  actor: IntelligenceActor,
  skillOwner: string | null,
  options: { devAlias?: string | undefined; isDevelopmentFallback: boolean },
): ReviewActor & { subject: string; userId: string | null } {
  const role = options.isDevelopmentFallback
    ? "Development"
    : resolveReviewerRole({
        isFirstMember: actor.isFirstMember,
        groups: actor.groups,
        email: actor.email,
        skillOwner,
      });

  if (!role) {
    throw new SkillIntelligenceError(
      "reviewer_not_authorized",
      "Only workspace Owners, platform-admins, skill-reviewers, or the skill owner can review improvement recommendations.",
      403,
    );
  }

  // Local development has a single synthetic user; an alias lets one person
  // exercise multi-reviewer approval. Ignored outside development fallback.
  const alias = options.isDevelopmentFallback && options.devAlias ? `#${options.devAlias.slice(0, 40)}` : "";

  return {
    userRef: `${actor.userId ?? actor.subject}${alias}`,
    displayName: `${actor.displayName}${alias}`,
    role,
    subject: actor.subject,
    userId: actor.userId,
  };
}
