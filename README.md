# Savant

Savant is the enterprise platform for codifying expertise as governed, measurable, reusable skills.

## What is bootstrapped today

- a `pnpm` + Turborepo monorepo root
- a fully working Next.js App Router frontend in `apps/web`
- tenant-aware control-plane routes and DB-backed read surfaces in `apps/web`
- GitHub-first repository provisioning, scaffold/apply commits, and inline indexing in `apps/web`
- initial PostgreSQL control-plane schema and onboarding schema foundations under `db/`
- spec-aligned placeholder folders for future API, worker, packages, skills, and infra
- CI that validates linting, typechecking, and production builds
- a Vercel runtime assessment kit for comparing Rust and Python before backend work begins

## What is intentionally deferred

- extraction into dedicated `apps/api` and `apps/worker` runtimes until the Rust vs Python on Vercel assessment is complete
- multi-provider repository write parity, background indexing jobs, and webhook ingestion
- BYO AI execution flows, eval execution pipelines, and release orchestration
- connector orchestration, signed bundle generation, and advanced sync agents

The runtime decision is documented in `docs/architecture/runtime-assessment.md`.
Tenant-authored skill content is expected to live in a provider-agnostic external Git environment; that architecture is documented in `docs/architecture/tenant-skill-storage.md`.

## Workspace layout

```text
savant/
	apps/
		web/        # Next.js frontend, ready for feature work
		api/        # placeholder until runtime assessment is complete
		worker/     # placeholder until runtime assessment is complete
	packages/
		ui/
		types/
		schemas/
		config/
	db/
	skills/
	docs/
	infra/
```

## Getting started

```bash
pnpm install
pnpm dev
```

Useful validation commands:

```bash
pnpm lint
pnpm lint:fix
pnpm test
pnpm security:scan
pnpm typecheck
pnpm build
pnpm check
```

For a full local pre-commit sweep that installs dependencies, runs the security checks, fixes lint issues, runs tests, and finishes with the production validation gate:

```bash
bash ./precommit.sh
pwsh -NoProfile -ExecutionPolicy Bypass -File ./precommit.ps1
```

## Product references

- Core platform spec: `docs/product-specs/spec-core.md`
- Runtime assessment gate: `docs/architecture/runtime-assessment.md`
- Runtime assessment artifacts: `infra/vercel/runtime-assessment/`
- Tenant skill storage architecture: `docs/architecture/tenant-skill-storage.md`

## Current frontend scope

`apps/web` is the initial admin console, tenant shell, and BFF for the first integrated beta flows.
The repo is intentionally not committed to Python, Rust, or any other backend runtime yet.
The `skills/` directory in this repo is for templates and local reference assets, not the primary store for tenant-authored production skills.

The accepted beta runtime boundary is documented in `docs/architecture/adr-0001-beta-runtime-boundary.md`.
