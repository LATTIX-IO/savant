# PER-1602 next-increment isolated test evidence — 2026-10-22

- Context: detached local subset of Savant sources copied from PR #145, not a full Git checkout.
- Node.js: 22.16.0; TypeScript: 5.8.3.
- Test command: `node --experimental-strip-types --test` targeting the three existing role/Anthropic tests and the new pricing/reservation/dispatch tests.
- Result: **30 passed, 0 failed** (17 PR #145 tests plus 13 new pricing/reservation/dispatch tests).
- Strict isolated `tsc --pretty false --project tsconfig.json`: **passed**.
- `tsconfig.json` and type-only `postgres-local-stub.d.ts` are temporary local validation fixtures, **not** submitted in the PR. Existing ChatClient definitions use a temporary type-only subset from the authenticated source file. Isolated TypeScript success is not evidence of a full Next.js build.
- Mock transactional PostgreSQL double: tested duplicate-call rejection, foreign actor/model/tenant denial before mutation, rollback of reservations after daily/monthly exhaustion, conservative reserve retention, single-use dispatch and sanitized database outage. **This was not an actual PostgreSQL test**, and the SQL proposal was not executed.
- No live provider call, OAuth registration, key material, database credential, production DDL, secret or paid usage was used.
- Remaining exact-head validation: full repository typecheck/lint/build, PostgreSQL 16 transactional concurrency/idempotency and restore, production-scope key recovery, A/B/C tenant UAT, rate evidence verification, provider sandbox then actual approved-credential receipts, cost reconciliation and browser accessibility.

Release disposition: **review-only draft**. PR #145 must be qualified and integrated before this stacked increment can be merged, and PER-1592 remains a production activation prerequisite.
