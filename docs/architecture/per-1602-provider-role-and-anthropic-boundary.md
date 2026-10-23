# PER-1602 — Provider role admission and Anthropic transport

Status: bounded backend foundation, October 22, 2026. Not a live provider connection. Based on main commit 32d4f43536d737222165b51238edbe184486942f.

## Implemented

1. Explicit roles: evaluation-executor, evaluation-judge and production-serving. Existing ai_connections supports_execution and supports_judging booleans and free-text purpose/default flags NEVER create a new role grant.
2. Pure server-side admission contract checks the authoritative actor, organization, specific connection, provider, model allowlist, credential mode, key version, fingerprint, explicit role grant, verification/expiry, pricing revision, billing owner, and positive per-call token and estimated USD limits. Absent grant fails closed.
3. Native Anthropic Messages transport: fixed HTTPS endpoint and pinned stable API version 2023-06-01. Only system + user text, no tools, extra body, redirects, custom URL, or browser/consumer subscription tokens. One HTTP attempt; bounded latency and response size.
4. Native usage accounting preserves cache creation/read input tokens and output tokens when the provider reports them. Invalid, partial or tool outputs never count as a successful evaluation; evidence mode may preserve valid usage only.
5. A role-bound Anthropic adapter reloads authoritative actor, connection and grant before EACH provider request. It re-hashes the exact decrypted API key and compares the digest in constant time to the pinned fingerprint. Revocation, cross-tenant data, changed model/key or failed store load stops before egress. Store errors are sanitized.

## Deliberately not activated

No server route or existing Test Bench worker currently constructs the new Anthropic adapter. No database schema, encrypted provider key, production-serving default, new OAuth flow, provider-side skill publication, Copilot runtime or compliance importer was changed. The code is not live and creates no billable calls.

## Remaining security and delivery gates

- PER-1592: isolated database/key restore and recoverable managed encryption-key versions BEFORE auto-applied schema changes or production activation.
- PER-1602: independently persisted administrator-approved grant/bindings and versioned credentials; authoritative DB loader and authenticated tenant group recheck; invoke across OpenAI and Anthropic; judge/production independent credentials.
- PER-1602: durable concurrency-safe cumulative run and organization quota reservations, not merely this increment's single-call estimated cost guard. Verify real usage and configured pricing revision separately from invoice amounts.
- PER-1603: supported vendor-specific enrollment only after eligibility; no harvesting Claude Code or ChatGPT subscription tokens.
- PER-693: provider-native governed skill publishing and drift detection; PER-982: separately consented telemetry and provenance; PER-1421: real Test Bench usage, receipt and cost acceptance.

Copilot Graph administrative interaction export does not authorize model inference, and provider-admin consent is distinct from user account authorization. First deployed version must enforce scopes per tenant and actor, not assume a provider-wide supergrant.

Validation is in docs/evidence/per-1602-isolated-2026-10-22.md. Local isolated tests do not establish the exact-head full-repository build, production compatibility or live provider acceptance.
