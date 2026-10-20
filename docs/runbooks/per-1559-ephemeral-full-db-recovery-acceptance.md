# PER-1559 — Encrypted full-database restoration acceptance

## Objective and evidence boundary

This is an **ephemeral synthetic integration test** for the operational readiness scope PER-1556. It extends PER-1555's SQL transaction-rollback proof to whole PostgreSQL backups with authenticated archive encryption. It does not provision or attest actual managed keys, create a Vercel staging environment, access a real tenant database, or establish a production RTO/RPO.

The test is deliberately restricted to a GitHub Actions disposable PostgreSQL 16 service: localhost/127.0.0.1, port 5432, database and user `savant`, exactly the synthetic CI password `integration_only`, explicit workflow flags and `CI=true`. It cannot point at a remote DNS host, named production database, different user, or URL with embedded credentials. The Node process never reads a production secret or external KMS. It requires `pg_dump`, `pg_restore`, `createdb` and `dropdb` in the runner.

## Steps checked by the blocking workflow

1. Apply the existing versioned-crypto migration schema twice and complete all predecessor PER-1550/1555 PostgreSQL crypto tests.
2. Seed original v1 AES-GCM Test Bench active and archived definitions, frozen provider run snapshots/results, an AI connection secret and a foreign tenant's secret. Preserve original request_digest, source SHA, credential fingerprint, run status, token/rate metadata.
3. Capture a transactionally consistent custom-format *full* `pg_dump`. The raw output is never stored as a plaintext archive on disk; a fresh synthetic 32-byte backup key encrypts it with AES-256-GCM and a domain-separating authenticated envelope in a private temporary directory. Output bytes are hash-checked before decrypt. The test refuses remote connections, wrong backup key, corrupted envelope or an archive exceeding the strict fixture size bound.
4. Run the reviewed tenant-scoped v1→v2 rewrap for definitions, observed runs and BYO secret on the ephemeral source database. Assert foreign tenant v1 evidence unchanged. Capture a **second** independently encrypted database dump after the committed migration.
5. Create two distinct fresh temporary PostgreSQL databases, restoring each full encrypted archive through `pg_restore` via process stdin (no unencrypted dump file). Verify original/rewrapped AAD, archived legacy revision handling, frozen run evidence, AI credential fingerprints, one and only one migration audit per source row, cross-tenant refusal, unchanged request replay digest, and identical request-ID replay on both generations.
6. Close restored connections, drop temporary databases, securely clean temporary backup files, and erase the randomly generated *test-only* archive key from process memory. No backup artifacts, plaintext prompts or synthetic credentials are uploaded or printed.

CI evidence proves the restore logic works against synthetic, ephemeral PostgreSQL. It is **not** a key-escrow or cloud disaster-recovery rehearsal. The CI-controlled backup envelope must not be reused as a production backup implementation without independent review of lifecycle, key management, AAD, retention, snapshot consistency, data volumes, audit durability and backup access controls.

## Operational staging qualification still required

PER-1556 remains blocked until GitHub PER-1455 main ruleset and independent review are enforced, protected staging is provisioned, and original v1 and active/previous v2 key versions are escrowed under a managed KMS/HSM lifecycle. The operator must take a managed encrypted backup of the **real protected staging** dataset and independently restore both database and managed keys to a different isolated environment. Verify actual users, Auth0 organizations, stored Test Bench/AI secrets and request HMACs; never paste secret values into Linear, GitHub or CI logs.

The original Test Bench key is retained for v1 decryption and *request fingerprint HMAC* indefinitely until an independently approved transition ensures all historical request IDs remain replay-safe. A rollback must restore a compatible app+schema+database+key set. Reverting to v1-only app code after v2 writes is not an acceptable rollback.

No real provider usage or commercial billing reconciliation is inferred from this test. NVIDIA and TypeSafe account-specific evidence remains PER-1552/1553.

### Manual CI reproducer

Run only in a disposable local PostgreSQL service matching the exact integration guards, with dedicated test-only data and no production-connected secret manager. After applying all schema migrations, set `SAVANT_WORKFLOW_SCHEMA_TEST=1`, `SAVANT_EPHEMERAL_RESTORE_TEST=1`, `CI=true`, `DATABASE_URL=postgresql://savant@127.0.0.1:5432/savant`, and the synthetic `PGPASSWORD=integration_only`. Then run:

```sh
node --test apps/web/scripts/ephemeral-encrypted-pg-archive.test.mjs
pnpm --filter @savant/web exec node ./scripts/verify-ephemeral-db-backup-restore.mjs
```

Failure of any PG CLI operation, synthetic AES-GCM verification, data consistency, tenant denial or cleanup must block the PR. No automatic retry or production fallback exists.
