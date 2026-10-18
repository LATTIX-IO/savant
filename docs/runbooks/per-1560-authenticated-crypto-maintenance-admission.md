# PER-1560-A — Verified crypto-maintenance admission (nonproduction implementation)

## Safety boundary

This increment adds *server-only* GitHub Actions workload identity verification, separately signed operator authorization, durable PostgreSQL replay fencing and a controlled invocation seam around the existing PER-1555 transactional rewrapper. It does not install a running endpoint, create a scheduler, publish a release, provision KMS, expose encryption material to a GitHub job, or trigger any real database rewrite. The executor cannot be used for live staging until authenticated trust roots, a restricted principal, a reviewer-protected workflow and independently witnessed backup/key recovery are provided.

A TypeScript \`{scope:"platform-crypto-operator"}\` object **is not authentication**. Only \`verifyGithubMaintenanceJwt\` from authenticated issuer JWKS, followed by \`verifySignedMaintenanceApproval\` from a separate pinned Ed25519 reviewer key, can create the permit passed to the service. The production deployment must supply trust keys and the exact numeric reviewer identity bound to the pinned Ed25519 public key from an independent, authenticated, privileged configuration. The signed reviewerId MUST match the key owner; signed claims alone cannot assert who holds an unbound key. Never use JWKS, approver keys, an "admin" boolean or backup claims taken from a tenant request, Git commit, PR payload or untrusted job artifact.

## Identity acceptance contract

- JWT signed by GitHub Actions' trusted issuer with RSA-SHA256 and an exact trusted, unique signing-key ID. Reject \`none\`, HMAC downgrade, JWT-carried JWK/JWKS URL, header extensions and noncanonical encoding.
- Mandatory exact issuer \`https://token.actions.githubusercontent.com\`, audience \`api://savant-crypto-maintenance\`, repository \`LATTIX-IO/savant\`, verified *numeric* repository ID, subject \`repo:LATTIX-IO/savant:environment:savant-crypto-maintenance\`, protected \`refs/heads/main\`, and \`workflow_ref=LATTIX-IO/savant/.github/workflows/crypto-maintenance.yml@refs/heads/main\`.
- Match the exact independent, protected-main GitHub commit SHA, event \`workflow_dispatch\`, signed actor ID, workflow run ID and attempt. Expired, future, overly long-lived or stale assertions are rejected. A bare JWT payload or caller-provided role never qualifies.
- Distinct Ed25519 reviewer signs one canonical fixed-field approval: UUID approval and tenant, exact target, 1–20 rows, active KMS key version ID, independently restored encrypted backup ID/hash, change ticket, reviewer ID distinct from signed runner actor, run ID/attempt, exact main SHA and <=15-minute approval window. The signature covers **all** parameters.
- The executor calls three independent privileged verifiers *before DB write*: real encrypted backup was restored and validated; short-lived least-privilege tenant database principal is active; correct active and legacy KMS key versions are available. Missing, delayed, rejected or revoked evidence blocks admission.

## Durable replay and audit

Migration \`0035_crypto_maintenance_operations.sql\` stores the signature-verified approval digest, exact operator/reviewer/workflow identity, immutable tenant/target/key/backup reference, and state. Unique approval ID, unique GitHub run ID+attempt and an active/uncertain per-tenant-target unique index block replay, concurrent runs and blind retries. A PostgreSQL trigger forbids changing signed authority or rewinding from \`completed\` or \`uncertain\`. State transitions are \`admitted -> running -> completed\` or \`admitted/running -> uncertain\`; uncertain requires a new external change-control process, not automatic retry. Transactionally paired \`audit_events\` contain redacted metadata and approval/backup hashes only, never signed bearer assertions, KMS keys, ciphertext, approval signatures or raw error text.

The executor calls the existing rewrap service only **after** an authenticated admission and durable start marker. If the rewrap or completion response is uncertain, it records an unretryable hold. Unlike a perfect distributed transaction, this does not prove DB rewrap and outcome audit are atomic across separately committed operations; manual reconciliation is required for ambiguous outcomes. Do not automatically resubmit the same change ticket.

## Required follow-on before any real staging execution

1. Complete GitHub ruleset and independent approval PER-1455, with standalone immutable SHA-pinned dependency-audit check PER-1558 and staged security stack reviewed/merged.
2. Configure reviewer-protected \`savant-crypto-maintenance\` **environment** restricted to main. Install a dedicated, minimal \`workflow_dispatch\` under \`.github/workflows/crypto-maintenance.yml\`, protected against unreviewed PR code, using verified short-lived GitHub OIDC federation and no long-lived secrets. **This workflow is not yet created or enabled** by this PR. A matching protected ref is a required verified identity claim, not evidence of current configuration.
3. Bind issuer JWKS retrieval to TLS-verified GitHub issuer and validated issuer metadata, with bounded timeouts and rotation policy. Provision the independent approver's protected Ed25519 public key and key lifecycle; obtain the approval through a distinct person or protected approval service.
4. Provision real managed active/legacy Test Bench and BYO AI keys, enforce an approved tenant-scoped KMS/DB identity, and implement adapters for *actual restored* backup attestation, key verification and internal rewrap invocation. The code deliberately has **no default adapter** or fallback to ambient process environment secrets.
5. Independently restore a managed encrypted backup plus all necessary historical key versions into a separate protected staging database; perform authenticated multi-tenant negative tests and replay HMAC acceptance, then only a bounded witnessed 1–20-row maintenance attempt. Record sanitized operation ID and attestations in Linear. External vendor billing evidence remains separate.

## Synthetic TDD

\`node --test --experimental-strip-types apps/web/src/server/security/crypto-maintenance-authorization.test.ts apps/web/src/server/security/crypto-maintenance-executor.test.ts\`

The PostgreSQL 16 CI job applies migrations twice, then runs \`apps/web/scripts/verify-crypto-maintenance-admission.mjs\` only with \`CI=true\`, \`SAVANT_CRYPTO_MAINTENANCE_DB_TEST=1\`, \`SAVANT_WORKFLOW_SCHEMA_TEST=1\`, and disposable \`postgresql://savant@127.0.0.1:5432/savant\` with synthetic \`PGPASSWORD=integration_only\`. It tests replay uniqueness, active/uncertain contention, immutable trigger, authorized transitions, improper result denial and redacted audit events. This proves local rules, not real GitHub environment protection or KMS ownership.

PR remains draft pending independent review and operational gate completion. Never claim that synthetic signed fixtures represent real release approvers, original v1 keys or staging backup evidence.
