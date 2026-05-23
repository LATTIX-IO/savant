# ADR-0001: Beta runtime boundary and delivery posture

- Status: Accepted
- Date: 2026-05-22

## Context

Savant already has a functioning multi-tenant Next.js application in `apps/web`, tenant-scoped DB-backed read models, onboarding flows, and preview-only repo bootstrap and skill scaffold endpoints.

What is still missing for the first integrated beta is the provider-backed write and sync plane:

- connect an existing tenant Git repository
- provision a new tenant Git repository
- apply skill scaffold writes into Git
- trigger and record indexing or sync refreshes
- keep the resulting control-plane state tenant-scoped and auditable

At the same time, `apps/api` and `apps/worker` are intentionally still placeholders while the Rust-vs-Python Vercel runtime assessment is unresolved.

Without an explicit boundary, the repo risks stalling delivery while waiting for the benchmark or, worse, starting backend extraction before there is evidence that the split is necessary.

## Decision

For the first integrated beta:

1. Keep the first provider-backed mutation and sync-trigger endpoints inside `apps/web`.
2. Treat `apps/web` as the initial BFF for:
   - repo connect
   - repo provision
   - skill apply writes
   - sync or index triggers
3. Keep domain logic provider-neutral under `apps/web/src/server/control-plane`.
4. Implement GitHub first for beta, but only behind provider-neutral ports and adapter interfaces.
5. Keep `apps/api` and `apps/worker` reserved for extraction after runtime evidence or production pressure justifies the move.
6. Store only secret references in Savant-managed state; do not place provider tokens, webhook secrets, or AI credentials in Git, client code, or plaintext logs.

## Consequences

### Positive

- unblocks product delivery while the runtime benchmark is completed
- avoids premature deployment sprawl
- lets the team validate the real provider and indexing workflows before committing to a dedicated backend runtime
- keeps later extraction mostly mechanical because the boundary is domain-first, not framework-first

### Negative

- `apps/web` will temporarily host more server-side responsibility than the long-term architecture likely wants
- later extraction into `apps/api` and `apps/worker` will still require packaging and deployment work
- operational limits such as timeouts, cold starts, and memory pressure must be watched closely during beta

## Triggers to revisit this ADR

Move provider-backed write or async execution code out of `apps/web` when one or more of the following is true:

- the runtime assessment under `infra/vercel/runtime-assessment/` is complete and recommends a dedicated API or worker target
- provider-backed routes in `apps/web` approach or exceed Vercel timeout, cold-start, or memory limits
- background execution needs durable queue semantics that are no longer safe to host in the app runtime
- operational complexity or incident response becomes materially better with separate deployable targets

## Scope notes

Included in this decision:

- beta delivery posture
- runtime boundary for initial write and sync flows
- provider scope for beta
- extraction triggers

Explicitly not decided here:

- the final long-term worker platform for heavy eval workloads
- multi-provider parity beyond a GitHub-first beta
- non-Vercel infrastructure strategy for future high-throughput or long-running jobs
