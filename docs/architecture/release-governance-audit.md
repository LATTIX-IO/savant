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
