# ADR-0015 — Tenant-owned, disabled-by-default harness status connector configuration

**Status:** Internal PER-1059 connector administration foundation. No public route, real vault driver, or live egress gateway is deployed by this increment.

## Decision

Savant remains a QA and observability service for **customer-supplied AI harnesses**. ADR-0014's signed status verifier requires an endpoint and scoped credential reference resolved from trusted tenant configuration. This increment supplies the PostgreSQL-backed configuration and admin lifecycle; it does not add inference routing, a proprietary harness or automatic reruns.

Migration `0022_harness_status_connector_configs.sql` adds one record per `(organization_id,adapter_id)` with endpoint, opaque vault reference, `disabled|active` status, monotonically increasing integer revision, and audit timestamps. No key material, prompt, model response, HMAC, token or full provider error is persisted. The database enforces a tenant-and-adapter-specific `vault:<organization UUID>:<adapter>:...` prefix and organization FK. New or edited configurations are always **disabled**.

The private `createHarnessStatusConnectorConfigStore` implements `save`, `activate`, `disable`, and trusted-internal `resolveActive`. Mutations require an **injected authenticated administrator decision**, not a caller-supplied actor string. All edits use expected-revision compare-and-swap, serialized under the organization lock so two administrators cannot silently overwrite or reactivate stale credentials. The returned admin metadata omits the vault reference. `resolveActive` is for the signed status connector only; it must not be published in a browser API.

## Trust and security boundaries

1. **Fixed endpoint:** Valid HTTPS, no credentials, no query/fragment, no nonstandard port, exact `/v1/savant/status` path, approved DNS hostname, and match to a **deployment-owned** exact origin allowlist. Reject loopback/IP literals, arbitrary redirects and arbitrary tenant URLs. This hostname restriction is a defense in depth, not a substitute for DNS/IP controls.
2. **Tenant-specific vault:** The `secret_ref` is namespace-bound to tenant and adapter. Save requires an injected vault attestation that the credential exists, but only stores the reference; activation rechecks that attestation. The verifier itself reads the credential just-in-time, not at configuration time. A revoked key still prevents a signed lookup.
3. **Egress policy activation:** Activation requires an injected `verifyEgress` that MUST confirm network gateway enforcement of TLS, private-address and metadata-IP denial, DNS/IP pinning and redirect rejection. If unavailable or denied, the connector remains disabled. Every active lookup rechecks current deployment origin and egress policy.
4. **No DB lock across remote attest:** Activation snapshots the candidate config, performs potentially slow vault/egress attestations **outside** the SQL transaction, then locks the authoritative organization and configuration row and rechecks the exact revision, endpoint, key reference and disabled status before enabling. Competing modifications return `version_conflict`.
5. **No implicit enablement:** Editing endpoint or vault reference resets status to disabled; explicit authorized activation is required for each revision. Disabling is independent of vault availability and changes the revision.

## Acceptance and tests

The fail-before-I/O unit/security suite verifies unauthorized administrator, malformed tenant/adapter scope, cross-tenant vault reference, denied or missing vault credential, malicious URLs/SSRF targets, invalid revisions and absent data.

The isolated PostgreSQL 16 integration asserts disabled-by-default insert, active lookup absence, explicit egress and vault attestation gating, competing administrative revisions, no DB lock during slow credential attestation, configuration mutation race denial, per-request egress rechecks, exact DB tenant/adapter vault namespace, cross-tenant denial, and cascade. It verifies an active configuration can be injected into ADR-0014's `resolveConnection` callback without browser-supplied URLs. Migration repeat application, Node and Python suites, lint, typecheck, production build, committed-secret scan and blocking high/critical production dependency audit remain required, followed by **independent security review**.

## Outstanding operational Definition of Done

No deployed vault/KMS resolver, enterprise workload identity authorizer, ingress/API for management, egress/DNS/TLS gateway proof, credential rotation runbook UAT, actual customer harness response signing, provider cancellation, verified final result ingestion or baseline/candidate scorecard generation is supplied in this increment. Enabling a tenant in this internal store does **not** automatically enable production connectivity; wiring to a deployed network transport must require separate reviewed rollout and real-harness smoke. On rollback, disable the connector while retaining revision history and durable dispatch evidence. PER-1059 and the Savant MVP remain In Progress.
