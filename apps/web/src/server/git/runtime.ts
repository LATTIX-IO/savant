import "server-only";

import { resolveGitActor, type GitActor, type GitMembershipStore } from "./access-control.ts";
import { createGitConnectionService } from "./connection-service.ts";
import { createGitCredentialBroker } from "./credential-broker.ts";
import { getDefaultGitProviderRegistry } from "./providers/registry.ts";
import { logGitEvent } from "./redaction.ts";
import { createGitRepositoryService, type RepositoryIndexJob, type RepositoryIndexScheduler } from "./repository-service.ts";
import { createDatabaseGitStores } from "./stores-db.ts";
import type { GitStores } from "./stores.ts";
import type { ResolvedTenantContext } from "../control-plane/tenant-context.ts";

/**
 * Production composition root for the git subsystem: Postgres stores, the
 * default provider registry, the credential broker, and the services built on
 * them. Route handlers and the indexer obtain everything from here.
 */

export type GitRuntime = {
  stores: GitStores;
  broker: ReturnType<typeof createGitCredentialBroker>;
  registry: ReturnType<typeof getDefaultGitProviderRegistry>;
  connections: ReturnType<typeof createGitConnectionService>;
  membership: GitMembershipStore;
  createRepositoryService(scheduler: RepositoryIndexScheduler): ReturnType<typeof createGitRepositoryService>;
};

async function createDatabaseMembershipStore(): Promise<GitMembershipStore> {
  const { getControlPlaneDatabase } = await import("../control-plane/database.ts");
  const sql = getControlPlaneDatabase();

  return {
    async resolveMember(input) {
      const rows = await sql<{ is_first_member: boolean; groups: string[] | null }[]>`
        with ordered_users as (
          select users.id, users.external_subject, users.status,
            row_number() over (order by users.created_at asc, users.email asc) = 1 as is_first_member
          from users
          where users.organization_id = ${input.organizationId}
        )
        select ordered_users.is_first_member,
          coalesce(array_agg(distinct groups.name) filter (where groups.name is not null), array[]::text[]) as groups
        from ordered_users
        left join group_memberships on group_memberships.user_id = ordered_users.id
        left join groups on groups.id = group_memberships.group_id
        where ordered_users.external_subject = ${input.subject} and ordered_users.status = 'active'
        group by ordered_users.id, ordered_users.is_first_member
        limit 1
      `;
      const row = rows[0];
      return row ? { isFirstMember: row.is_first_member, groups: row.groups ?? [] } : null;
    },
  };
}

let runtimePromise: Promise<GitRuntime> | null = null;

export function getGitRuntime(): Promise<GitRuntime> {
  runtimePromise ??= (async () => {
    const stores = await createDatabaseGitStores();
    const registry = getDefaultGitProviderRegistry();
    const broker = createGitCredentialBroker({ connections: stores.connections, registry, audit: stores.audit });
    const membership = await createDatabaseMembershipStore();

    return {
      stores,
      broker,
      registry,
      membership,
      connections: createGitConnectionService({ stores, registry, broker }),
      createRepositoryService: (scheduler: RepositoryIndexScheduler) => createGitRepositoryService({ stores, broker, scheduler }),
    };
  })().catch((error: unknown) => {
    runtimePromise = null;
    throw error;
  });

  return runtimePromise;
}

export async function resolveGitActorForTenant(context: ResolvedTenantContext): Promise<GitActor> {
  const runtime = await getGitRuntime();
  return resolveGitActor(runtime.membership, {
    organizationId: context.tenant.organizationId,
    subject: context.identity?.subject,
    isDevelopmentFallback: context.isDevelopmentFallback,
  });
}

const inFlight = new Set<string>();

/**
 * Runs index jobs after the HTTP response using `after()` (bounded by the
 * route's maxDuration). Jobs are deduplicated on repositoryId + target
 * revision in-process; cross-instance concurrency is coalesced by the sync
 * claim in the database. A queue-backed scheduler can replace this without
 * changing callers, since jobs carry identifiers only.
 */
export function createAfterResponseIndexScheduler(defer: (task: () => Promise<void>) => void): RepositoryIndexScheduler {
  return {
    async enqueue(job: RepositoryIndexJob) {
      const key = `${job.repositoryId}:${job.targetRevision ?? ""}`;
      if (inFlight.has(key)) {
        return { started: true, reason: "An index for this revision is already running." };
      }
      inFlight.add(key);

      defer(async () => {
        try {
          const { indexRepositoryById } = await import("../control-plane/repository-index.ts");
          await indexRepositoryById({
            organizationId: job.organizationId,
            repositoryId: job.repositoryId,
            actor: { type: "user", ref: job.actorSubject },
            trigger: job.trigger,
          });
        } catch (error) {
          // Failures are already recorded on the repository's sync state.
          logGitEvent("warn", "scheduled_index_failed", { repository_id: job.repositoryId, error });
        } finally {
          inFlight.delete(key);
        }
      });

      return { started: true };
    },
  };
}
