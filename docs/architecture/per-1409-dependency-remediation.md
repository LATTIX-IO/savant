# PER-1409 — Production dependency remediation and rollback

**Status:** Pending independent review and final CI verification on the exact release head.
**Scope:** Stack onto PER-1057 adapter contract PR #45. No product/API change was intended.

## Baseline and root cause

The Savant TypeScript workflow previously scanned for secrets only and inherited a separate legacy mesh-node Rust CI workflow whose skips could be mistaken for security coverage. PER-1057 exposed an independent, blocking `pnpm audit --prod --audit-level high` job. Against the original lockfile this returned **31 advisories: 3 critical, 15 high, 11 moderate, 2 low**. Next.js was pinned at 16.2.6. Illustrative advisories: GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j, GHSA-cjq9-62q9-8jv4, GHSA-wq5f-xc86-pv6w, GHSA-r28c-9q8g-f849, GHSA-73wf-gq98-2v4g and GHSA-68fv-2mgg-jv7q.

## Remediation

- Upgrade `next` and `eslint-config-next` from 16.2.6 to 16.3.8 as a paired security patch.
- Refresh `pnpm-lock.yaml` on GitHub Actions using pnpm 10.30.0 and Node 24, because the connector runtime cannot access npm registry.
- Apply explicit, same-major transitive resolution bounds in `pnpm-workspace.yaml`, covering `postcss` >=8.5.18, `nanoid@3` >=3.3.18, `browserslist` >=4.28.7 and `source-map-js` >=1.2.2.
- Lockfile observed after resolution: sharp 0.35.5, postcss 8.5.23, nanoid 3.3.20, browserslist 4.29.3, source-map-js 1.2.2.
- The one-time lockfile generation workflow was deleted before the reviewable PR head. **Do not restore it to main.**

## Evidence and acceptance

Run GitHub Actions on the final PR SHA and require **all**:
1. `pnpm install --frozen-lockfile`.
2. `pnpm test` with adapter and inherited regression suites, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
3. `pnpm security:secrets` and **blocking** `pnpm audit --prod --audit-level high`. No suppression or advisory allowlist.
4. PostgreSQL migrations and tenant authorization checks.
5. Independent review of dependency diff and approval before merge.
6. Sandbox smoke for image optimization, OG image rendering and runtime/node compatibility when used in the actual deployment; production rollout remains held until reviewed.

The audit count must be read from the final **completed** CI run, never inferred from a package version alone. Older runs were often canceled by newer pushes and are not sufficient signoff.

## Deployment and rollback

Merge the remediation branch into the PER-1057 feature branch only after all checks pass, then require fresh CI against the rebased PR #45 head. Roll back by reverting the exact dependency remediation commit and redeploying the previously pinned build, **only as a controlled emergency measure**; doing so reintroduces known security vulnerabilities and must trigger an incident/security-owner decision. Keep the new dependency audit blocking throughout.

## Remaining PER-1057 requirements

This dependency update closes only PER-1409, **not** the full PER-1057 harness adapter story. Distributed durable idempotency, verified mTLS/OAuth integration, production invocation broker, webhook validation and recovery, real-harness smoke, and performance/SLO evidence remain tracked separately.