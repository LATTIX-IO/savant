# Savant non-UI convergence candidate — October 18, 2026

**Status:** Integration-only, DRAFT. No source merged to protected `main` and no release or live KMS maintenance permitted.

This tree combines source branches [PR #79](https://github.com/LATTIX-IO/savant/pull/79) (Test Bench and immutable observed QA), [PR #60](https://github.com/LATTIX-IO/savant/pull/60) (customer-owned harness adapter, signed receipt, Azure Key Vault and Entra federation), [PR #93](https://github.com/LATTIX-IO/savant/pull/93) (provider billing source evidence and production entitlement refusal), [PR #99](https://github.com/LATTIX-IO/savant/pull/99) (versioned AEAD/crypto maintenance and synthetic encrypted PostgreSQL restore), [PR #100](https://github.com/LATTIX-IO/savant/pull/100) (cross-platform fail-closed governance CLI), and inherited [PR #95](https://github.com/LATTIX-IO/savant/pull/95) (immutable GitHub Actions and pinned dependencies). It deliberately **excludes UI prototype #66, UI design-system integration #73, and phase-two admin ruleset PR #96**.

## Increment acceptance
- All changed files derive from their exact Git blob IDs; overlapping workflow is a tested union, not an arbitrary overwrite.
- PostgreSQL revisions 0001–0035 are contiguous and applied twice on one integration database, then harness, Test Bench, crypto and billing acceptance scripts execute on that same DB.
- Node/TypeScript/Lint/build, Python telemetry tests, independent high/critical production dependency audit, secret scan, and four installer builds must pass on the exact integration head.
- Cross-tenant access, replays, delayed provider usage, managed key failures, unauthorized maintenance and billing unknowns must remain fail-closed in the existing suites.
- Vercel preview READY does **not** prove authenticated user acceptance or staging isolation.

## Release blockers
1. PER-1455 live enforced main/tag rulesets, independent reviewer, protected publication environment; no bypass.
2. Protected integration reviews for contributing branches and this combined head; identify actual production deployment and rollback owner.
3. PER-1556 isolated staging with distinct managed keys, real encrypted database+key recovery, negative restore evidence, and witnessed acceptance; PR #99's synthetic restore is insufficient.
4. PER-1421 authenticated tenant-owned provider/harness test journey with version-pinned suites, actual usage, comparison and reviewed improvement proposal.
5. Phase-two ruleset upgrade #96 must operate only against the actual protected post-merge main SHA, not a draft head.

Do not close original integration PRs as merged based solely on this draft, and do not delete preserved predecessor branches. The UX work remains an independent open stream.
