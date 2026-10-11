# PER-1201 — Artifact-specific read authorization

This increment extends Savant's existing tenant → repository → capability reference authorization chain with an **optional artifact-level restriction**. It applies to the read-only `/api/capabilities/resolve` and `/api/capabilities/links/resolve` endpoints without introducing another repository, registry or workflow runner.

## Policy semantics

For a supported `(organization_id, repository_id, artifact_kind, artifact_id)`:

1. Require an **active tenant user** and existing tenant-scoped **repository read permission** first. No artifact rule can grant access to a repository the user cannot already read.
2. If no artifact policy rows exist for that artifact, preserve the existing repository-authorized behavior.
3. If one or more rows exist, require at least one matching `allow` for the active user, matching tenant group, or authenticated workspace `Member` role.
4. Any matching `deny` overrides every matching `allow`. Unrecognized principals do not match and unknown policy effects and permission keys are prohibited by the database.
5. Inaccessible artifacts receive the generic `not_found` response. DB outages return a sanitized availability error, not partial content. The existing capability service checks all batch nodes before making any Git read; it rechecks access on every pinned read.

Rules apply to artifact identity across all commits; `contentHash`, the pinned Git revision, source path and version remain separately verified by the resolver.

## Data model

Schema `db/schema/0013_capability_artifact_permissions.sql` adds:

| Column | Constraint |
| --- | --- |
| `organization_id`, `repository_id` | Composite FK to repository tenant identity, cascade on deletion |
| `artifact_kind` | `skill` or `workflow_spec` |
| `artifact_id` | Bounded 1–128 character artifact identifier |
| `permission_key` | Only `read` |
| `effect` | `allow` or `deny` |
| `granted_to_type` | `user`, `group` or `role` |
| `granted_to_ref` | Bounded principal identifier |

There is an explicit uniqueness constraint and scope index. Git still owns the complete source; this table stores authorization decisions only. No new secret material is stored.

## Verification

`capability-artifact-access.test.ts`: RED-first decision fixtures for inherited access, explicit allow, explicit deny precedence and malformed policy responses.

`verify-artifact-permissions.mjs`: isolated PostgreSQL 16 fixtures for two organizations, active/inactive members, two repos, role/group/user overlaps, artifact ID/kind separation, default/no-rules behavior, invalid effects, cross-tenant composite FK, deny overrides, repository disable and delete cascade. A two-link graph asserts **zero provider content calls** when the second artifact is denied, then two verified reads after granting access. Prints local query p95 over 20 samples as an anti-regression indicator, **not a production API SLO**.

CI applies all migrations twice and runs the isolated PostgreSQL suite alongside unit tests, lint, typecheck, build, and secret scan. The legacy CI, Vercel and submodule checks remain required.

## Rollout and rollback

Apply `0013` **before** deploying the application resolver change. Existing organizations with no artifact policies retain existing access. Populate rules only through an authorized administrative process outside this read-only increment. To disable enforcement, revert the resolver's artifact check. Do not drop populated ACL rows without an explicit security-approved plan; dropping populated authorization rules could broaden access.

This increment does **not** deliver a policy editing UI/API, fine-grained permission inheritance among linked nodes, historical policy snapshots, production GitHub/Auth0 smoke, production p95, or independent human reviewer signoff. The SAV-14 parent remains open.
