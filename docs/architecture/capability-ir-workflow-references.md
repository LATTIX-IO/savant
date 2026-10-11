# SAV-14 increment: capability references for workflow QA

**Status:** Shared contract + workflow service projection. This is *not* the completed SAV-14 epic, not a permission grant, and not a workflow runtime. Scope: [PER-692](https://linear.app/lattix/issue/PER-692), dependencies for PER-1052 and future PER-1173.

## Boundary and invariants

- **Savant owns QA artifacts and evidence, not production execution.** Skill/plugin/agent/tool/MCP/knowledge/instruction identities and workflow/test/evaluation/experiment/scorecard/gate/observation identities can share a portable reference representation. A reference describes an artifact; it does not run it or authorize its retrieval.
- **Git** is canonical for authored assets. Each authored reference includes an opaque tenant-scoped repository ID, relative path and immutable commit SHA. **PostgreSQL** is allowed only for operational state, authorization, audit and rebuildable projections; observed evaluation/run records may use the `database` locator. A Git commit SHA-1 and the canonical content SHA-256 are different values.
- `organizationId` always comes from an **authenticated** tenant resolution at the BFF, never from the untrusted workflow body. A parsed link requires the same organization on both endpoints but the parser is not itself an authorization check. Every future reference resolver must authorize each endpoint independently *before* any Git/provider/database access, and must not expose whether a foreign artifact exists.
- Reference `schemaVersion` is 1. Version requires strict semantic `MAJOR.MINOR.PATCH` (including valid prerelease/build fields), not Git branch labels such as `latest`. Rejected or missing version information must not be synthesized. Paths are bounded repo-relative paths; raw URLs, traversal, executable metadata and provider credentials are not acceptable locators.
- Native extension properties are carried as inert bounded JSON. The parser rejects accessor properties, custom prototypes, unsafe keys and excess nesting before serializing a JSON snapshot. Unknown *top-level* contract fields fail; unknown values within `extensions` round-trip.

## Types and integration

- `@savant/types/capability-reference`: `CapabilityReferenceV1`, `CapabilityLinkV1`, `CapabilityArtifactKind`, `CapabilityProjection`, `LegacySkillMigration`.
- `@savant/schemas/capability-reference`: `parseCapabilityReference`, `parseCapabilityLink`, `canonicalizeCapabilityReference`, `migrateLegacySkillReference`, `makeWorkflowCapabilityProjection`.
- The existing `GET/PUT /api/workflows/[workflowId]` returns the original response **plus** `data.capabilityProjection`. Its reference is derived after the tenant-scoped workflow service has retrieved/committed Git data. If a legacy workflow uses an unrecognized version, that *existing API remains available*: `{status: "unavailable", reason: "version_invalid"}` is returned for this additional projection only.
- Example projected workflow reference (values illustrative, not a verified credential):

```json
{
  "schemaVersion": 1,
  "kind": "workflow_spec",
  "organizationId": "tenant-a",
  "artifactId": "triage",
  "version": "1.2.3",
  "contentHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "locator": {
    "source": "git",
    "repositoryId": "repo-a",
    "path": "workflows/triage.json",
    "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

## Legacy migration without data loss

`migrateLegacySkillReference` is a **pure preview**, not a write or migration job. It clones the complete original skill projection under `extensions.legacy`, reports missing digest as `digest_missing`, and makes an immutable reference only when tenant-scoped repo ID, valid SemVer, Git-relative path and pinned commit exist. If critical identity/provenance is missing, it returns `unresolved` with original payload and loss report. It never fabricates source revisions, digest, permissions or production success. No existing skill API, database row, registry or release flow changes.

## Verification and rollback

`packages/schemas/src/capability-reference.test.ts` tests SemVer rejection, tenant-link denial, canonical native extension round-trips, unsafe input, legacy loss visibility and workflow identity derivation. `apps/web/src/server/workflows/workflow-artifacts.test.ts` tests the additive API projection and compatibility with older non-SemVer workflows. The repository's Savant TypeScript CI, PostgreSQL integration, security scan, build and preview gates must pass on the exact PR SHA.

Rollback consists of reverting the exported capability-reference module and additive workflow response projection. No migration, credential or externally executed workflow is modified.

**Still outstanding (future increments):** reference-resolving BFF with separate authorization per linked artifact, complete migration of existing skill package and other capability projections, provider adapter negotiation, an authenticated two-tenant GitHub+PostgreSQL UAT, measurements of real API/provider latency, complete compatibility schema alignment, and independent peer acceptance. PER-692 / PER-1052 remain open until their full acceptance criteria are evidenced.
