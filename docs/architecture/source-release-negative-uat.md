# Negative source-release UAT evidence — PER-1370

This tool verifies two **failed** Savant manual release attempts against authenticated GitHub Actions history, without creating a release, editing repository settings or dispatching a workflow. It complements the successful release verifier (`release-uat-evidence.mjs`) and does not replace the supervised operational acceptance of PER-1209.

## Before using

The required main/tag protections, independent `savant-release` approvals and GitHub App controls must be configured and confirmed by an administrator. Conduct separately authorized non-production attempts, then record each exact workflow run ID and requested source tag/SHA. **Do not enable publication merely to run this read-only verifier.** The first run attempt (`run_attempt=1`) is required because protected-environment approval history cannot be reliably attributed to subsequent reruns.

Use a fine-grained short-lived token with only the read permissions necessary for GitHub Actions run/job/approval history and repository release metadata. No token is necessary for automated fixture tests.

```bash
export GITHUB_REPOSITORY=LATTIX-IO/savant
export SAVANT_EVIDENCE_VERSION=v0.1.0
export SAVANT_EVIDENCE_COMMIT=<exact-40-character-commit-sha>
export SAVANT_EVIDENCE_RUN_ID=<failed-workflow-run-id>
export SAVANT_NEGATIVE_SCENARIO=preflight_denied
read -r -s -p "Read-only GitHub token: " GH_TOKEN
printf '\n'
export GH_TOKEN
node scripts/release-negative-uat.mjs > negative-release-uat.json
```

Set `SAVANT_NEGATIVE_SCENARIO=approval_denied` and the corresponding run ID for a rejected protected-environment deployment. The script has no mutation or GitHub CLI dependencies; it sends four GET requests only, all to the fixed Savant repository.

## Proof criteria

The verifier requires an exact `workflow_dispatch` run for `.github/workflows/publish-source-release.yml`, pinned to the requested `main` SHA, with `run_attempt=1`, a completed failure or cancellation, and valid initiating/triggering GitHub identities. The workflow now sets an immutable run title pattern `source-release:<version>:<commit-sha>` from its `workflow_dispatch` inputs. The verifier requires an exact match to the requested version and commit, including when GitHub does not expose dispatch inputs through the REST run response. When dispatch input fields are exposed, the requested version and commit must additionally match. Runs produced before this run-title convention fail closed; create new controlled UAT runs instead of accepting weakly attributed historical evidence. Approval-denial checks additionally require the expected confirmation input when present.

A `preflight_denied` result requires a failed prepare job, no successfully executed publish job, no protected-environment approval history, and no GitHub Release at the requested version. An `approval_denied` result requires successful preparation, unsuccessful/absent publish job, and exactly one **rejected** review from a human User other than either run actor for the `savant-release` environment; the version must also have no GitHub Release.

All read responses are bounded, redirect-free and fail closed on missing permissions, unexpected pagination, incomplete job lists, ambiguity or malformed JSON. The output includes an explicit scenario, run ID, version, commit and five boolean findings. It intentionally omits reviewer identity, credentials and raw GitHub responses. The process exits nonzero if evidence is unavailable or contradictory.

## Interpretation limits

This is a point-in-time, read-only verification that the named version **currently has no GitHub Release** and the named workflow attempt did not complete successful publication. It does **not** prove that the entire organization had no unrelated release or that a release never existed and was deleted. It also does not prove the causal error from logs (for example, that a specific malformed confirmation caused the preflight failure), verify historical environment policy, or provide an audit trail of administrative changes.

For acceptance, retain independently reviewed GitHub run links, human test-case input/expected result, administrator governance audit, protected-environment records, and any release archive hashes from successful UAT. A negative run without actual administrative protection must never be treated as evidence of safe deployment. Approval history returned from GitHub is authenticated but does not replace policy validation.

Run `node --test scripts/release-negative-uat.test.mjs` or the full `pnpm test` CI suite. All fixture tests are simulated: no live GitHub release, tag, workflow dispatch or administrative configuration is performed.
