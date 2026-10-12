# ADR-0003: Customer-owned harness adapter protocol v1 (PER-1057)

**Status:** Proposed reference boundary, not a production invocation service.  
**Related:** PER-1057 (PER-1092 protocol, PER-1097 implementation, PER-1102 conformance); PER-689 telemetry (still in progress); PER-692 portable IR; PER-1059 durable broker.

## Intent and decision

Savant is the test authoring, evaluation, metrics, and governance plane for AI workflows. It does **not** host a general-purpose agent runtime or inference router. The customer harness owns model/tool execution, per-provider permissions, data locality, costs and implementation-specific identifiers.

Versioned public type and schema entry points:
- \`@savant/types/harness-adapter\`: \`HarnessAdapter\`, \`HarnessAdapterCapabilities\`, \`HarnessTestRequest\`, \`HarnessRun\`, \`HarnessRunEvent\`, \`HarnessCaller\`, \`VerifiedHarnessPrincipal\`.
- \`@savant/schemas/harness-adapter\`: draft-2020-12 JSON Schemas, parser, fakeable \`createHarnessGateway\` boundary.
- \`packages/schemas/src/harness-adapter.test.ts\`: deterministic fake-harness conformance and malicious payload tests.

The boundary defines seven methods: \`discoverCapabilities\`, \`validateConfiguration\`, \`executeTest\`, \`cancel\`, \`getRun\`, \`streamEvents\`, \`health\`. The reference gateway exposes corresponding authenticated entry points \`discover\`, \`validateConfiguration\`, \`execute\`, \`cancel\`, \`getRun\`, \`events\`, \`health\`. **No production route, migration or deployment wiring is introduced.**

## Trust and authorization model

Callers supply a credential for a trusted verifier (not a JWT decode helper), tenantId, and actor. The injected \`verifyCredential\` MUST validate signature/issuer/audience/expiry or mTLS identity, token revocation, and operation-specific scopes. A verified tenant/actor must match the caller; requests with mismatched tenant/actor are denied **before** adapter I/O. The gateway passes no credential to \`executeTest\`. Supported operation scopes:
- read: discoverCapabilities, getRun, streamEvents, health;
- execute: validateConfiguration, executeTest;
- cancel: cancel.

For run reads/cancel/events, the injected \`authorizeRun(tenantId, runId)\` MUST prove tenant-scoped ownership in a durable store before connecting to an adapter. Unknown and foreign run IDs return identical \`not_found\` codes. All audit records must contain metadata only; no credentials, raw prompts or provider errors. Production callers must wrap the reference gateway with endpoint authentication, rate limiting, tracing, redaction and encrypted persistent storage.

Input references are opaque allowlisted identifiers; full HTTP URLs, inline prompts and secrets are invalid. Immutable \`specVersionHash\` and \`testSuiteHash\` are lowercase hex SHA-256 digests. Capture explicitly declares none/metadata/redacted, max 30-day retention, and customer residency label. The runner must enforce residency and retention at source; this parser alone cannot guarantee either. No raw trace content or arbitrary provider metadata is accepted into typed run/event records.

## Compatibility and capability coverage

| Adapter version | Savant v1 | Behavior |
|---|---|---|
| \`{major:1,minor:0}\` | supported | Mandatory v1 fields; feature flags still gate operations |
| \`{major:1,minor:1..32}\` | supported | Additive minor semantics only; unknown fields rejected at v1 trust boundary |
| \`{major:0,...}\`, \`{major:2,...}\` | rejected | \`unsupported_version\`, no execute |
| Malformed capabilities | rejected | \`invalid_capabilities\` or \`invalid_payload\` |
| \`execute:false\`, \`cancel:true\` | rejected | Self-contradictory capabilities |
| \`execute:false\`, \`coverage.execution:"unsupported"\` | observe-only | Execute forbidden; do not infer full provider coverage |

Coverage is explicitly \`complete\`, \`partial\`, \`unsupported\` independently for execution and observation; unknown capture is NOT evidence of full provider monitoring.

## Example

Capabilities:

\`\`\`json
{"protocol":{"major":1,"minor":0},"adapterId":"customer-harness","features":{"execute":true,"observe":true,"cancel":true,"events":true},"coverage":{"execution":"partial","observation":"partial"},"limits":{"maxConcurrency":2,"maxDurationMs":30000,"maxCostUsd":1}}
\`\`\`

Execute request (no production content):

\`\`\`json
{"tenantId":"tenant-1","adapterId":"customer-harness","actor":"qa-reviewer","runId":"run-123","traceId":"trace-123","idempotencyKey":"submit-123","specVersionHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","testSuiteHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","inputRef":"fixture-golden-01","budget":{"maxDurationMs":5000,"maxCostUsd":0.25},"capture":{"level":"metadata","retentionDays":7,"residency":"us-east-1"}}
\`\`\`

Example run:

\`\`\`json
{"tenantId":"tenant-1","adapterId":"customer-harness","runId":"run-123","externalRunId":"provider-job-opaque","traceId":"trace-123","specVersionHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","testSuiteHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","status":"queued"}
\`\`\`

Example event:

\`\`\`json
{"eventId":"evt-01","tenantId":"tenant-1","runId":"run-123","traceId":"trace-123","sequence":1,"status":"running"}
\`\`\`

## Failure and concurrency

Typed protocol error codes: \`unauthorized\`, \`insufficient_scope\`, \`not_found\`, \`unsupported\`, \`unsupported_version\`, \`invalid_capabilities\`, \`invalid_payload\`, \`invalid_response\`, \`invalid_event\`, \`idempotency_conflict\`, \`quota_exceeded\`, \`provider_unavailable\`. Errors never include input text. Event streams reject duplicate IDs, out-of-order sequences, foreign tenant identities, and extra capture fields; the sample bounds each stream to 1000 accepted events.

Reference gateway caches discovered capabilities and replay keys **in one process only**, with a 128-request storage cap and negotiated maxConcurrency. It coalesces same-key concurrent calls and rejects same run ID under a different key. It does **not** make distributed exactly-once, cost reservation, network timeouts, provider cancellation races or durable audit guarantees. PER-1059 must persist and atomically reserve tenant-scoped idempotency/cost, enforce network deadlines, handle webhook authenticity and event quarantine, reconcile cancel/completion races, stream pagination/backpressure, trace sampling and post-restart replay. Do not expose the reference gateway directly as a network endpoint or claim production readiness.

## Test, rollout and operational verification

Run \`pnpm test\`, \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm build\`, \`pnpm security:scan\`, plus existing PostgreSQL migration/tenant verification CI. Conformance suite tests version rejection, forged tenant, expired/revoked/missing/read-only token, cross-tenant run IDs, duplicate charges within same instance, request/hash/capture budget bounds, provider exceptions, forged responses, event ordering and cancellation. No synthetic fixture can establish real mTLS/signed-token verification; live provider and DB-backed tenant tests are required before release.

Track p95 adapter handshake/execute latency, run state transition delay, provider error fraction, rejected token attempts, event quarantine, queue depth and budget reservation accuracy in the future broker. Set SLO thresholds only from measured live baselines. On failed rollout, disable adapter execution feature flag, preserve existing read-only scorecards and roll back adapter routing; do not discard archived run provenance.

### Outstanding Definition-of-Done blockers

- Implement persistent broker and DB transactions (PER-1059), real auth verifier integration, provider connectivity, webhook signature/credential rotation, quotas, timeout/recovery and durable telemetry (PER-689).
- Implement sandbox real-harness smoke, integration and performance evidence, explicit source-release operational gates, and independent review. **This increment alone does not satisfy PER-1057 as a whole.**
