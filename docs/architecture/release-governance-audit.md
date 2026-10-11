# Release Governance Audit — PER-1212

Savant source publication is disabled by default. The operational audit is a **read-only, fail-closed** check of configured GitHub controls. It does not create a release, change a repository setting, grant permissions, or replace a manual non-production end-to-end acceptance test.

## Operator execution

An authorized repository administrator must use a short-lived credential that can provide **complete** GitHub ruleset evidence, including `bypass_actors`, and can read the `savant-release` environment, deployment-branch policies, and Actions variables. **GitHub omits `bypass_actors` unless the caller has ruleset write access.** A read-only GitHub token cannot prove the no-bypass requirement; the audit will fail closed rather than treating missing evidence as an empty bypass list. Use a dedicated GitHub App installation token with the minimum required ruleset administration permission, not a personal access token. The auditor itself makes only GET requests, but the credential can carry administrative write authority and must be handled as privileged.

```bash
export GITHUB_REPOSITORY=LATTIX-IO/savant
export GH_TOKEN=<ephemeral, repository-scoped ruleset-evidence token>
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

Create a dedicated GitHub App installed **only on the Savant repository**, with repository Administration (write), Actions (read), and Environments (read) permissions. GitHub's ruleset API requires ruleset write authority to reveal `bypass_actors` even for a GET; if organization-owned rulesets are applicable, separately verify whether they are visible with the App and fail closed if not. Place `SAVANT_GOVERNANCE_APP_CLIENT_ID` as an environment-level variable and `SAVANT_GOVERNANCE_APP_PRIVATE_KEY` as an environment-level secret in the protected `savant-release` environment. Do not expose either to the prepare job.

After independent environment approval, the SHA-pinned first-party `actions/create-github-app-token` action mints a short-lived, single-repository installation token with **Administration (write)**, Actions (read), and Environments (read). The token is accessible only to the GET-only governance audit step; it is not passed to `gh release create` and is revoked by the action's job cleanup. The regular `contents: write` release token remains separate. Although API usage is GET-only, compromising this privileged token could allow ruleset changes; use strict environment approval, repository-restricted App installation, key rotation, and keep publishing disabled unless this elevated verification mechanism is explicitly accepted. An audit with omitted `bypass_actors` must never pass.

The publish job returns a failing result when the secret is missing, the GitHub administration endpoints reject it, the variable is disabled, or branch/tag/reviewer policy has drifted. The CLI emits only fixed boolean controls and stable problem codes. This is a live **just-in-time posture check**, not a substitute for platform-enforced environment approvals or immutable repository rulesets.

For diagnostics while publication remains disabled, omit `SAVANT_GOVERNANCE_MODE` (or set `audit` explicitly). For a controlled release after configuring the protected environment and approving the exact run, the workflow supplies `publish` mode automatically. Invalid modes fail before any API access.

**Required independent non-production validation remains under PER-1209:** confirm the protection settings through GitHub administration, verify a denied environment review cannot access the publication job, attempt a manual release with missing/revoked audit token and with disabled publication, validate signed provenance, then test allowed publication and unchanged/conflicting replay. Do not enable production publication solely because CI passed.
