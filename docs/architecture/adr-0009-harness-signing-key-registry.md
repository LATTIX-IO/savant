# ADR-0009 — Tenant-scoped harness signing-key registry (PER-1059)

**Status:** Private signing-key metadata and vault-binding increment; not a public credential-management API or production webhook.

## Decision

Savant verifies results from customer-owned AI harnesses, not a proprietary inference runtime. The new signing-key registry stores **only tenant-scoped vault references**, version, state, activation and expiry. HMAC key material is never stored in the database or serialized to an API response. The registry provides an injected `resolveSecrets(tenantId,adapterId)` callback compatible with ADR-0006's signed-event admission.

Migration `0018_harness_signing_key_registry.sql` defines `harness_adapter_signing_keys` with a tenant FK, unique tenant/adapter/version and vault reference, and **at most one active and one retiring** key per adapter. `secret_ref` is a strictly validated namespace `vault:<tenant-uuid>:<adapter-id>:<opaque-key-id>`; arbitrary URLs, cross-tenant references and raw secrets are invalid.

The private store `createHarnessSigningKeyRegistry` requires two injected trusted capabilities:
- `authorizeAdmin(tenantId,actor)`: must validate the authenticated session or signed management principal, membership, security-administrator role and action permission. Raw user-provided actor text is not authorization.
- `readSecret(tenantId,adapterId,ref)`: must use a trusted vault/KMS integration that enforces the same tenant/adapter binding, access control, key revocation and decrypted-secret handling. The registry intentionally contains **no** mock environment-variable fallback or public key-provisioning HTTP endpoint.

## Lifecycle and compatibility

`activate` requires admin authorization, an existing 32–128-byte vaulted signing secret, monotonic integer `key_version`, current activation and expiry no more than 180 days ahead. Rotation serializes on the organization row, revokes older retiring keys, promotes the current active key to `retiring` for a bounded overlap of at most 24 hours, and activates the next higher version in one transaction. Zero-overlap rotation revokes immediately; it does not rewrite expiry to an invalid value. Revoked versions cannot reactivate.

`resolveSecrets` fails closed when there is no current active key, when the scoped vault cannot read any required key, when key material is unsafe, or when active and retiring reference identical cryptographic material. It never returns a retiring-only key after active expiry or revocation. Retiring credentials are available only during their bounded overlap so external harnesses can migrate without interrupted validation. Calls to the signed event admission still use strict HMAC, timestamp, raw-body, tenant, run and adapter checks, and may then invoke the tenant-authorized event quarantine.

## Tests and threat controls

`apps/web/src/server/harness/signing-key-registry.test.ts` tests invalid tenant/adapter scope, fabricated admin, cross-tenant vault references, malformed version/rotation/expiry policy, missing or undersized secrets, and fail-before-DB denial.

`apps/web/scripts/verify-harness-signing-keys.mjs`, run in the existing PostgreSQL 16 CI service with `SAVANT_HARNESS_SCHEMA_TEST=1`, tests:
- Enforced administrator and scoped vault-reference authorization.
- Activation and monotonic version uniqueness; immutable records of revoked keys.
- HMAC event admission before, during and after overlapping key rotation.
- Failure after old-key grace expiry and explicit key revocation.
- Isolation from a second tenant, no raw key storage and FK cascade on tenant deletion.

Also require the repository's complete Node and Python unit/regression tests, `pnpm lint`, `pnpm typecheck`, `pnpm build`, committed-secret scanning, **blocking high/critical production dependency audit**, and migrations applied twice before independent review.

## Operational requirements and remaining work

A security owner must provision secrets into a real vault before registering their references. Deployments must configure mTLS or signed administrator authorization, rotation alerts, recovery on vault outage, telemetry for rejected signatures, and a tested key disable/rollback sequence. Monitoring should distinguish a missing active key from provider failure without reflecting the signing secret or raw event content. No key material may enter a log, an AI prompt, a download, or the Next.js client bundle.

This increment **does not** implement a live vault plugin, management HTTP endpoint, provider/harness onboarding, accepted traffic rate limiting, production signed webhook route, provider dispatch/cancel, evaluation scorecards, cross-provider smoke or rollout approval. PER-1059 and Savant MVP remain In Progress. Do not merge before the exact-head green CI and independent security review; do not enable real ingress before end-to-end vault-backed staging tests.
