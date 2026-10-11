# Savant GitHub release governance bootstrap — PER-1221

This command prepares the administrative release protections required by PER-1209. It does **not** create or dispatch a GitHub release, mint a release tag, or enable source publication. It is restricted to `LATTIX-IO/savant` and is **dry-run by default**.

## Prerequisites

Use an operator account with GitHub permission to create repository rulesets, configure protected environments and manage Actions variables. GitHub documents Administration (write) for repository rulesets and deployment environment policies and Variables (write) for the repository publication flag. A reviewer *other than the authenticated operator* is mandatory; obtain the reviewer's numeric GitHub **User** ID. The tool verifies the operator's supplied numeric ID against authenticated `GET /user`; **Team-based automatic apply is refused** because a numeric team ID alone cannot prove the operator is not a member. Team approval must be configured and verified manually. Confirm the organization's plan supports the chosen rules and protected environment reviewers.

The program refuses to apply if `main` is not the default branch, if the existing controls have already been configured, if any required CI context is absent or failed on the latest `main` commit, if the release flag is enabled, or if GitHub administration evidence is missing or paginated. This bootstrap refuses known existing rulesets or environments, but GitHub's `PUT /environments/savant-release` endpoint is a **create-or-update** operation, not an atomic create-only API. If another administrator creates the environment after preflight, the request could overwrite their configuration. The script rechecks the environment immediately before PUT and refuses any newly observed environment. **This does not eliminate the time-of-check/time-of-use race** between that recheck and PUT. Run administrative apply only in an explicitly coordinated maintenance window with exclusive governance change ownership and no competing administrators, bots, or Terraform workflows. Otherwise keep dry-run only and create the environment manually under change control.

## Dry run — no GitHub requests or credentials

```sh
export GITHUB_REPOSITORY=LATTIX-IO/savant
export SAVANT_RELEASE_OPERATOR_ID=12345
export SAVANT_RELEASE_REVIEWER_ID=67890
export SAVANT_RELEASE_REVIEWER_TYPE=User
node scripts/release-governance-bootstrap.mjs
```

The tool renders the five proposed REST operations: create an explicitly disabled publication variable (if missing); create a main ruleset requiring squash-only PR reviews, latest-push approval, stale approval dismissal, review-thread resolution, required unit/security/tenant/submodule/platform checks, and no force push; create an immutable `v*` tag ruleset without bypass actors; create `savant-release` with self-review prevented and the named independent reviewer; and restrict deployments to exactly `main`.

**Validate** the reviewer ID and the nine required CI job context names before applying. Requiring review can restrict merging until a second authorized person is available. If GitHub reports an API validation or licensing error, stop and reconcile manually rather than weakening rules.

## Explicit administrative apply

Only after reviewing the dry-run JSON and confirming necessary approvals, obtain an authenticated GitHub token with Administration (write), Variables (write), and suitable read access for repository checks and release environments. Provide it as `GH_TOKEN` in the local process environment; do not place the token in CLI arguments, check it into Git or paste logs containing it.

```sh
node scripts/release-governance-bootstrap.mjs --apply --confirm=PROTECT-LATTIX-IO-savant
```

The exact two arguments are required. Apply first inspects the live repo, branch SHA and completed required CI checks, existing rulesets, publication variable and environment. **There are zero writes until every preflight check passes.** Writes proceed in dependency order, always keeping `SAVANT_RELEASE_PUBLISH_ENABLED=false`. Before the environment PUT, the script performs an additional GET; if the environment appeared after preflight or the GET returns a permission/network error, it refuses the PUT and reports a partial-apply reconciliation requirement. The GET/PUT pair is not atomic.

After applying, the tool invokes the live read-only `release-controls-audit` in `audit` mode and reports success only if all eight controls pass. Errors expose stable codes only, never credentials, reviewer names, API response text or secret values. The CLI does not retry a failed administrative write.

## Partial failure / emergency handling

GitHub administrative writes are not atomic. In particular, PUT of an environment is create-or-update; prevent concurrent environment creation while the bootstrap applies. If a write fails after earlier steps succeeded, the command reports `partial_apply_requires_manual_reconciliation`. **It does not attempt to delete new protections or declare rollback.** Inspect actual rulesets and the environment in GitHub settings, reconcile manually, and rerun the governance audit. The bootstrap will refuse to overwrite existing controls.

The publication flag must remain false; do not set it true as part of bootstrap. A successful bootstrap prepares the repository for **separate** GitHub App provisioning and supervised non-production manual release acceptance under PER-1209, including denial of self-review, replay, attestation verification, and emergency disable. A green CI run of this script's tests establishes only fixture-backed implementation quality, not that real admin configuration or UAT has occurred.

Reference endpoints: GitHub REST [repository rulesets](https://docs.github.com/en/rest/repos/rules), [deployment environments](https://docs.github.com/en/rest/deployments/environments), [deployment branch policies](https://docs.github.com/en/rest/deployments/branch-policies), and [Actions variables](https://docs.github.com/en/rest/actions/variables).

**Identity and status provenance:** Each required check must be a completed success generated by the `github-actions` App (ID `15368`), and the ruleset records the same `integration_id` so another writer cannot spoof a required status by name. The apply preflight requires an authenticated user identity from `GET /user`; a GitHub App installation token that cannot supply this identity will fail closed. Use a short-lived, user-scoped administrative credential for this bootstrap, separate from the dedicated runtime App used by the release audit. Never substitute a team ID for an independent reviewer without manually verifying its membership.
