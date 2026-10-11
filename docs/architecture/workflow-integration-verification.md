# PER-1087 — workflow artifact verification and threat review

Status: **code hardening increment**, not full customer UAT. Parent: PER-1052. Base: PR #26. This increment **does not implement a workflow harness, runner, inference proxy or visual editor**.

## Tested boundaries

| Boundary | Requirement | Executable evidence |
| --- | --- | --- |
| Browser → BFF | Same-origin/Referer evidence required for session-authenticated PUT, reject unsupported media types and >750KB bodies | `request.test.ts`, `request-security.ts` |
| Tenant → repository | Resolve organization from authenticated session and repository using tenant-scoped query, deny alien ID | `workflow-artifacts.test.ts`, existing tenant resolver tests |
| Member → write | Only tenant Owner/platform-admin may write; ordinary member may read | `workflow-artifacts.test.ts`, existing membership tests |
| Git broker → provider | Broker must issue scoped `read` or `write` credential and verify immutable repository ID before IO | `runtime.ts`, existing Git broker acceptance tests |
| Provider HTTP → artifact | Bounded response stream; valid UTF-8; verify Git SHA-1 blob object against bytes, not just supplied metadata | `workflow-github-client.test.ts` |
| Artifact → parser | Reject dangling edges, cycles, duplicate nodes and unsupported versions; preserve opaque metadata | `workflow-artifacts.property.test.ts`, shared schema tests |
| Git → SQL index | Git is canonical; metadata index tenant/repo integrity, duplicate commit idempotency, compensating replay | `workflow-artifacts.test.ts`, `verify-workflow-schema.mjs` |
| Failure → response | Deterministic errors without upstream body, bearer token or untrusted payload in message | `workflow-github-client.test.ts` |

### Git SHA-1 clarification

The external Git object identifier uses **Git blob SHA-1**, calculated over `blob <byte-length>\\0<bytes>`. This is checked independently to detect altered/corrupted responses. Savant's **canonical SHA-256 digest** remains a separate content-fingerprint. Neither value is a digital signature or proof of authorization. Do not represent these hashes as independent cryptographic signatures of the upstream repository.

### CI performance evidence

`workflow-artifacts.property.test.ts` generates deterministic valid/malformed graphs and prints measured local CI p95 for 350 nodes and 349 edges over 32 samples. The 2,000ms guard is a generous anti-hang regression ceiling, **not a production latency SLO**. Capture the actual p95 from each verified CI head in the PR. Real provider p95, end-user browser SLO and larger workload baseline are separate acceptance items.

### Real PostgreSQL migration gate

The CI `workflow-postgres` job provisions an ephemeral PostgreSQL 16 instance; invokes `pnpm db:migrate` twice to check idempotency; and runs `verify-workflow-schema.mjs`. The script explicitly refuses non-loopback database URLs and requires `SAVANT_WORKFLOW_SCHEMA_TEST=1`, then checks duplicate source commits, cross-tenant repository FK, transaction rollback, deletion cascade and cleanup. This does **not** mean the production instance has been migrated or that live provider writes have been verified.

## Live sandbox UAT still necessary before closing PER-1087

1. Use a **non-production GitHub organization/repository** with a temporary managed connection granting write to `workflows/`, plus isolated test PostgreSQL. Never test against a customer's production Git provider by default.
2. Provision two distinct authenticated tenant memberships and a normal Member/Owner pair. Verify foreign tenant `GET/PUT` return 404 with no repo lookup, Member PUT 403, Owner create/read/update and pinned commit GET, and a malformed graph 422.
3. Force two concurrent writers sharing expected Git blob SHA. Verify exactly one succeeds and the second gets 409; replay identical payload without creating another commit or index row.
4. Inject revoked/missing token, GitHub 403/404/429/5xx, response timeout and altered returned blob hash; verify safe result and no leaked credential or raw content. Test repo rename/reassignment (provider immutable ID changes) and protected-branch rejection.
5. Stop PostgreSQL between successful Git write and metadata index; verify `reconciliationRequired:true`, restore DB, replay and confirm an index row without an additional Git commit.
6. Run migration against an isolated clone/backup. Reapply and verify rollback procedure; restore a backup for deployment rollback where required by operations. Confirm no prior skill/evaluation rows changed.
7. Record timing p50/p95/p99 for create/read/update under representative concurrency and payload sizes, along with DB and Git network limits and provider rate-limit handling.
8. Verify the UI only when a Workflow Studio screen actually exists; **no canvas or page has been implemented by this increment**, so screenshot/WCAG verification is currently not applicable.

## Safe rollback

Revert the BFF/provider-client integration and route code while leaving tenant Git files untouched. The `workflow_artifact_versions` index is rebuildable and should normally be retained. To revert only the added tenant key after ensuring no writes depend on it, drop `workflow_artifact_versions_org_repository_fk`, then optionally drop `repositories_organization_id_id_key`. Do not remove `0012` from production migration order without an explicit DB rollback plan.

## Acceptance status

Code and deterministic CI may be merged independently as a **verification infrastructure increment**. PER-1087 must remain **In Progress** until isolated live GitHub+Postgres UAT, a complete operational p95, and independent reviewer signoff are attached to Linear; likewise do not prematurely close PER-1052.
