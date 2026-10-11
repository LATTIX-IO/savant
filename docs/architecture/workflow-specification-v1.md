# WorkflowSpecification v1 — contract increment (PER-1077)

Savant describes and tests externally executed workflows; this contract is **not an execution engine**. A v1 workflow is a directed acyclic graph with explicit typed ports, node and edge IDs, version, origin, optional quality outcome references, and opaque provider-native extensions. Unknown native nodes must use `kind: "opaque"` and provide `native.kind`; conditions are annotation-only, never evaluated by Savant. v1 rejects all cycles rather than implying bounded-loop execution.

## Source of truth and rollout

Tenant-owned Git retains authored specs, referenced by immutable commit SHA. `canonicalizeWorkflowSpecification` produces key-sorted UTF-8 JSON whose SHA-256 can serve as the content digest; consumers must hash **exactly the UTF-8 bytes**. Array order is retained, so node/edge ordering changes the digest. The JSON Schema and in-process validator define the wire contract; unsupported major versions fail closed. No migration, DB write, API route or UI is introduced by this contract-only increment; integration follows PER-1082/1087 after capability-IR and Git-access dependencies are satisfied.

## Security and validation

Parser bounds: 512,000 serialized code units, 1,000 nodes, 5,000 edges, 100 ports per direction per node, max 20 levels in extension JSON, and 1,000 object properties. Duplicate IDs, dangling references, missing ports and cycles fail deterministically. Untrusted display labels and native payloads must be escaped by rendering components. No credentials, production invocation or provider feature assumptions belong in this graph. Tenant authorization applies at the future control-plane storage/API boundary, not at the pure parser; never use this parser as proof of access control.

## Test and traceability

`packages/schemas/src/workflow-specification.test.ts` provides positive, negative, opaque, cycle, duplicate, canonicalization and bounds fixtures. Follow-on RED tests must cover tenant denial, optimistic commit conflict, persistence idempotency, provider outages, benchmarks, migration/backfill and browser accessibility. Track these separately: this contract alone does **not** close PER-1052.

Rollback: revert the shared contract exports (no DB migration). Existing skills and telemetry remain untouched.
