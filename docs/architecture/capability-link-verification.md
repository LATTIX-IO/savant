# Capability relationship verification — PER-1173 incremental contract

Scope: read-only, bounded verification of `CapabilityLinkV1` relationships. This extends [Capability Reference Resolver](capability-reference-resolver.md) without creating a new registry, authorization service, workflow executor, or object database.

## API

`POST /api/capabilities/links/resolve?workspaceSlug=<authorized-tenant>` with authenticated session, same-origin `Origin` or `Referer`, and `Content-Type: application/json`:

```json
{
  "links": [{
    "relation": "depends_on",
    "from": { "schemaVersion": 1, "kind": "workflow_spec", "organizationId": "tenant-a", "artifactId": "triage", "version": "1.0.0", "contentHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "locator": { "source": "git", "repositoryId": "repo-1", "path": "workflows/triage.json", "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
    "to": { "schemaVersion": 1, "kind": "workflow_spec", "organizationId": "tenant-a", "artifactId": "review", "version": "1.0.0", "contentHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "locator": { "source": "git", "repositoryId": "repo-2", "path": "workflows/review.json", "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }
  }]
}
```

On full success the response contains `data:{links:[{relation,from:{reference,verifiedDigest},to:{reference,verifiedDigest}}],nodeCount}`. This endpoint intentionally returns **only identities and verified hashes, not the underlying skill/workflow content**. No links persist to PostgreSQL as an asserted graph. The response proves that every source was readable and matched the supplied immutable provenance *at verification time*; it is not a permanent authorization grant or certification of semantic correctness.

## Security, quotas, and failure contract

1. Tenant session and membership resolve before request processing; local development fallback is not authorized. The request reader enforces same-origin JSON and a maximum 750kB body before parsing.
2. Limit each request to **1–8 links**, **at most 12 distinct referenced artifacts**. References are validated using the canonical schema; top-level unknown fields, accessor properties, sparse arrays, cycles and unsafe JSON objects fail without external IO.
3. Every node must belong to the caller's tenant, have a supported pinned Git locator, and include a canonical SHA-256 digest. Cross-tenant mixed links yield generic `not_found` without disclosing which endpoint was foreign. Identical self-links and conflicting references to the same immutable artifact identity are denied.
4. **Two-phase verification:** Parse and validate every link; authorize **every unique node through tenant membership, repository grants, artifact index and metadata**; only then invoke provider-backed reads. A denied later node causes zero provider reads anywhere in the batch. During the fetch phase, each artifact is reauthorized immediately before its pinned read to guard against stale permissions.
5. Verification and network failures fail the *entire* batch; there is no partial-success payload. Input ordering is preserved. Duplicate references are read once per request, never cached across requests or users.
6. All errors are sanitized and audited with code only; no identifiers of a denied foreign reference, token, source bytes or provider response body enter the failure response/audit payload. No-store cache control is mandatory.

The endpoint is explicitly **not** a general cross-tenant graph, workflow scheduler, inference proxy or arbitrary artifact-crawler. It currently supports only `skill` and `workflow_spec` references; others fail `unsupported_kind`.

## Verification and rollback

- `capability-links.test.ts`: positive pinned resolution; all-node authorization-before-IO; foreign tenant; later-repository denied; deduplication; invalid relations, missing hashes, self-links; count limits; malicious getters/prototype pollution; provider errors; no source-body exposure; atomic failure.
- Ephemeral PostgreSQL `verify-capability-access.mjs`: two independent tenant repositories; deny a second repository's explicit grant while the first remains authorized; assert **zero provider reads** on failure. Grant second repository read access, assert both pinned simulations verified, and clean all fixtures. This proves the SQL predicate's batch-preflight integration, not a live third-party GitHub.
- Quality gate: full Node suite, lint, typecheck, production build, secret scan, PostgreSQL migration+ACL gate, legacy CI, submodule validation, Vercel preview. No human signoff or real Auth0/GitHub live smoke is claimed.

Rollback: revert the new link-service API and preflight extension. No database schema or user-created content changes, and all previous single-reference APIs remain compatible.

Keep PER-1173/SAV-14 In Progress until generalized capability graph storage/semantic alignment, multi-kind artifact policy evaluation, live two-tenant GitHub integration, measured production-like endpoint p95, and independent acceptance evidence are completed.
