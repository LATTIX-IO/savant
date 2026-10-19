# PER-1556 — Recoverable staging and authorized SQL promotion

**Status: staging project provisioned, managed keys/database restore NOT proven.** This runbook and its source checks are not production release authorization.

## Live verified inventory — October 19, 2026

The production Vercel project is savant-web (prj_0IlFmCr7MplvLgD8C3sLKgazxXwl). The separately provisioned savant-staging project (prj_PkhjEr34pRKGKOVN2bFGzZGg2RMf) has project-wide SSO enabled and no Git connection, deployed app, database, identity integration, key material, custom environment, or environment variables. None of the production credentials was copied.

The Vercel team has an existing Neon marketplace integration. The connected tools cannot provision or attach a Neon database, and the local Neon CLI lacks an authenticated profile. Vercel KMS issuer listing returned HTTP 403; a Vercel KMS signing issuer is not a substitute for managed AES data-encryption key recovery. Repository GitHub rulesets are not yet live, notwithstanding the merged PER-1572 bootstrap.

## Physical resources to provision

1. Through the existing authenticated Neon integration, create a new, isolated staging PostgreSQL project, NOT a branch containing production data. Provision a direct TLS endpoint for migration/dump and pooled connection for app traffic. Record only nonsecret project/endpoint IDs and a restore retention policy.
2. Provision a second separate restore database with a distinct compute endpoint, database identity and restricted recovery role. Do not connect it to the production database or use production records.
3. Configure a distinct staging Auth0 tenant/application with separate client credentials, callback URLs for the SSO-protected stage deployment and two synthetic test organizations. No production session secrets or test customers.
4. Provision distinct Test Bench and BYO AI 32-byte active AES-256-GCM data keys and version identifiers using an approved managed KMS/key custody arrangement, plus actual legacy v1 key escrow only where historical v1 ciphertext exists. The application currently consumes key bytes; storing bytes as Vercel sensitive environment variables does NOT independently prove recoverable KMS custody. Never reuse GIT_CREDENTIAL_ENCRYPTION_KEY.
5. Bind only staging credentials to savant-staging. Production credentials stay in savant-web. Grant no unreviewed PR/fork access. Do not activate a protected cryptographic maintenance workflow until the owner-operated GitHub rulesets are actually enforced.

## Real encrypted backup and isolated restore

Populate the source staging database with synthetic v1 and v2 Test Bench definitions, archived revisions, queued/results receipts, BYO provider credential fixtures, tenant isolation fixtures and idempotency HMAC evidence.

Create a transactionally consistent PostgreSQL custom-format backup using a **direct/unpooled** connection and stream the bytes into an approved authenticated encryption utility (for example age with a protected recovery recipient). Do not persist a plaintext dump, include database URLs in logs, or generate any production backup here. Preserve backup object ID, ciphertext SHA-256, timestamp and protected recipient key ID.

Restore through the actual approved key-unwrapping/decryption path into a **different** isolated staging database via pg_restore. Verify the archive digest, both legacy/current managed key versions, decrypted v1 and v2 Test Bench and BYO AI ciphertext, archived AAD revision, preserved request HMAC/idempotency, data lineage, tenant-denial and audit records. Execute negative cases for wrong backup key, mutated ciphertext, missing legacy key, foreign-tenant access, replay, and interrupted bounded rewrap followed by DB + keys + app rollback. Do not roll back v2 ciphertext onto a v1-only application.

The existing verify-ephemeral-db-backup-restore.mjs script proves **synthetic loopback CI only**; it cannot count as real cloud/KMS disaster recovery.

## Short-lived, operator-signed staging DDL receipt

The new schema-apply-authorization.mjs module is an additional DDL safety interlock. The existing db:migrate entrypoint now refuses remote database targets by default and always refuses Vercel production builds and the savant-web production project. Its CI exception is restricted to the explicit SAVANT_WORKFLOW_SCHEMA_TEST=1 loopback database called savant, accessed as role savant. A non-loopback stage database requires a separately signed receipt and an exact operator confirmation.

