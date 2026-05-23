# Vercel runtime assessment kit

Use this kit to compare Rust and Python against the same Savant workloads before extracting provider-backed or worker-heavy code out of `apps/web`.

## Purpose

This assessment answers one narrow question:

> Which runtime should host Savant's first dedicated backend or worker targets on Vercel once the initial beta has outgrown the `apps/web` BFF posture?

It does **not** block the first integrated beta from shipping write and sync flows inside `apps/web`.

## Inputs

Use these files together:

- `workload-manifest.yaml` — benchmark scenarios and fixture profiles
- `scorecard-template.md` — weighted scoring worksheet
- `results/runtime-result.template.json` — machine-readable capture format for each runtime
- `results/decision-record.template.md` — final recommendation template
- `docs/architecture/adr-0001-beta-runtime-boundary.md` — current beta delivery posture

## Measurement rules

1. Compare Rust and Python on the same git commit of this repo.
2. Use the same fixture profile for both runtimes.
3. Use the same Vercel plan, region, and environment shape.
4. Keep provider operations semantically identical between runs.
5. Record both cold-start and warm-run behavior.
6. Note any packaging friction, deployment complexity, or runtime-specific workarounds.
7. Never place secrets, tokens, or customer data in assessment artifacts.

## Recommended execution flow

1. Pick a fixture profile from `workload-manifest.yaml`.
2. Implement the same thin benchmark harness in both runtime candidates.
3. Run every listed scenario for the selected profile.
4. Record raw measurements in a copy of `results/runtime-result.template.json`.
5. Score both runtimes in `scorecard-template.md`.
6. Write the final recommendation in a copy of `results/decision-record.template.md`.

## Naming convention

Store completed results under `results/` with names like:

- `runtime-result.rust.2026-05-22.json`
- `runtime-result.python.2026-05-22.json`
- `decision-record.2026-05-22.md`

## Decision guidance

Prefer the runtime that gives the best overall operational fit for the first extracted backend workload, not just the fastest single micro-benchmark.

If the scores are split by workload type, recommend:

- a primary runtime for the first extraction target
- a fallback runtime for workloads that do not fit the primary choice
- whether some workloads should remain in `apps/web` or move off Vercel entirely
