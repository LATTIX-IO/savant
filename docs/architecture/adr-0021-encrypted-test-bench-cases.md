# ADR-0021 — Tenant-bound encrypted Test Bench definitions (PER-1422)

**Status:** Increments toward functional MVP, pending exact-head CI and independent security review.
**Dependency:** PER-1419 / PR #62 immutable indexed evaluation SHA, PER-1420 / PR #63 authenticated evaluation detail page.
**Explicit boundary:** This PR persists case definitions only; it does not execute cases, generate scores, or create release QA evidence.

## Domain and authoritative source

Each case suite is bound at creation to the **server-selected** most recent indexed skill in the authenticated tenant: organization UUID, repository UUID, skill ID, source path and full 40/64-character Git commit SHA. User-supplied repository/commit overrides are prohibited. If a repository's branch or indexed SHA later advances, the saved definition keeps its original SHA. No auto-upgrade or mixed-version case semantics.

Table `test_bench_definitions` stores metadata, an encrypted cases blob, creation request UUID/keyed HMAC digest, a monotonically increasing revision, author subject, timestamps, and soft archive. A composite foreign key **(organization_id, repository_id)** prevents one tenant's definitions from attaching to another tenant's repository even if a privileged operation bypasses the service. Migration prefix **0023** is reserved after the parallel PER-1059 harness stack's 0015–0022 migrations; conflicts must be reconciled when combining branches.

Cases: up to eight unique IDs, type `positive|negative|edge|escalation`, prompt (1–2000 chars), optional context (up to 1500), and expected behavior (1–1000). Total normalized case JSON <= 16 KiB. Unknown fields, control characters, malformed JSON, duplicate IDs, missing preconditions and requests over 20 KiB are denied. No arbitrary runner commands, script execution or connector secrets in the contract.

## Storage encryption and operations

`TEST_BENCH_ENCRYPTION_KEY` must be configured server-side as a distinct 32-byte key (64 hex or canonical base64url). AES-256-GCM uses a new 96-bit nonce per write, a 128-bit tag and **AAD including tenant, definition ID, revision and immutable source commit**. Records carry a `v1` envelope; ciphertext or AAD tampering and missing keys fail closed. Raw cases never appear in audit payloads, background jobs or access logs. Future production hardening: managed key versioning/rotation, envelope KMS, operational recovery, retention and cryptographic erasure.

Transaction boundaries: create deduplicates on tenant + caller-supplied create request UUID and validates a tenant-separated, domain-separated HMAC fingerprint generated from a subkey derived from the encryption key (not an unkeyed guessable case hash), then inserts encrypted cases plus an audit record atomically. Updates and soft archives lock the row, demand an exact `expectedRevision`, increment the revision and append metadata-only audit in the same transaction. Stale concurrent writers get 409; archived definitions are no longer readable; archive is not a destructive plaintext purge.

## Authorization, API and UX

- `GET /api/skills/[id]/test-bench?workspaceSlug=<slug>`: list up to 50 active definitions.
- `POST /api/skills/[id]/test-bench?workspaceSlug=<slug>`: create revision 1, 201; same request ID replay returns 200 with original definition; altered replay returns 409.
- `GET/PATCH/DELETE /api/skills/[id]/test-bench/[definitionId]?workspaceSlug=<slug>`: view, CAS update and CAS archive.
- All endpoints require a real authenticated active tenant (no anonymous development persistence). Mutations also require same-origin CSRF check; Git-derived RBAC permits tenant members to read and repository managers/admins to edit. Server error mapping returns only safe code/status.
- Evaluation detail includes a **Workspace Test Bench case suites** editor that saves/deletes real encrypted records, unlike existing browser-local legacy drafts. It expressly does not show a Run button or synthesized QA score. Browser client sends same-origin credentials and the required workspaceSlug, never a foreign origin.

## Verification and release gates

- **Unit/security:** strict case schema; duplicate/unsafe keys/control chars/large data; AES-GCM roundtrip and random nonce; denied tenant/definition/revision/commit/key swap and ciphertext tampering; bounded JSON requests; tenant API URL scoping and fake-score absence.
- **PostgreSQL integration:** creation and replay, mutable indexed SHA advance, CAS update and concurrent conflict, member edit refusal, cross-tenant read/mutate denial, foreign repository FK constraint, soft archive, ciphertext-only DB, and metadata-only audit count. Applies all migrations twice for idempotency.
- **Exact-head CI:** Node tests, TypeScript, lint, Next.js build, secret scan and isolated PostgreSQL; required production high/critical dependency audit from PR #46 after remediation is reconciled; independent security review.
- **Before MVP release:** live Auth0 multi-tenant browser E2E, DB encryption key provisioning and restore/rotate exercise, no orphaned PR stack, real external/internal provider case execution with bounded budgets and evidence. This branch is not proof those capabilities exist.

## Next increment

PER-1421 continues with a secure, bounded asynchronous executor that consumes immutable saved case definitions and the customer-provided harness where supported. Each run needs durable idempotency/reservation, per-case observed scores and verdicts, authenticated telemetry, cancellation, cost settlement and historical comparison; **never substitute generated/simulated values**.
