# `@savant/web`

Next.js App Router frontend for Savant.

## Current scope

- branded starting point for the admin console and skill catalog
- `src/components`, `src/lib`, `src/hooks`, and `src/styles` scaffolded for product work
- intentionally no dedicated API or worker implementation yet

## Run from the repo root

```bash
pnpm install
pnpm dev
```

Validation commands:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Notes

- backend runtime work is deferred pending the Rust vs Python on Vercel assessment
- lightweight control-plane routes can stay in this app until that decision is made
- the source product spec lives in `../../docs/product-specs/spec-core.md`
