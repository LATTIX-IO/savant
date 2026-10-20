# PER-1551 — Managed Test Bench/BYO-AI key readiness and recovery gate

This increment is a **preflight and operator procedure**, not key provisioning or key rotation. Until PER-1550 provides versioned dual-read/single-write AES-GCM envelopes and a stable request-HMAC rotation strategy, **do not change existing production encryption keys**. Existing v1 ciphertext has no key identifier; a blind value replacement can make encrypted Test Bench definitions, receipts, and BYO provider credentials permanently unreadable.

## Current verified Vercel gap (October 16, 2026)

The `savant-web` project's environment *name inventory* contains 43 entries but lists neither `TEST_BENCH_ENCRYPTION_KEY` nor `AI_CONNECTION_ENCRYPTION_KEY`. `GIT_CREDENTIAL_ENCRYPTION_KEY` is a separate domain and cannot be reused. NIM/Jev and database connection names are present in production only; values have **not** been accessed. Preview READY does not establish Auth0, provider or managed-key readiness.

## Operator-controlled provisioning prerequisite

1. Security owner verifies the correct Vercel team/project, intended preview/staging/production environment, access groups and independent reviewer before writing a secret. Use KMS/HSM or appropriately governed secrets manager; generate distinct cryptographically random **32-byte** AES keys for Test Bench case/results encryption and tenant AI provider-secret encryption. Never paste material in chat, issue trackers, screenshots, logs, GitHub Actions outputs, or PR comments.
2. Store key identifiers, creation/recovery policies, escrow and key owners in the approved confidential secret-management system, **not Git**. Provision each secret independently to the correct Vercel environment using its encrypted/sensitive controls; never reuse `GIT_CREDENTIAL_ENCRYPTION_KEY` or carry production material into preview.
3. Require protected deployment approvals before any secret-bearing job runs. Avoid unreviewed PR code executing with live encryption material.
4. In the authorized isolated environment, invoke `node apps/web/scripts/check-managed-key-readiness.mjs`. It reports only key-name presence, canonical 32-byte shape, and that the two crypto domains have different material. A green result does **not** prove managed KMS, least privilege, versioned rotation, backup or runtime recovery. A failure blocks promotion.
5. Confirm server-only bundle boundaries and access policies, Auth0 service role scope and secure no-store responses. Verify all application read/write paths explicitly deny missing/malformed key and changed AEAD additional authenticated data.

## Required recovery and rotation drill (not completed)

1. Before any rotation, snapshot the isolated staging database and *separately* escrow its corresponding key versions under role-limited backup/restore policy. Restore into a second isolated staging instance. Verify existing AES-GCM v1 Test Bench definitions, observed run ciphertext and AI provider credentials can be decrypted using the original key and exact tenant/record AAD, while foreign tenant, tampered tag, wrong revision and wrong provider remain rejected. No plaintext or key dumps are acceptable as evidence.
2. PER-1550 must add authenticated v2 key-ID envelopes, previous-key read-only resolver, strict key-ID selection, and controlled key retirement for **both** domains. Old v1 ciphertext must read using an explicitly retained legacy key; all new writes must use the active key. Do not implement permissive retry-through-all-keys.
3. **Critical:** `testBenchRequestDigest` currently derives its keyed idempotency fingerprint from the Test Bench encryption key. Rotating the AES key changes this digest and can disrupt exact replay semantics. PER-1550 must keep the pre-rotation keyed digest stable for all unexpired run/create request IDs (or complete a separately reviewed transactional hash migration). Do not rotate by swapping the single existing environment variable.
4. Exercise v2 fresh encrypt/decrypt, old v1 read after active-key switch, v2 archived-key read, wrong/unknown/disabled key-ID denial, double-key removal denial, AAD tampering, recovery from backup+escrow, and safe rollback. Validate monitorable key version metadata without secret exposure.
5. Independent security approver confirms actual KMS metadata, backup provenance, tenant boundary, operational runbook, key separation, and staging Auth0 multi-browser readback. Then perform live authorized Test Bench and BYO OpenAI/Jev smoke, cancellation and revocation, and record only redacted immutable evidence.

## Acceptance and current limitations

PER-1551 unit tests exercise the **preflight** for missing, malformed, duplicate/equal, canonical-encoded and independent key material; they verify that results cannot contain key bytes. This is test-safe generated fixture material, never a production key. The manual CLI is intentionally **not** part of automatic PR CI because PR CI has no right to access protected live secrets. It performs no network request or secret write.

PER-1426 must stay open until both named Vercel environment entries actually exist for authorized environments, the v2 lifecycle and recovery have passed, independent security review is recorded, and authenticated staged Test Bench/BYO providers work. This runbook cannot substitute for any of those gates.
