# Runtime assessment plan: Rust vs Python on Vercel

Before Savant ships any dedicated backend or worker code, we want an evidence-based runtime decision for the first non-frontend services that may run on Vercel.

## Decision boundary

This assessment is meant to choose the **first production runtime** for Vercel-hosted services outside the Next.js frontend. It does **not** decide the entire long-term execution strategy for background processing or non-Vercel infrastructure.

## Beta delivery posture while the assessment runs

The runtime assessment gates extraction into dedicated `apps/api` and `apps/worker` targets. It does **not** block the first integrated beta from continuing to ship provider-backed write and sync flows.

Until the benchmark is complete and a runtime is chosen:

- keep the first mutation and sync endpoints inside `apps/web`
- treat `apps/web` as the initial BFF for repo connect, repo provision, and skill apply flows
- keep domain logic provider-neutral under `apps/web/src/server/control-plane`
- defer extraction into `apps/api` or `apps/worker` until benchmark data or production pressure justifies it

See `docs/architecture/adr-0001-beta-runtime-boundary.md` for the accepted beta-scope decision.

## Architectural assumption for the benchmark

Tenant-authored skill content should live in a **provider-agnostic external Git environment**.

That means the benchmark must cover workloads representative of:

- connecting an existing skill repository
- provisioning a new repository from a Savant template
- scanning and validating repository layout
- ingesting manifests, datasets, and repository-backed metadata
- building release-preview bundles from Git-backed content
- processing repository change events

Savant-managed governance state still remains outside Git, including RBAC, approvals, audit logs, eval runs, and release metadata.

See `docs/architecture/tenant-skill-storage.md` for the storage model behind this assumption.

## Assessment kit

Use the artifacts in `infra/vercel/runtime-assessment/`:

- `README.md` — execution guidance and assessment rules
- `workload-manifest.yaml` — benchmark scenarios and fixture sizes
- `scorecard-template.md` — weighted comparison worksheet
- `results/runtime-result.template.json` — machine-readable result format
- `results/decision-record.template.md` — written recommendation template

## Decision questions

Evaluate Rust and Python against the **same** workloads, contracts, and fixture repository shape.

1. Cold start behavior on Vercel
2. Warm latency for Git-heavy and bundle-related requests
3. Packaging ergonomics and deploy complexity
4. Ecosystem fit for evaluation, scoring, and repository workflows
5. Local developer experience inside this monorepo
6. Observability and debugging support
7. Operational constraints, including memory limits and artifact size
8. Security and supply-chain posture

## Exit criteria

We can start dedicated backend implementation once we have:

- a completed benchmark run for both runtimes against the same workload manifest
- a written recommendation for the primary runtime
- a fallback recommendation for workloads that do not fit the primary choice
- agreement on which workloads should remain on Vercel and which should move elsewhere

## Current repo posture

- `apps/web` is fully bootstrapped and ready for frontend work
- first integrated beta writes should continue to land in `apps/web` while runtime evidence is gathered
- `apps/api` is a placeholder only
- `apps/worker` is a placeholder only
- no dedicated backend runtime has been committed yet
