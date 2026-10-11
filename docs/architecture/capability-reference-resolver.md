# Capability Reference Resolver — bounded PER-1173/SAV-14 increment

**Scope:** Authenticated, read-only resolution of immutable workflow specifications and Git-indexed SKILL.md references. The reference is never an authorization token. This increment does not implement editing, execution, approval, discovery, provider crawling, or a generalized skill registry.

## API

`POST /api/capabilities/resolve?workspaceSlug=<authorized-slug>`

Headers: `Content-Type: application/json`, `Origin: <same-origin>` or same-origin `Referer`, authenticated application session. Body (maximum 750 KB, parsed before use):

```json
{
  "reference": {
    "schemaVersion": 1,
    "kind": "workflow_spec",
    "organizationId": "tenant-uuid",
    "artifactId": "triage",
    "version": "1.0.0",
    "contentHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "locator": {
      "source": "git", "repositoryId": "repository-uuid", "path": "workflows/triage.json",
      "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
}
```

A matching authorized reference returns `{data: {kind, reference, verifiedDigest, specification}}` for a workflow or `{data:{kind,reference,verifiedDigest,content}}` for a skill. All responses are `Cache-Control: no-store`. SKILL.md is returned as plain data and must be rendered escaped by clients. The client cannot select provider hosts, credentials, Git URLs or arbitrary paths.

## Authorization and integrity

1. Resolve authenticated workspace from session and selected `workspaceSlug`. Development fallback is not a valid authenticated resolver session.
2. Parse and bound the reference, compare organization to the authenticated tenant and require pinned Git revision and SHA-256 digest.
3. Query an active tenant user and tenant-scoped repository in PostgreSQL. If explicit repository ACL rows exist, require an eligible read grant (user ID or subject, group ID or name, or the generic Member role). Unknown permission keys and unrecognized grant semantics **deny**, never fall back to implicit allow. Without explicit rows, active workspace membership grants read.
4. For skills, require a matching `indexed_skills` record scoped to organization/repository/skill ID/pinned commit. The indexed source path and `metadata_version` must match the reference; null versions are not fabricated. Source hash in this index is not assumed to be canonical SHA-256.
5. Use the existing managed Git broker in read scope. Validate the remote immutable repository ID before fetching. Always read the exact pinned commit and bounded bytes, never a mutable branch. Workflow reads reuse `workflowArtifacts.get`; skill reads use the provider's managed `readFile`.
6. Verify workflow ID, SemVer, Git commit and canonical workflow SHA-256, or verify raw SKILL.md UTF-8 SHA-256 and pinned commit. On mismatch, fail closed. No missing digest is synthesized.

Errors: `auth_required` 401; `not_found` 404 for foreign or inaccessible resources; `invalid_reference`/`locator_mismatch` 422; `unsupported_kind`/`provenance_incomplete`/`integrity_mismatch` 409; `content_oversized` 413; provider/internal unavailable 503. None echo provider tokens or user input.

**No production execution** is invoked. The resolver emits successful, minimal audit metadata (kind, opaque ID, repo, commit) but does not log raw content or bearer credentials. This is a read-only API, not a replay or inference gateway.

## Tests and operational boundaries

`capability-resolver.test.ts` provides deterministic positive, negative, cross-tenant, authorization-before-IO, malicious JSON, unsupported-kind, stale-revision, digest, provider-error and content-mismatch coverage. PostgreSQL ephemeral CI must validate tenant and ACL constraints; migration idempotency remains unaffected. Dedicated Savant quality CI covers unit/lint/typecheck/build/secrets; existing CI, submodule and Vercel are additional gates.

Rollback: revert the new `/api/capabilities/resolve` route and service modules. No migration, indexed skill, Git artifact or credential has been modified by the increment.

### Not completed here

Live Auth0 two-tenant / managed GitHub / PostgreSQL smoke, full independent reviewer signoff, skill access rules beyond the explicitly modeled repository grants, workload-level API/provider p95, reference graph traversal and resolution of other capability kinds. Provider kinds not implemented return explicit `unsupported_kind`; no pretend coverage. Track these before marking PER-1173/PER-1052/SAV-14 Done.
