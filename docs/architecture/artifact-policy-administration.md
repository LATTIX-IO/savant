# PER-1203 — Artifact read-policy administration v1 (backend increment)

This increment exposes an admin-only **list / grant / revoke** interface for the existing `capability_artifact_permissions` layer. It does not modify provider ACLs, change repository permissions, execute workflows, or create a new authorization service. Git remains the authoritative store of authored artifacts; PostgreSQL controls access.

## API contract

`GET /api/capabilities/policies/v1?workspaceSlug=<workspace>&repositoryId=<uuid>&kind=workflow_spec&artifactId=triage`

Requires authenticated Auth0 tenant membership. The backend additionally requires the active tenant's first member or `platform-admins` group and a connected tenant-owned repository. Response `{data:{revision:0,rules:[]}}` with `ETag: "v0"`, `Cache-Control: no-store`. Rules are bounded to 249 results; an excessive rule set fails explicitly rather than silently truncating.

`POST /api/capabilities/policies/v1?workspaceSlug=<workspace>` uses authenticated session, `Origin` or same-origin `Referer`, `Content-Type: application/json` and `If-Match: "v0"`. Maximum body 750,000 bytes.

```json
{
  "repositoryId": "11111111-1111-4111-8111-111111111111",
  "kind": "workflow_spec",
  "artifactId": "triage",
  "operation": "grant",
  "effect": "deny",
  "principalType": "user",
  "principalRef": "22222222-2222-4222-8222-222222222222",
  "requestId": "33333333-3333-4333-8333-333333333333"
}
```

`operation` accepts `grant` or `revoke`; `effect` is `allow` or `deny`; principals are canonical tenant-local UUIDs for active users or groups, or role `member`. Reject user-supplied organization IDs, provider URLs, bearer tokens, arbitrary permission types and unknown fields. A grant is an *additional artifact restriction*, never a repository-access grant. Explicit deny continues to override allow in the existing PER-1201 resolver. A successful mutation returns `{data:{revision,changed,replayed}}` with a new ETag. A repeated `requestId` with matching normalized payload replays its stored result without a second update or audit; same ID with different content returns conflict.

## Consistency and security invariants

- Tenant and repository authority are derived from the authenticated session, never request body; actor's active membership plus first-member/platform-admin status are checked *inside the transaction*.
- Enabled repository and same-tenant active principal are validated before writing. No rows are created for foreign/disabled identities.
- `0014_capability_policy_administration.sql` adds a revision row per tenant/repository/artifact, and hash-only idempotency receipts with FK cascades. The revision row is locked with `FOR UPDATE`: concurrent clients presenting the same revision cannot silently overwrite each other.
- The same database transaction commits the rule change, revision, receipt and minimal audit entry. Any failure rolls back all four. Denied requests get a best-effort redacted audit code, never a foreign artifact identifier.
- Error responses expose typed status only (not upstream errors). Missing database migration fails closed with `policy_admin_unavailable` 503. GET/POST disable caching.
- The policy does not alter Git ACLs or expose private skill/workflow content. These endpoints do not publish broadly discoverable policy metadata.

## Tests / release gate

`capability-policy-contract.test.ts`: strict scope and principal parsing, URI and org spoofing denial, SemVer-independent artifact IDs, mandatory revision token, deterministic retry digest, poisoned prototypes/getters.

`verify-capability-policy-admin.mjs`: ephemeral PostgreSQL real two-tenant and admin-group behavior, active/disabled/cross-org principal rejection, grant/list/revoke, duplicate grant, retry/idempotency conflict, concurrent conflicting writers, revision monotonicity, minimal atomic audit and local query p95. Previous workflow/schema/artifact tests continue running. CI must pass Node tests, lint, typecheck, production build, secret scan, migrations applied twice and PostgreSQL verification. This is **not** an end-to-end measured production API SLO.

## Rollback

Disable the `/api/capabilities/policies/v1` route by reverting the handler and service if needed. Keep both 0013 rules and 0014 revision/receipt tables intact until their migration and idempotency impact is assessed; deleting 0014 without a controlled restore would discard retry guarantees and permit stale writes. Never delete underlying Git content as part of rollback.

## Explicitly outstanding PER-1203 gates

The production-like **non-production** Auth0 two-tenant + managed GitHub smoke, provider 403/404/429/5xx and token lifecycle, UI inspector/accessibility, p50/p95/p99 end-to-end latency, reviewer signoff, and actual production migration/rollback evidence are separate acceptance tasks. They must not be marked complete from the isolated CI database test. This PR is a backend administrative vertical slice, not closure of the entire story.
