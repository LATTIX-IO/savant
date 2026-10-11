# ADR-0002: Portable WorkflowSpecification v1 contract

**Status:** Accepted for the **shared contract only** in PR #25. API persistence, UI, execution adapter and full PER-1052 acceptance are separate work.

**Decision scope:** PER-1077, parent PER-1052; related SAV-14 (canonical capability IR), SAV-05 (Git registry/versioning).

## Decision and ownership

Savant is the QA workbench for workflows running in customer-owned frameworks. WorkflowSpecification describes a portable, directed, acyclic inspection/evaluation graph. It **cannot execute** provider native nodes, invoke models/tools, implement a scheduler, or claim replay fidelity. It preserves unknown native source metadata as a typed `opaque` node with `native.kind` and arbitrary JSON native payload. Vendor expressions are inert annotations.

The consumer-facing contract is defined by:
- `@savant/types/workflow-specification` — TypeScript DTO;
- `@savant/schemas/workflow-specification` — draft 2020-12 JSON Schema, runtime parse, canonical serializer and SHA-256 digest;
- `packages/schemas/src/workflow-specification.test.ts` — contract and adversarial fixtures.

Future **tenant-authored** specifications live in **tenant-owned Git** at an immutable ref, with SHA-256 of canonical UTF-8 JSON recorded for integrity. PostgreSQL may index artifact identity, Git commit SHA, content digest, tenant, approval and audit; it does not become a second source of truth for the graph. No SQL or API changes are part of this increment.

## Representative valid payload

```json
{
  "schemaVersion": 1,
  "workflowId": "customer-triage",
  "version": "1.0.0",
  "source": { "runtime": "customer-harness", "sourceRef": "refs/heads/main" },
  "nodes": [
    { "id": "a", "kind": "agent", "outputs": [{ "id": "text", "dataType": "text/plain" }] },
    { "id": "b", "kind": "opaque",
      "native": { "kind": "custom.model", "payload": { "vendorOnly": [1, 2] } },
      "inputs": [{ "id": "prompt", "dataType": "text/plain" }]
    }
  ],
  "edges": [{ "id": "e1", "from": { "nodeId": "a", "portId": "text" },
    "to": { "nodeId": "b", "portId": "prompt" } }]
}
```

Invalid payload examples (the parser MUST reject all three):
- version downgrade/unknown major: `{"schemaVersion":0, ...}` → `unsupported-version`.
- edge to unknown `nodeId`: `{"nodeId":"absent","portId":"prompt"}` → `missing-node`.
- cycle, including self-reference, even if a vendor considers it bounded → `cycle`.

**Denied request example is a *future API fixture*, not an implemented endpoint:** tenant B attempts to retrieve or update tenant A's Git-bound spec by its workflow ID. The BFF must resolve actor tenant and scoped permissions **server-side**, deny without exposing the existence of A's artifact, and must not contact provider Git or persist a partial update. The pure parser accepts no actor identity and therefore cannot prove authorization. This gap remains with PER-1082/1087.

## Validation and error semantics

`parseWorkflowSpecification(input)` returns an **owned JSON snapshot** and throws `WorkflowSpecError {code,path}` for failure. The public API adapter will translate these stable codes into versioned safe errors, omitting original untrusted payloads. A caller must **not** expose input validation paths alongside tenant resource existence or secrets.

| Error code | Meaning |
|---|---|
| `unsupported-version` | Contract major does not equal 1 |
| `invalid-*`, `unsafe-key` | Invalid JSON/object shape, identifier, port, condition or forbidden key |
| `duplicate-node`, `duplicate-edge`, `duplicate-port` | Uniqueness failure |
| `missing-node`, `missing-port` | Dangling directed reference |
| `cycle` | Graph is not a DAG |
| `size-limit`, `depth-limit` | Bounded validation limit exceeded |

Root input must be a JSON-like plain object: no getters, unsupported prototype objects, sparse arrays, nonfinite numbers or callable values. Unknown *native* JSON metadata is retained under `native` and does not become executable. Untrusted labels are display text and must be escaped by consuming UIs.

SHA-256 digest is calculated over the UTF-8 encoding of recursively sorted JSON object keys, preserving array order. Equality of hashes means identical canonical representations; array reordering is intentionally version-significant. Digests are **integrity identifiers, not signatures or authorization tokens**. Git revision/commit SHA is tracked separately.

## Persistence and interface integration plan (follow-on PER-1082)

Proposed BFF service boundary:
- `writeSpec(actor: AuthenticatedActor, repo: AuthorizedTenantRepo, spec: WorkflowSpecification, expectedCommitSha: string, idempotencyKey: string)` — parse, authorize *before Git IO*, pin content hash, conditionally commit; expose `409` for stale commit, `403/404` for unauthorized resource and `422` for malformed spec.
- `readSpec(actor: AuthenticatedActor, repo: AuthorizedTenantRepo, workflowId: string, pinnedCommitSha?: string)` — authorize, resolve Git ref, verify digest against metadata, parse, redact as required; deny IDOR and unauthorized exports.
- `indexSpec(tenantId, workflowId, sourceCommitSha, specContentSha, ...)` — rebuildable metadata index; unique key scoped to tenant+repo+workflow+source commit, transactionally guarded approvals/audit.

These are design signatures **only**. Neither a BFF endpoint nor database migration is delivered in PR #25. Schema evolution must use additive indexes without changing skill/telemetry tables. Any future migration requires a backfill, foreign-tenant denial tests, stale-writer/duplicate write tests, and rollback proof.

## TDD, ops, and rollback

RED fixtures were committed before feature code (`b739110e7d66b253033c05078ee76487aacbd382`), but an actual RED test failure log was **not captured**; do not assert full PER-1077 TDD completion without that evidence. GREEN contract fixtures, full CI, Vercel, and security gate results must be linked to their exact tested head SHA. Follow-on integration must exercise tenant auth, Git errors, idempotency, schema/runtime conformance with a real JSON Schema validator, load/p95 baseline and UI accessibility before the parent story can close.

No migrations, outgoing network calls, credentials, or new runtime execution were introduced. Roll back by reverting contract exports and code; do not delete tenant-authored repositories or existing eval/skill data. The temporary absence of this contract is not a production execution outage.
