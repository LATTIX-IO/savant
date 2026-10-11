# Release Governance Audit — PER-1212

Savant source publication is disabled by default. The operational audit is a **read-only, fail-closed** check of configured GitHub controls. It does not create a release, change a repository setting, grant permissions, or replace a manual non-production end-to-end acceptance test.

## Operator execution

An authorized repository administrator must supply a short-lived, **read-only** GitHub token capable of reading repository rulesets, the `savant-release` environment, deployment-branch policies, and Actions variables. Do not paste the token into command arguments or commit it.

```bash
export GITHUB_REPOSITORY=LATTIX-IO/savant
export GH_TOKEN=<read-only admin token>
node scripts/release-controls-audit.mjs > release-governance-audit.json
```

The command emits a fixed JSON schema with eight boolean checks and stable error codes; it never serializes remote API responses, reviewer identities, access tokens or HTTP bodies. Exit code 0 requires all eight checks. Exit code 1 indicates missing, denied, unavailable, incomplete or unverified evidence. If the API denies environment inspection, that is a **failed control**, not an approval.

The audit verifies that `main` is the default/protected branch, that active branch rules enforce at least one required approving PR review plus named status checks without bypass actors, and that an active tag ruleset prevents update and deletion of version tags. It requires the `savant-release` environment to have explicitly configured reviewers and self-review prevention, with a single exact `main` deployment policy. It also requires the publication flag to be explicitly `false` while prerequisites are inspected.

This audit deliberately accepts only straightforward, well-defined GitHub ruleset reference patterns. Ambiguous exclusions and wildcard combinations are rejected pending manual review. The CLI validates repository identifiers, uses HTTPS only to `api.github.com`, GET-only requests, bounded JSON payloads, timeouts and sanitized failures.

## Live operational gates still outstanding

The audit itself does **not** change GitHub protections. At the time the audit was created, the repository `main` branch was not protected and the public-facing ruleset query returned no configured rulesets. As a result, operational authorization is **not** established.

Before setting `SAVANT_RELEASE_PUBLISH_ENABLED=true`, an administrator must first establish the required branch/tag/environment protections, run this audit successfully, and separately perform the non-production manual workflow UAT under PER-1209: authorized publication, denied approval, conflict/replay, malformed inputs, outage handling, signed attestation verification and rollback. Capture run IDs, digests and the approval trace. Disable publication afterward until explicit production authorization.

A successful CI check for this audit only proves the deterministic checks against test fixtures. It does not certify the real GitHub repository's administrative configuration.

## Live publication gate (PER-1216)

The approved `savant-release` publish job now invokes the same read-only governance auditor **after** the protected-environment gate and **before** verifying the release attestation or invoking `gh release create`. The workflow pins the mode to `SAVANT_GOVERNANCE_MODE=publish`; unlike the default offline audit mode, this verifies that the repository-level publication variable is explicitly `true`. All other seven security controls remain mandatory in both modes.

Configure an environment-scoped secret named `SAVANT_GOVERNANCE_READ_TOKEN` in `savant-release`, using a short-lived, repository-bound, **read-only** fine-grained credential or GitHub App installation token with sufficient GitHub administration-metadata, environment and Actions-variable read permissions. Validate the effective scopes before the first manual run. Do not use an administrative write token or the `contents: write` release publishing token for this inspection. The read-only secret is exposed to the audit step only, never the build/prepare job or the publication command.

The publish job returns a failing result when the secret is missing, the GitHub administration endpoints reject it, the variable is disabled, or branch/tag/reviewer policy has drifted. The CLI emits only fixed boolean controls and stable problem codes. This is a live **just-in-time posture check**, not a substitute for platform-enforced environment approvals or immutable repository rulesets.

For diagnostics while publication remains disabled, omit `SAVANT_GOVERNANCE_MODE` (or set `audit` explicitly). For a controlled release after configuring the protected environment and approving the exact run, the workflow supplies `publish` mode automatically. Invalid modes fail before any API access.

**Required independent non-production validation remains under PER-1209:** confirm the protection settings through GitHub administration, verify a denied environment review cannot access the publication job, attempt a manual release with missing/revoked audit token and with disabled publication, validate signed provenance, then test allowed publication and unchanged/conflicting replay. Do not enable production publication solely because CI passed.
