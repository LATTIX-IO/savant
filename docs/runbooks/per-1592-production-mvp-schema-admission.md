# PER-1592 — Single-owner production MVP schema admission

**Status:** Source authorization only; this PR has performed no live DDL, provider snapshot or restore. No automatic production migration is enabled.

## Operating policy

Savant has one maintainer and no customer users. Permit authenticated production synthetic-tenant MVP acceptance, retaining Auth0, tenant boundaries, CSRF, quotas, observed run/cost provenance and protected cryptographic material. PER-1556/PER-1589's separate staging/KMS disaster-recovery rehearsal is postponed until after the pilot. It is not being marked complete.

The production project is savant-web, Vercel ID prj_0IlFmCr7MplvLgD8C3sLKgazxXwl. This pilot MUST NOT re-enable Vercel build-time migration or expose remotely callable DDL. The existing production deployment should remain rollback-eligible.

## Physical recovery prerequisites (outside this PR)

1. From an authenticated Neon account, identify the real production Neon project ID and its direct (non-pooled) PostgreSQL endpoint; do not copy database passwords into chat, Git or Linear.
2. Create and retain a provider-backed recovery point of the CURRENT production database. Capture its resource ID, timestamp and actual retention period.
3. Restore from that recovery point to a distinct Neon branch/compute endpoint and verify the historical schema, tenant data, and availability of a compatible application revision. Record only nonsecret evidence, the restored branch ID and its hostname. Synthetic CI pg_restore is insufficient.
4. Test application of exactly schema versions 0015 through 0035 on the restored branch; check DDL errors and lock behavior before applying them in production. The source script is not an atomic migration framework; failure midway may need manual recovery.
5. Write a redacted recovery acceptance report, compute its SHA-256 and record the real provider recovery/restore IDs. Independently check there are no customer accounts or real-customer payloads in the pilot.
6. On a trusted operator workstation, sign the evidence with a protected, distinct Ed25519 private key. Store the signed receipt and public trust key outside the repository. Never fake positive restoration claims or reuse AES encryption material for signing.

## Signed production receipt

The JSON envelope has exactly two properties: payload and signature. The signature is canonical 86-character base64url Ed25519 over UTF-8 JSON.stringify(payload).

Payload fields required:
- schema: savant.production-mvp-schema-recovery.v1
- issuer: savant-owner-production-mvp
- repository: LATTIX-IO/savant
- vercelProjectId: prj_0IlFmCr7MplvLgD8C3sLKgazxXwl
- neonProjectId: actual production Neon project ID
- sourceCommitSha: exact 40-character, reviewed source SHA
- targetDatabaseHost, targetDatabaseName, targetDatabaseRole: direct TLS production PostgreSQL identity
- recoveryPointId: existing provider recovery point ID
- restoredBranchId and restoredDatabaseHost: verified restore target, distinct from production
- evidenceDigest: SHA-256 hex of redacted provider/restore report
- issuedAt and expiresAt: Unix milliseconds, maximum validity 30 minutes
- checks: exactly four booleans, all true only after observed physical evidence: productionRecoveryPointVerified, restoreOnDistinctComputeVerified, rollbackRevisionVerified, syntheticTenantScopeVerified.

The signer authorizes reported evidence; a cryptographic signature is NOT independent Neon proof. Evidence must be verified with the provider outside the source-code validator.

## Operator-only schema command

Securely configure the actual direct URL in DATABASE_URL_UNPOOLED, with PostgreSQL TLS and NO pooler; the app still uses its normal pooled URL. The local operator process must set the following nonsecret context variables:

- SAVANT_SCHEMA_APPLY_TARGET=production-mvp
- SAVANT_PRODUCTION_VERCEL_PROJECT_ID=prj_0IlFmCr7MplvLgD8C3sLKgazxXwl
- SAVANT_PRODUCTION_NEON_PROJECT_ID=<verified Neon project ID>
- SAVANT_SCHEMA_EXACT_MAIN_SHA=<exact source SHA>
- SAVANT_PRODUCTION_RECOVERY_RECEIPT_FILE=<protected local JSON path>
- SAVANT_PRODUCTION_RECOVERY_TRUST_KEY_FILE=<protected local Ed25519 public PEM path>

Use a trusted local workstation in an exclusive change window; not CI, Vercel, a public endpoint or a PR workflow. The two arguments are mandatory and exact:

    pnpm --filter @savant/web exec node ./scripts/apply-db-schema.mjs --only=0015,0016,0017,0018,0019,0020,0021,0022,0023,0024,0025,0026,0027,0028,0029,0030,0031,0032,0033,0034,0035 --confirm=APPLY-SAVANT-PRODUCTION-MVP-SCHEMA

The executor validates the signed receipt, exact commit/project/host/database/principal, no privileged role, TLS direct connection, all 21 reviewed schema prefixes, non-Vercel/non-CI context and 30-minute freshness **before running DDL**. It cannot guarantee the reported Neon recovery point really exists; only the operator/provider audit can.

## Live Test Bench acceptance

After schema activation, provision two distinct 32-byte Test Bench and BYO AI AES keys into Vercel sensitive production configuration; record independently recoverable escrow/version IDs. Do not reuse GIT_CREDENTIAL_ENCRYPTION_KEY. Preserve any historical BYO/Test Bench ciphertext key/HMAC if existing rows are found. Validate shapes and actual encrypted synthetic record restore. Run one authenticated owner account in two different synthetic organization contexts and test cross-tenant denials.

Execute saved Test Bench definition, bounded provider run, observed receipts, baseline/candidate comparison, retry and cancellation, real measured provider usage/cost source and a reviewed improvement proposal. No fabricated results or invoices.

Record source SHA, production deployment, nonsecret DB/backup evidence, negative outcomes and rollback proof. If any migration fails, stop and restore a compatible application+database+key state from the recovery point; do not automatically repeat DDL or destroy data. UI PRs #66/#73 are excluded.
