# Workflow Git artifact API — PER-1082

## Contract and ownership

Savant stores authored workflow graph JSON at `workflows/<workflowId>.json` in a tenant-connected GitHub repository. Git is authoritative; `workflow_artifact_versions` is an additive **rebuildable metadata index**, never a second canonical copy. API uses the existing Auth0 tenant membership, managed Git credential broker (read/write scope) and owner/platform-admin write policy. No production model/tool execution exists.

**Support matrix:** GitHub connected repositories with an active write-capable GitHub connection. GitLab, Bitbucket and Azure return `provider_unsupported` (409). Direct write is subject to Git branch protection; customer repositories that require PR review must use a future proposal flow.

## API (workspaceSlug query parameter required)

Read current: `GET /api/workflows/triage?workspaceSlug=acme&repositoryId=<uuid>`

Read immutable revision: `GET /api/workflows/triage?workspaceSlug=acme&repositoryId=<uuid>&revision=<40-character-commit-SHA>`

Write: `PUT /api/workflows/triage?workspaceSlug=acme` with

```json
{
  "repositoryId": "22222222-2222-4222-8222-222222222222",
  "expectedBlobSha": null,
  "specification": {
    "schemaVersion": 1, "workflowId": "triage", "version": "1.0.0",
    "source": { "runtime": "customer-harness" },
    "nodes": [{ "id": "agent", "kind": "agent" }], "edges": []
  }
}
```

`expectedBlobSha: null` means create only. Updating requires the current Git blob SHA returned from GET or PUT. The Github Contents API applies SHA-based compare-and-set; concurrent stale writes return `revision_conflict` (409). Identical canonical content is a no-op returning `replayed: true` (200), including after an uncertain response. Successful commits are 201 and carry the Git commit SHA, blob SHA, canonical SHA-256 digest, source-of-truth marker, and `indexed`/`reconciliationRequired`. No raw model/tool traces or credentials are accepted as dedicated fields.

## Security and failure contract

- Only members of the selected tenant may GET; only tenant owner/platform-admin may PUT. Every repository lookup is tenant-scoped before network/provider activity. Foreign tenant repository IDs give generic 404.
- The path is derived from a restricted workflow ID, never a supplied relative path. No arbitrary Git path or provider URL is accepted from clients.
- Bad graph/schema → 422, invalid workflow ID → 400, missing expected revision → 428, stale revision → 409, unsupported provider → 409, disconnected/missing credentials → 503/403. Provider errors return stable codes without token or response body.
- Entire workflow payload is validated and bounded before mutation. Native provider extensions are inert data. Condition annotations never schedule or execute workflows.
- A Git write can succeed even if Postgres indexing fails. The response truthfully reports `indexed:false` and `reconciliationRequired:true`; rebuild the index from Git after restoring SQL. Do not retry with a blind create.
- Historical RED→GREEN/DB/live-provider/authorization E2E evidence belongs in the PR checklist. Unit fakes do not prove real provider behavior; live provider smoke should be performed with a non-production test repository and recorded before declaring full DoD.

## Rollout and rollback

Apply `db/schema/0012_workflow_artifact_versions.sql` additively; no existing tables are modified. Revert API/service if necessary; Git artifacts remain untouched. The index is safely disposable and re-importable from Git. No new secret stores or mandatory provider proxy. Do not run auto-merge/release on the tenant's behalf.

## Operational follow-up

PER-1087 owns provider fault/recovery E2E, tenant-negative integration against a test Postgres, migration rollback, measured p95, accessibility where UI exists, and independent review. SAV-14 capability IR and SAV-05 immutable repository lineage remain cross-epic dependencies. Future work: GitLab/Azure/Bitbucket adapters and GitHub protected-branch proposal commits.
