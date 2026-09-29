import { GitProviderError } from "./errors.ts";

/**
 * Source-control RBAC (spec §24).
 *
 *   Organization Admin   connect / disconnect / reauthorize providers, configure repository access
 *   Repository Manager   connect approved repositories, sync, disconnect repositories
 *   Member               view connected repositories and connections
 *
 * Workspace owners (first member) and `platform-admins` are admins; the
 * `repository-managers` group grants repository management.
 */

export type GitAccessRole = "admin" | "repository_manager" | "member";

export type GitAction =
  | "view"
  | "connect_provider"
  | "disconnect_provider"
  | "reauthorize_provider"
  | "validate_provider"
  | "configure_repository_access"
  | "connect_repository"
  | "sync_repository"
  | "disconnect_repository";

const ROLE_RANK: Record<GitAccessRole, number> = { member: 0, repository_manager: 1, admin: 2 };

const REQUIRED_ROLE: Record<GitAction, GitAccessRole> = {
  view: "member",
  connect_provider: "admin",
  disconnect_provider: "admin",
  reauthorize_provider: "admin",
  validate_provider: "repository_manager",
  configure_repository_access: "admin",
  connect_repository: "repository_manager",
  sync_repository: "repository_manager",
  disconnect_repository: "repository_manager",
};

export type GitActor = {
  organizationId: string;
  subject: string;
  role: GitAccessRole;
};

export interface GitMembershipStore {
  resolveMember(input: { organizationId: string; subject: string }): Promise<{ isFirstMember: boolean; groups: string[] } | null>;
}

export function roleFromMembership(member: { isFirstMember: boolean; groups: readonly string[] }): GitAccessRole {
  const groups = member.groups.map((group) => group.trim().toLowerCase());

  if (member.isFirstMember || groups.includes("platform-admins")) {
    return "admin";
  }

  if (groups.includes("repository-managers")) {
    return "repository_manager";
  }

  return "member";
}

export function canPerform(role: GitAccessRole, action: GitAction): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[REQUIRED_ROLE[action]];
}

export function assertGitPermission(actor: GitActor, action: GitAction): void {
  if (!canPerform(actor.role, action)) {
    const needed = REQUIRED_ROLE[action] === "admin" ? "an organization admin" : "a repository manager or admin";
    throw new GitProviderError("PERMISSION_DENIED", `Only ${needed} can ${action.replace(/_/g, " ")}.`);
  }
}

/** Resolves the actor strictly inside the authenticated organization. */
export async function resolveGitActor(
  store: GitMembershipStore,
  input: { organizationId: string; subject: string | null | undefined; isDevelopmentFallback?: boolean | undefined },
): Promise<GitActor> {
  if (!input.subject) {
    throw new GitProviderError("AUTH_REQUIRED", "Sign in to manage source control.", { status: 401 });
  }

  if (input.isDevelopmentFallback) {
    return { organizationId: input.organizationId, subject: input.subject, role: "admin" };
  }

  const member = await store.resolveMember({ organizationId: input.organizationId, subject: input.subject });
  if (!member) {
    throw new GitProviderError("PERMISSION_DENIED", "You are not a member of this workspace.");
  }

  return { organizationId: input.organizationId, subject: input.subject, role: roleFromMembership(member) };
}
