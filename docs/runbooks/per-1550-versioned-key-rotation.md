# PER-1550 — Authenticated v2 AES-GCM envelopes and versioned key recovery

This increment implements **read-old / write-new key selection** in both existing persistence paths. It is not a production secret deployment, KMS configuration, data rewrap, or proof of successful disaster recovery. Do **not** activate v2 on production merely because unit or preview checks pass.

## Existing v1 and new v2 envelopes

| Domain | Legacy v1 | Version 2 |
| --- | --- | --- |
| Test Bench definition cases and run receipts | `v1:<base64url nonce>:<base64url tag>:<base64url ciphertext>`; v1 AAD unchanged | `v2:<keyId>:<base64url nonce>:<base64url tag>:<base64url ciphertext>`; AAD binds keyId, org, definition/run, revision, commit SHA and v2 |
| AI connection BYO provider credentials | `v1:<base64 nonce>:<base64 tag>:<base64 ciphertext>`; v1 AAD unchanged | `v2:<keyId>:<base64 nonce>:<base64 tag>:<base64 ciphertext>`; AAD binds keyId, org, connection, provider and v2 |

All ciphertext uses AES-256-GCM with CSPRNG 96-bit nonce and 128-bit tag. An unknown key ID fails; **no sequential trial of historical keys** is permitted. Previous-version encryption keys are read-only and bounded to eight explicit IDs. A format or key-ID downgrade cannot satisfy the authenticated AAD. Neither raw key bytes nor ciphertext are logged, stored in Git, returned in a response or exposed in browser bundles.

## Server-only environment contract

**Test Bench**
- `TEST_BENCH_ENCRYPTION_KEY`: current 32-byte AES key, canonical 64-char hex or 43-char unpadded base64url.
- `TEST_BENCH_ENCRYPTION_KEY_ID`: authenticated v2 key ID, e.g. `oct2026`. *Absent means legacy-only v1 mode.*
- `TEST_BENCH_LEGACY_ENCRYPTION_KEY`: explicit v1 AES/HMAC key, required before v2 activation; escrow separately and keep until all v1 ciphertext is safely rewrapped and all old idempotent request IDs are expired or migrated.
- `TEST_BENCH_PREVIOUS_ENCRYPTION_KEYS`: optional JSON map of at most eight historical **v2** key IDs to canonical keys. Never put it in Git or issue descriptions.

**BYO AI connection**
- `AI_CONNECTION_ENCRYPTION_KEY`: current AES key, canonical hex or standard padded base64.
- `AI_CONNECTION_ENCRYPTION_KEY_ID`: v2 authenticated key ID, absent in v1 mode.
- `AI_CONNECTION_LEGACY_ENCRYPTION_KEY`: explicit old v1 key, required when v2 active.
- `AI_CONNECTION_PREVIOUS_ENCRYPTION_KEYS`: optional bounded JSON of previous v2 keys.

No key material may be reused between Test Bench, BYO AI, Git credential broker or other crypto domains. Managed-key preflight PER-1551 checks shape only; KMS ownership, RBAC, independent approval and protected deployment require separate verification.

## Idempotency hazard and resolution

Existing `testBenchRequestDigest` derives its request-HMAC from the original Test Bench AES key. The v2 code deliberately derives its HMAC from `TEST_BENCH_LEGACY_ENCRYPTION_KEY` even after the active AES key changes. This makes exact replay fingerprints **byte-identical** for every existing organization/payload under the previous v1 key.

**Do not retire or replace the legacy Test Bench key** while outstanding request IDs or v1 ciphertext exist. Before eventual removal, a separate reviewed migration must either maintain a stable dedicated HMAC key of identical bytes or migrate all request digests within the relevant retention window and invalidate/reconcile stale replay references. A new unrelated HMAC key is not a safe drop-in replacement.

## Controlled staging rollout (not performed)

1. Security owner exports or securely copies each existing v1 AES key into independently escrowed *legacy* secret references. Verify backup DB + matching legacy keys can actually restore old ciphertext. Capture only key ID and source metadata as audit evidence; never publish keys.
2. Generate **independent** 32-byte active v2 keys inside approved KMS/secrets controls. Add both active value, explicit key ID and appropriate legacy value to the same *isolated, protected staging* deployment. No uncontrolled production deployment, no logging environment variables.
3. Verify cross-tenant v1 read, new v2 write, stable HMAC replay, strict wrong-ID/AAD denial and restored key visibility across app instances, then perform workload-specific rewrap of old ciphertext using transaction locks and audited hashes. A rewrap must not mutate source records, score provenance, costs, model receipts, audit history or idempotency.
4. Rotate current v2 key again with a new ID and retain previous v2 ID in read-only historical map. Verify old ciphertext reads, new writes use the new ID, and previous ciphertext fails when old key is *deliberately removed*.
5. Independent security review signs off on KMS backup, key deletion policy, recovery within a separate environment, incident rollback, tenant isolation and live Auth0 NIM/Jev/BYO OpenAI acceptance. No production activation until main ruleset PER-1455 and PER-1426 acceptance are genuine.

## TDD

Tests cover byte-identical v1 AAD/reads, explicit legacy-key v2 guard, v2 authenticated key-ID, tenant/commit/revision AAD swaps, previous-version rotation/retirement, malformed key catalogs and old-to-new request-HMAC stability. All ordinary Test Bench source pinning, BYO encrypted-credential, database, cancellation, provider usage and billing regressions remain blocking.

No ciphertext rewrap job, KMS configuration, live restore drill, external provider billing artifacts, GitHub branch-protection change or production deployment occurs in this PR. Parent PER-1426 must remain In Progress until operator-controlled staging proof is recorded.
