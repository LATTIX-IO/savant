# Runtime decision record

- Date:
- Commit:
- Fixture profile:
- Evaluators:

## Context

Summarize the workloads and beta delivery posture being evaluated.

## Compared options

- Primary candidate:
- Secondary candidate:

## Evidence summary

| Criterion | Rust summary | Python summary | Better fit |
| --- | --- | --- | --- |
| Cold start behavior |  |  |  |
| Warm latency |  |  |  |
| Packaging/deploy ergonomics |  |  |  |
| Repo/eval ecosystem fit |  |  |  |
| Local developer experience |  |  |  |
| Observability/debugging |  |  |  |
| Operational limits |  |  |  |
| Security/supply-chain posture |  |  |  |

## Recommendation

State the recommended primary runtime and why.

## Fallback recommendation

State which runtime should be used when the primary choice is a poor fit.

## Workloads that stay in `apps/web` for now

List the flows that should remain in the BFF until extraction pressure is real.

## Workloads that should move to dedicated targets

List the first workloads that justify `apps/api` or `apps/worker`.

## Risks and follow-up work

- Risk:
- Risk:
- Follow-up:
