# ADR-0014 — Signed customer-harness status connector (PER-1059)

**Status:** Private, injectable HTTPS connector for manually authorized read-only reconciliation. NOT a deployed HTTP endpoint, autonomous worker, producer of authoritative completion events, or generic inference gateway.

## Decision

Existing `createHarnessProviderReconciliation` holds uncertain customer-harness execution and only records authenticated, metadata-only provider evidence. The connector `createSignedHarnessStatusLookup` now supplies a concrete provider verifier to that trusted callback without putting secrets, prompts, model/tool payloads, or credentials in the application database.

A trusted tenant+adapter connector binding returns `https://<admin-approved-origin>/v1/savant/status` and a `vault:<tenant>:<adapter>:<key-id>` reference. The origin must match a **deployment-owned exact-origin allowlist**, use HTTPS port 443, have no query, fragment, username, password, IP literal, localhost, or arbitrary path. A scoped injected vault resolver retrieves 32–128-byte signing-key material at invocation time. Keys are never logged or returned, and the local copy is zeroed after transport.

The client emits a metadata-only POST with tenant, adapter, run, original immutable idempotency key and trace. It authenticates the request with a time-bound nonce and HMAC-SHA256 over exact bytes, and asks for a response bound to the same timestamp, nonce, tenant, adapter and run. It accepts only HTTP 200 JSON, with a constant-time HMAC comparison of exact returned bytes. Response bodies are bounded to 4 KiB while streaming; a request deadline is capped at five seconds and includes transports that ignore AbortSignal. The strictly validated response is limited to tenant, adapter, run, idempotency key and one of `accepted`, `not_found`, `unknown`. A SHA-256 digest of verified raw bytes becomes the evidence fingerprint. No external error text, raw body, or provider-specific user content escapes the connector.

### Critical trust boundaries

The endpoint and key reference must come from an **authenticated tenant-owned configuration resolver**, not from an arbitrary caller/body. A static hostname allowlist is not sufficient protection from DNS rebinding or compromised egress: the production deployment **must also enforce DNS/IP egress pinning, TLS certificate validation, no redirects and a private-network deny policy** at its network gateway. `transport` must be the server's approved outbound HTTP client with those controls; connecting arbitrary URLs from the tenant is prohibited.

The provider must understand request/response HMAC framing:
`savant-harness-status-request-v1\n<timestamp>\n<nonce>\n<tenant>\n<adapter>\n<run>\n<raw JSON>`
and `savant-harness-status-response-v1` with the same framing. The service must validate nonce/time, prevent replay within its signing window, and never return raw prompts or tool output. A shared secret must be distinct from web session tokens, bounded to the single tenant/adapter and rotated through a tested vault process.

This is intentionally separate from full `HarnessRunEvent` receipt signatures. A provider's `not_found` is not proof of non-execution; no return value authorizes automatic retry, completion, refund, or cancellation. Evidence must pass through `createHarnessProviderReconciliation`, which rechecks the held lease under DB run-before-lease locking.

## Verification and release gates

Unit, regression and adversarial security tests cover valid request/response MAC, exact nonce binding, forged/mismatched tenant, invalid scope, SSRF URLs, blocked redirects, unacceptable vault keys, absent signer, invalid or overlong response, provider error sanitization, and non-cooperative timeout. Existing PostgreSQL reconciliation integration validates tenant/run/idempotency evidence, replay conflicts, foreign tenant FK denial, hold-after-expiry, stale lookup and cascade. CI still requires Node and Python tests, lint, typecheck, production build, secret scan, blocking production dependency audit and twice-applied migrations at the exact PR head. Independent security review remains mandatory.

## Remaining operational DoD

**Not delivered:** persisted tenant connector administration UI/API, deployed vault/KMS integration, egress gateway enforcement, TLS/mTLS identity pinning and live customer harness conformance, provider cancellation, signed final result attestation, cost settlement, or evaluation baseline/candidate scorecards. Deploy in disabled mode until secure connector configuration, outbound egress and provider integration are proven. On a provider outage, preserve `dispatching`/`reconciliation` holds rather than requeue. PER-1059 and Savant MVP remain In Progress.
