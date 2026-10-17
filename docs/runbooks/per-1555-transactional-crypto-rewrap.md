# PER-1555 — Controlled AEAD v1-to-v2 ciphertext rewrap and recovery qualification

Status: implementation and synthetic PostgreSQL acceptance only. This is not a production key rotation, a verified managed-key restore, or a release authorization.

## Security and operational boundary

The server-only managed-ciphertext-rewrap.ts exposes preview and rewrapNext to a trusted platform-crypto operator. It has no HTTP endpoint, public UI, tenant route, cron schedule or auto-deployment hook. The caller must authenticate a platform security operator in an independently reviewed, protected one-off maintenance job; a TypeScript role field by itself does not establish authentication. Production secret variables are not consulted by CI.

Each call targets **one explicitly supplied organization UUID, one target class, and 1–20 records maximum**. Supported targets:

1. Test Bench definitions — cases_ciphertext, bound to organization, definition ID, revision, and source SHA.
2. Test Bench runs — snapshot_ciphertext and results_ciphertext, bound to organization, run ID, definition revision and source SHA; both fields change in one row transaction.
3. BYO AI-connection secrets — encrypted_secret and key_version, bound to organization, connection ID and provider.

The service obtains a verified v2 current key identifier from PER-1550 with explicit v1 legacy escrow. An absent v2 ID, malformed catalog, missing original key, wrong AES-GCM AAD, provider fingerprint mismatch or decryption failure fails closed. Existing v2 ciphertext is never downgraded or rotated by this increment. A dedicated v2-to-v3 migration with proof of historical ID retention would be separate.

## Transaction and concurrency semantics

One call runs in one PostgreSQL transaction. Matching rows are selected in deterministic ID order with SELECT FOR UPDATE SKIP LOCKED. A strict compare-and-swap update retains the original row identity and ciphertext pre-image; in-process plaintext is verified via authenticated decrypt -> encrypt -> decrypt equivalence before the update is accepted. All relevant audit_events INSERT operations occur in the **same transaction**. If one row, audit write or AEAD check fails, the whole batch is rolled back. Retrying a successful or interrupted batch only targets remaining v1 envelopes. Separate tenant scopes are never coalesced in a shared transaction.

Audit evidence records target ID, operation batch ID, key ID, field names, old/new ciphertext SHA-256 and timestamps. It excludes raw ciphertext, plaintext, prompts and credentials. The existing audit_events table is not a cryptographic immutable ledger; retaining independent protected audit backups is a future compliance hardening task.

Rewrapping does **not** change source revision, request_digest, request ID, case count, provider fingerprints, scoring, quotas, provider usage receipts, reserved money, last credential rotation timestamp, run status, or historical source SHA. The HMAC remains derived from the original v1 key, which must not be retired during the lifetime of historical idempotency requests.

## Protected staging execution (NOT performed in this increment)

1. Apply and independently verify GitHub main branch governance PER-1455 and restrict the staging deployment environment to approved reviews at exact commit. Do not allow unreviewed PR code to execute with actual managed keys.
2. Obtain authorized KMS/HSM-backed distinct Test Bench and BYO encryption keys, including the **original v1 key**, and verify the key owner, access policies, rotation ID, escrow, restore rights and backup retention. Do not paste values into chat, PRs, artifacts or CI logs. Check protected Vercel staging scope and Auth0 before exposing any paid provider.
3. Take an encrypted, transactionally consistent staging database snapshot **before changing keys**, with independent encrypted key escrow. Restore this snapshot to a second isolated staging database; verify at least one pre-existing v1 definition, observed run snapshot/results and BYO provider credential can be read under their original AAD.
4. Start the reviewed versioned v2 server build with the new active key ID and the separate v1 legacy key. Require a protected operator credential, break-glass/incident contact, change ticket, and exclusive maintenance window. Disable or gate competing writes as needed. Run metadata-only preview for each authorized organization, review counts, and record counts in a restricted change ticket.
5. Execute only an explicitly authorized one-tenant one-target bounded rewrapNext batch at a time. Stop immediately on any sanitized error; do not retry with guessed keys. Verify the batch audit count and zero plaintext leakage. Continue until inventory is zero for the approved organization. Concurrent app writes are serialized by row locks and per-row CAS; SKIP LOCKED means a zero count in one batch is not proof that another writer has no outstanding records.
6. Verify signed/stored Test Bench request_digest and replay behavior, old AAD tenant denial, complete/canceled/run snapshot readback, BYO tenant isolation, provider revoke/reconnect workflow, and no changes to economic metrics or provider usage metadata. Independently verify that a fresh v2 write can be read after restart and from another application instance.
7. Re-run inventory when writers are quiescent. Retain old key versions until a formally approved exhaustive inventory and retention analysis permits retirement. Record scrubbed change IDs, before/after ciphertext hashes, KMS key version IDs, protected backup and restore identifiers and approvals.
8. Simulate failed/aborted batch, revoked key, interrupted application instance and a database restoration from the protected snapshot in a SECOND isolated staging environment. Confirm both legacy and newly committed v2 keys are available for the restore cutoff. Restore provenance must include all application secrets AND persisted database migration state; a code rollback to v1-only software after v2 writes will be unable to read v2 ciphertext. Roll back by restoring a consistent database+key+application trio, never by silently stripping envelope prefixes.

No automated script in this PR is allowed to read production secrets or perform staging/production migration. The only rewrap script is an opt-in **ephemeral loopback PostgreSQL test** with synthetic fixtures. No deployment mutation or actual database backup/restore occurred.

## Test-driven acceptance

- Unit: forged operator role/subject, invalid tenant UUID, unsupported data target, 0 or >20 batch size, missing v2 ID and missing original v1 escrow.
- Isolated PostgreSQL: create v1 definition, run snapshot/results and provider secrets for two tenants; select v1 inventory without decrypting; force a malformed second-row GCM tag to prove the entire earlier row+audit write is rolled back; then restore the fixture and race 12 competing resumable calls; assert exactly one rewrap/audit per row.
- Verify v2 authenticated readback, request_digest byte identity, revision/commit, quota/rates, provider fingerprint/key_version, unchanged last-modified/provenance fields, foreign organization unchanged, AAD tampering fails, account audit redaction and previous encrypted v1 image recoverable under the independently retained test key in an explicitly rolled-back synthetic restoration transaction.
- Existing predecessor Test Bench, AI credential, policy, invoice, concurrency and migration scripts remain blocking, with Node/TypeScript/lint/Next/build/dependency/secret scans plus Vercel preview.

## Residual prerequisites

PER-1426: actual KMS-backed managed provisioning and an approved independent staging backup/restore drill.
PER-1455: live verified branch ruleset and independent reviewer approvals.
PER-1552/PER-1553: genuine NVIDIA/TypeSafe account-specific entitlement, usage export and financial correlation evidence.
PER-1548: authenticated provider invoice matching and finance sign-off.

CI success and a READY Vercel preview do not establish any of these operational requirements.
