# PER-1572 — Sole-owner GitHub governance

**Status: code and synthetic tests, not live administration.** Repository scope: LATTIX-IO/savant.

## Scope

The original independent_reviewer profile remains supported unchanged. The new **owner_operated** profile must be selected with CLI arguments, not inferred from environment settings, branch content, or a token.

The owner profile requires a pull request (squash only), zero human review approvals, every review thread resolved, active main deletion and non-fast-forward prevention, no bypass actors and ten successful GitHub Actions App (ID 15368) required status checks with strict freshness (including the standalone high/critical dependency audit). Version tags v* cannot be updated or deleted, and cannot be bypassed. The savant-release environment is main-only with no fictitious human approvers. Source publication is disabled by default and occurs only through the explicit release workflow after version/tag/provenance, dependency and secrets checks.

## Plan — no GitHub API writes

On an authenticated administrator workstation, obtain the current 40-character main SHA and actual numeric owner ID from GitHub. Use the values you independently verified.

~~~powershell
$env:GITHUB_REPOSITORY = 'LATTIX-IO/savant'
$ownerId = '<numeric-owner-id>'
$mainSha = '<40-character-current-main-sha>'
node scripts/release-governance-bootstrap.mjs --profile=owner_operated --owner-id=$ownerId --main-sha=$mainSha --acknowledge=SOLE-OWNER-CI-ENFORCED
~~~

Inspect the six proposed operations and the deterministic planSha256 fingerprint. This hash is an **unsigned checksum**, not a signature or a second-person approval.

The apply preflight performs authenticated /user and exact repo/default-branch/SHA verification; confirms main is presently unprotected, no rulesets or conflicting release environment/profile exist, publication is disabled, and all ten status check runs at that exact SHA have success conclusions from the expected GitHub Actions App. Paginated or incomplete evidence denies the write.

## Apply — exclusive administration window

Only with the verified plan, no main SHA change, a safe deployment rollback candidate and an appropriately scoped GitHub Administration(write) token configured directly in the local process:

~~~powershell
node scripts/release-governance-bootstrap.mjs --profile=owner_operated --owner-id=$ownerId --main-sha=$mainSha --acknowledge=SOLE-OWNER-CI-ENFORCED --apply --confirm=PROTECT-LATTIX-IO-savant-SOLO
~~~

Never print, paste, or commit GH_TOKEN. The procedure writes the disabled publication variable if absent, an explicit owner profile variable, the protected branch/tag rulesets, main-only release environment and exact branch policy. An error after any write means the apply could be **partial**. Do not blindly retry or disable security controls. Inspect live state and reconcile manually.

The apply result records a SHA-256 plan fingerprint and acknowledges sole ownership, but explicitly declares cryptographicOwnerSignatureVerified=false. A signed owner attestation remains additional work if required by the governance acceptance policy.

## Read-only verification

With a GitHub token permitted to read repository ruleset and environment settings:

~~~powershell
$env:SAVANT_RELEASE_GOVERNANCE_PROFILE = 'owner_operated'
node scripts/release-controls-audit.mjs
~~~

A complete active deployment must produce schema savant.owner-governance.audit.v1 and ready=true, with: exact no-bypass pull-request/checks main rules; immutable tag rules; a main-only release environment with no required reviewer; publication state matching the requested mode; and the explicit owner profile variable. Wrong or missing evidence is a failure, not a reason to infer protection.

After setup, prove on **throwaway protected refs** that direct push, force push, branch delete, tag update/delete, stale/synthetic checks and unapproved release all fail. Do not do destructive tests on live default refs. Recording actual GitHub API readback and platform denial results is required; synthetic CI alone is not operational acceptance.

The phase-two upgrader is read-only for owner_operated because ten check contexts are already required at bootstrap. It rejects a privileged owner-mode --apply attempt.

## Deployment and database caveats

GitHub rulesets do **not** disable Vercel automatic production deployment on pushes to main. A separately configured Vercel deployment check, staging production build and manual promotion is still required before calling release deployment protected. The savant-release environment gates source publishing, not Vercel Git integration.

The Vercel production build is now forbidden from automatically mutating database schema. PER-1556 requires isolated Auth0/database staging, distinct managed encryption keys, real encrypted backup and key restoration, rollback and manual authorized db:migrate. PER-1421 requires authenticated baseline/candidate evaluation, reproducible provider results and cost evidence after staging readiness. Do not treat a READY preview as those operational gates.

Linked Linear: PER-1455, PER-1556, PER-1421, PER-1572.
