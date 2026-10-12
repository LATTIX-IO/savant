# ADR-0016 — Azure Key Vault HMAC credential resolver for customer harnesses

**Status:** Internal concrete Azure Key Vault REST integration (PER-1059); not a production-deployed managed-identity service or egress gateway.

## Context and decision

Savant is a QA platform for user-supplied AI harnesses. Its previous status connector used an injected vault reader but had no implementation capable of retrieving the real signing secret. This increment adds a concrete Azure Key Vault version-pinned secret reader and exposes the same `readSecret(tenantId,adapterId,secretRef)` and `attestSecret` interfaces already used by the tenant-owned connector store and authenticated status lookup.

A canonical reference is `vault:<tenant-uuid>:<adapter-id>:<alias>.<32-character lowercase secret version>`. The resolver **requires** this form. It derives an Azure Key Vault-compatible opaque secret name using SHA-256 over a versioned namespace containing tenant UUID, adapter ID and alias; the exact secret **version** is specified in a REST GET to `https://<configured-vault-name>.vault.azure.net/secrets/<derived-name>/<version>?api-version=7.4`. The vault host is a deployment-configured and strictly validated Azure vault name, never a tenant-supplied hostname or arbitrary URL. Pinned versions avoid silently replacing a trusted HMAC key after admin approval.

Authentication is supplied by a **trusted injected managed identity or workload identity token provider**, not a raw browser bearer token, environment-variable secret fallback or tenant preference. The transport is an injected deployment-owned HTTPS client and **MUST enforce a network-layer DNS/IP egress allowlist and TLS identity validation** for the configured `.vault.azure.net` endpoint. Restrict Azure role permissions to read only the authorized secret versions and deny management-plane operations. The resolver never creates, updates, logs or returns a Key Vault access token.

The response must be HTTP 200 JSON, at most 4096 bytes, with the expected exact Key Vault secret version ID, the Savant-specific content type `application/vnd.savant.harness-hmac.base64url`, an explicitly enabled secret, unexpired `exp` and nonfuture `nbf` when present. The value must be canonical base64url decoding to **32–128 bytes**; malformed, revoked, disabled, unversioned, expired, or cross-tenant data fail closed. Calls have a hard 100–5000ms timeout even if a faulty transport ignores AbortSignal; redirects are forbidden. Raw errors, token material and response content are not reflected to application clients.

`attestSecret` resolves only the pinned secret and zeroes the returned buffer; it does **not** log or persist key contents. The actual HMAC verifier reads current version-pinned material on demand and likewise destroys its private copy. No payload contents are put in PostgreSQL.

## Required tests

- Unit/security: original tenant namespace, exact pinned secret name/version, valid Key Vault response, revoked/disabled/future/expired/version-spoofed secrets, malformed and overlong base64url, token-source outage, hostile vault hostname, timeout/hung transport, unauthorized key reference, bounded response and no unintended network use.
- Isolated PostgreSQL integration: save disabled tenant-specific connector configuration, attestation against the Key Vault REST protocol, explicit egress-gated activation, just-in-time HMAC retrieval, signed request/reply with original persisted idempotency key, immutable metadata-only reconciliation receipt, tenant isolation, revoked secret blocks further network dispatch and cascade.
- Existing CI gates: full Node/Python tests, lint, TypeScript, production build, committed-secret scanning, **blocking production dependency audit**, all PostgreSQL migrations applied twice and earlier tenant/dispatch/event-regression suites.
- Independent security reviewer and supervised Azure workload-identity, Key Vault RBAC, network egress and customer-harness signing conformance must pass **before** production enablement.

## Deployment, credential creation and gaps

Provision version-pinned HMAC secret values as canonical base64url and set Key Vault content type and expiry explicitly. Provisioning tooling needs to compute the exact derived name, retain the version ID in the tenant's opaque reference, and never disclose or commit secret bytes. The workload identity must have least-privilege Key Vault secret-get permissions. Rollback disables the connector, preserves dispatch/reconciliation evidence and leaves revoked secrets inaccessible.

This increment does **not** implement an Azure managed/workload identity token acquisition driver, Key Vault secret provisioning or RBAC assignment, a real DNS/IP-pinned HTTP agent, a management API, production background worker, provider cancellation, signed final result ingestion or scorecard. Integration uses a mocked network and a local PostgreSQL 16 service. **PER-1059 and the Savant MVP remain In Progress.** Do not treat green mocked integration as production vault/UAT acceptance.