After physical recovery has been witnessed, create a JSON envelope with exactly the fields payload and signature. The signature is an 86-character canonical base64url Ed25519 signature over UTF-8 JSON.stringify(payload). Use a separately protected operator evidence-signing private key and place its public verification key in a different protected path; neither is a Test Bench AES key nor managed KMS recovery evidence.

Payload schema: savant.staging-recovery-acceptance.v1.
Issuer: savant-owner-staging-recovery.
Required values: stageProjectId, sourceCommitSha (40-character pinned source commit), targetDatabaseHost, targetDatabaseName, restoredDatabaseHost, restoredDatabaseName (distinct target), backupId, restoreId, testBenchKeyIds {legacy,active}, aiConnectionKeyIds {legacy,active}, evidenceDigest (64-character SHA-256 of actual provider/backup acceptance evidence), issuedAt and expiresAt as epoch milliseconds. Receipt validity is at most 24 hours.

The payload checks object has precisely these nine booleans, all true **only after actual tests**:

- encryptedFullPgRestore
- managedLegacyAndActiveKeyRestore
- testBenchV1V2Decryption
- aiConnectionV1V2Decryption
- requestHmacUnchanged
- tenantIsolation
- wrongKeyDenied
- replayDenied
- rollbackReady

Do not create or sign affirmative receipts from synthetic tests. A valid owner signature proves authorization of the asserted evidence; it does NOT independently query a provider, attest KMS key existence, or verify the backing archive. Retain real provider audit references separately in Linear with secrets redacted.

## Approved operator migration context

Run the schema tool ONLY on an authorized machine after real restore evidence is validated. The operator supplies these environment variables securely:

| Variable | Required value |
|---|---|
| DATABASE_URL_UNPOOLED | Direct TLS PostgreSQL URI for *new staging source* |
| SAVANT_SCHEMA_APPLY_TARGET | staging |
| SAVANT_STAGING_VERCEL_PROJECT_ID | prj_PkhjEr34pRKGKOVN2bFGzZGg2RMf |
| SAVANT_SCHEMA_EXACT_MAIN_SHA | Exact 40-character reviewed source SHA |
| SAVANT_STAGING_RECOVERY_RECEIPT_FILE | Local path to protected short-lived signed receipt |
| SAVANT_STAGING_RECOVERY_TRUST_KEY_FILE | Local path to separately protected Ed25519 public key |

Then run:

    pnpm --filter @savant/web exec node ./scripts/apply-db-schema.mjs --confirm=APPLY-SAVANT-STAGING-SCHEMA

The target URL must identify the DB host/name in the signed receipt and use TLS with sslmode=require, verify-ca or verify-full. The receipt must identify a separate restored DB, key version IDs for both domains, all nine recovery results and the exact code SHA. No staging database, managed keys or signed restoration receipt currently exist, so this command must **fail closed** in the present infrastructure. No production DDL is authorized by this procedure.

## PER-1421 acceptance after staging

After an actually restored, authenticated and migrated staging system exists, execute a real baseline/candidate Test Bench run for two synthetic organizations with an approved tenant-owned provider/harness. Record pinned skill/rubric revisions, source commit SHA, case digests, observed per-case results, token usage, provider cost source, retries, replay controls, candidate delta and a reviewed improvement proposal. Actual provider invoices and settled amounts must remain distinct from estimates. Deny foreign-tenant evidence reads.

## DoD and next operator boundary

PER-1556 is only complete after real staging DB/KMS/identity provisioning, independently isolated encrypted database + key restore, bounded maintenance and rollback acceptance, authorization and provider audit evidence, and authenticated staging API checks. Source guards and the Vercel shell project are partial progress only. External admin actions needed: activate GitHub rulesets, provision Neon database(s), configure separate staging Auth0, and provide actual managed KMS key custody. Do not substitute temporary claimable Neon projects, simulated KMS, or production-secret copies.

Related: PER-1556, PER-1572, PER-1421.
