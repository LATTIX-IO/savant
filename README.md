# Savant

Savant is the enterprise platform for codifying expertise as governed, measurable, reusable skills.

## What is bootstrapped today

- a `pnpm` + Turborepo monorepo root
- a fully working Next.js App Router frontend in `apps/web`
- spec-aligned placeholder folders for future API, worker, packages, database assets, skills, and infra
- CI that validates linting, typechecking, and production builds
- a Vercel runtime assessment kit for comparing Rust and Python before backend work begins

## What is intentionally deferred

- backend runtime implementation until the Rust vs Python on Vercel assessment is complete
- database schema, migrations, auth, RBAC, and evaluation pipelines
- connector orchestration, signed bundle generation, and sync agents

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
pnpm typecheck
pnpm build
pnpm check
```

## Product references

- Core platform spec: `docs/product-specs/spec-core.md`
- Runtime assessment gate: `docs/architecture/runtime-assessment.md`
- Runtime assessment artifacts: `infra/vercel/runtime-assessment/`
- Tenant skill storage architecture: `docs/architecture/tenant-skill-storage.md`

## Current frontend scope

`apps/web` is ready to become the initial admin console and skill catalog surface.
The repo is intentionally not committed to Python, Rust, or any other backend runtime yet.
The `skills/` directory in this repo is for templates and local reference assets, not the primary store for tenant-authored production skills.
