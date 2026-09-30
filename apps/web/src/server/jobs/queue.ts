type Sql = import("postgres").Sql;

/**
 * Lease-based background job queue in Postgres. Workers claim with
 * `for update skip locked`; a job whose lease expired (the function ran out
 * of time) is claimable again, up to MAX_ATTEMPTS.
 */

export type JobKind = "eval_generation" | "safety_scan" | "hub_sync" | "hub_safety" | "hub_eval";

export type BackgroundJob = {
  id: string;
  /** Null for platform jobs (the public skill catalog). */
  organizationId: string | null;
  repositoryId: string | null;
  kind: JobKind;
  dedupeKey: string;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  attempts: number;
};

type JobRow = {
  id: string;
  organization_id: string | null;
  repository_id: string | null;
  kind: JobKind;
  dedupe_key: string;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  attempts: number;
};

export const MAX_ATTEMPTS = 4;
const LEASE_SECONDS = 330;

const toJob = (row: JobRow): BackgroundJob => ({
  id: row.id,
  organizationId: row.organization_id,
  repositoryId: row.repository_id,
  kind: row.kind,
  dedupeKey: row.dedupe_key,
  payload: row.payload ?? {},
  progress: row.progress ?? {},
  attempts: row.attempts,
});

export function createJobQueue(sql: Sql) {
  return {
    /** Enqueues unless a live job with the same key exists; returns the live job's id either way. */
    async enqueue(input: { organizationId: string | null; repositoryId: string | null; kind: JobKind; dedupeKey: string; payload?: Record<string, unknown> }): Promise<{ id: string; created: boolean }> {
      const inserted = await sql<{ id: string }[]>`
        insert into background_jobs (organization_id, repository_id, kind, dedupe_key, payload)
        values (${input.organizationId}, ${input.repositoryId}, ${input.kind}, ${input.dedupeKey}, ${sql.json((input.payload ?? {}) as never)})
        on conflict do nothing
        returning id
      `;
      if (inserted[0]) {
        return { id: inserted[0].id, created: true };
      }
      const [existing] = await sql<{ id: string }[]>`
        select id from background_jobs
        where organization_id is not distinct from ${input.organizationId}::uuid and kind = ${input.kind} and dedupe_key = ${input.dedupeKey}
          and status in ('queued', 'running')
        limit 1
      `;
      if (!existing) {
        throw new Error("The job could not be enqueued.");
      }
      return { id: existing.id, created: false };
    },

    async claim(): Promise<BackgroundJob | null> {
      // Jobs that keep dying mid-run are retired instead of retried forever.
      await sql`
        update background_jobs set status = 'failed', error = coalesce(error, 'The job ran out of time repeatedly.'), updated_at = now(), completed_at = now()
        where status = 'running' and lease_until < now() and attempts >= ${MAX_ATTEMPTS}
      `;
      const rows = await sql<JobRow[]>`
        update background_jobs set status = 'running', attempts = attempts + 1,
          lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
        where id = (
          select id from background_jobs
          where status = 'queued' or (status = 'running' and lease_until < now())
          order by created_at asc
          for update skip locked
          limit 1
        )
        returning id, organization_id, repository_id, kind, dedupe_key, payload, progress, attempts
      `;
      return rows[0] ? toJob(rows[0]) : null;
    },

    async saveProgress(id: string, progress: Record<string, unknown>): Promise<void> {
      await sql`
        update background_jobs set progress = ${sql.json(progress as never)}, lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
        where id = ${id}
      `;
    },

    /** Puts a partly done job back in the queue (out of time budget); attempts aren't charged. */
    async release(id: string, progress: Record<string, unknown>): Promise<void> {
      await sql`
        update background_jobs set status = 'queued', lease_until = null, attempts = greatest(attempts - 1, 0),
          progress = ${sql.json(progress as never)}, updated_at = now()
        where id = ${id}
      `;
    },

    async complete(id: string, progress?: Record<string, unknown>): Promise<void> {
      await sql`
        update background_jobs set status = 'complete', lease_until = null, updated_at = now(), completed_at = now(),
          progress = coalesce(${progress ? sql.json(progress as never) : null}::jsonb, progress)
        where id = ${id}
      `;
    },

    async fail(id: string, error: string): Promise<void> {
      await sql`
        update background_jobs set status = 'failed', lease_until = null, error = ${error.slice(0, 2000)}, updated_at = now(), completed_at = now()
        where id = ${id}
      `;
    },

    async hasPending(): Promise<boolean> {
      const [row] = await sql<{ pending: boolean }[]>`
        select exists (
          select 1 from background_jobs where status = 'queued' or (status = 'running' and lease_until < now())
        ) as pending
      `;
      return row?.pending ?? false;
    },
  };
}

export type JobQueue = ReturnType<typeof createJobQueue>;
