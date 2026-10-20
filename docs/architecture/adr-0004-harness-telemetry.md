# ADR-0004: PER-1058 opt-in, content-free customer-harness telemetry v1

**Status:** Reference SDK and contract increment. Production transport, long-term storage, distributed deduplication and full PER-1058 acceptance remain open.

## Why and boundary

Savant is the QA/measurement workbench for *customer-owned* AI harnesses. The TypeScript and Python reference SDKs instrument customer workflow, step, tool and model spans but never execute a model or proxy inference. They are disabled by default. When enabled they **only** send bounded, explicit metadata fields, never prompt, response, tool arguments, production secrets, raw user identity or whole-provider observability claims.

The existing `/api/skill-runs` route already accepts tenant-scoped `svt_` tokens and applies server-side capture redaction and encryption; it does **not** understand this new span-v1 batch format. Do not direct the SDK to that endpoint until PER-1059 implements a secure, authenticated ingest adapter and persists batch receipts. There is no live provider call, new database migration or production route in this reference increment.

## Public contracts

- `@savant/types/harness-telemetry` — `HarnessTelemetrySpanV1`, `HarnessTelemetryBatchV1`, send receipt and coverage types.
- `@savant/schemas/harness-telemetry` — draft 2020-12 JSON Schema, fail-closed parser, TypeScript bounded buffer.
- `sdks/python/savant_telemetry.py` — dependency-free Python equivalent.
- `packages/schemas/src/harness-telemetry.test.ts`, `sdks/python/test_savant_telemetry.py` — adversarial, no-content, tenant-spoof, deduplication, retry, forged-ACK, disabled, quota and missing-span tests.

`schemaVersion:1` is required. All fields are allowlisted; unknown/additional fields fail. IDs are opaque bounded ASCII. `specVersionHash` and `testSuiteHash` are immutable lower-hex SHA-256 digests. `nodeId` corresponds to WorkflowSpecification v1 node id. `traceId` and `runId` correlate to the harness-adapter-v1 request, but this SDK cannot validate their existence in a remote service by itself.

**Canonical mapping to OTel (opt-in, no-content):**

| Savant span-v1 | OTel equivalent | Capture rule |
|---|---|---|
| `traceId` | trace ID | reference opaque ID, not an enforced OTel 128-bit hex ID |
| `spanId`, `parentSpanId` | span / parent identifiers | reference opaque IDs, not an enforced OTel 64-bit hex ID |
| `kind` | span.kind / `savant.span.kind` | workflow/step/tool/model |
| `nodeId` | `savant.workflow.node_id` | bounded sanitized ID |
| `specVersionHash` | `savant.workflow.spec_hash` | lower-hex immutable hash |
| `testSuiteHash` | `savant.eval.suite_hash` | lower-hex immutable hash |
| `inputTokens`, `outputTokens` | GenAI usage metrics | nonnegative integers only, if observed |
| `estimatedCostUsd` | estimated cost, not a provider invoice | nonnegative value, if known |
| `captureLevel` | `savant.capture.level` | none/metadata only |

Do not claim automatic distributed trace correlation with native OTel until an external translator maps these reference opaque IDs to proper W3C trace/span IDs.

## Example payload

```json
{"schemaVersion":1,"tenantId":"tenant-a","adapterId":"adapter-a","runId":"run-a","traceId":"trace-a","spanId":"step-01","parentSpanId":"workflow-01","nodeId":"parse","specVersionHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","testSuiteHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","kind":"step","status":"completed","startedAtMs":1780000000000,"durationMs":250,"captureLevel":"metadata"}
```

Use `enabled: false` for all SDK deployments by default. Never embed a bearer token in a span; install a scoped, secret-safe transport implementation externally. Tenant and run ACL are enforced by the eventual server endpoint, **not trusted from SDK metadata**. A disabled SDK does not even parse or transport events.

## Buffering, replay, failure and security semantics

SDK queue capacity defaults to 256 events (maximum 1000) with a maximum batch of 100. Exceeding capacity throws the safe `backpressure` code; it does not silently drop evidence or grow memory indefinitely. The sender includes a deterministic `batchId` and monotonic `cursor`. Receipts must echo the exact `batchId` and expected `acceptedCursor`; invalid ACK leaves the batch pending, and transport failure is sanitized to `transport_unavailable`. Concurrent receiver processes and crash recovery require **server-side, durable** batch ID dedupe and a persisted cursor (PER-1059); these reference senders are process-local only.

Coverage calculation rejects a mixture of tenant, adapter, run, trace, spec-version hash or test-suite hash in a single batch of observed spans. A foreign attribution returns `identity_mismatch` rather than falsely completing a graph. The future server consumer must additionally bind these attributes to an authenticated, durable run record.

Missing expected workflow node IDs are reported explicitly as `partial` or `none`, never silently `complete`. `complete` means coverage of the caller's **declared expected graph steps only**, not full provider telemetry.

The TypeScript implementation serializes an owned sanitized snapshot and refuses property getters/prototype pollution. The Python SDK requires plain `dict` and exact primitive types. Neither SDK transmits custom arbitrary attributes.

## Compatibility and release matrix

| Producer | Wire schema | Consumer | State |
|---|---|---|---|
| TypeScript v1 | `span-v1` | Reference validator and fake sender | supported |
| Python v1 | `span-v1` | Reference validator and fake sender | supported |
| Unknown v2 major | incompatible | `invalid_telemetry`, fail closed |
| Savant production `/api/skill-runs` | separate legacy skill-run JSON | **not** a span-v1 consumer |
| PER-1059 broker span receiver | future | no production claim |

## Test gates and on-call runbook

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm security:secrets`, blocking `pnpm security:deps`, and `python3 -m unittest discover -s sdks/python -p 'test_*.py'` plus PostgreSQL integration checks in CI.

For an unexpected increase in rejected events, turn off the emitting SDK at the customer runtime, retain queued evidence locally subject to customer retention policy, inspect only metadata-safe error codes, reauthenticate the sender and verify immutable version attribution. If transport fails, retry the same batch ID and cursor; do not generate fresh IDs on retry or dump raw transport errors. Escalate repeated `backpressure` and `invalid_ack` as data-loss risks. Production dashboards need explicit counts for invalid telemetry, duplicate receipts, queue depth, recovery lag and partial coverage, with SLO targets set from measured live harness baselines, not invented.

## Definition-of-Done still outstanding

- Native OTel/W3C translator, real SDK installation examples and signed release artifact.
- Authenticated server ingest route, tenant-scoped persistent batch receipts and cursor, webhook signature validation and replay recovery in PER-1059.
- Provider sandbox smoke and Python/TypeScript cross-language identical payload replay against the real consumer.
- Independent reviewer, measured queue/latency performance and security signoff; do not mark parent PER-1058 Done based on this reference contract alone.
