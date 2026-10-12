# Independent source-release UAT verification — PER-1291

This operator-only verifier checks a **previously published, authorized non-production** Savant GitHub source release. It does not create releases, push tags, dispatch workflows, enable publication, or modify repository security settings. It complements the existing local Git rehearsal and the protected publishing workflow.

## Preconditions

The repository's `main` and `v*` tags must already be protected, the `savant-release` environment must have required independent reviewers, and an administrator must have explicitly authorized a disposable, existing source release. Until PER-1209's administrative changes and manual publication occur, no live evidence can exist, and this script should fail as `release_not_published`.

Use a clean local clone of `LATTIX-IO/savant` with full Git history, version tags and current `origin/main` refs. For the controlled publication, collect the exact `vX.Y.Z` tag, 40-character main commit SHA and release workflow run ID from GitHub Actions. The evidence tool requires those exact values; it does not guess the newest release.

```bash
git fetch origin main --tags
export GITHUB_REPOSITORY=LATTIX-IO/savant
export SAVANT_EVIDENCE_VERSION=v0.1.0
export SAVANT_EVIDENCE_COMMIT=<exact-40-character-tagged-sha>
export SAVANT_EVIDENCE_RUN_ID=<approved-release-workflow-run-id>
read -r -s -p 'Read-only GitHub token: ' GH_TOKEN
printf '\n'
export GH_TOKEN
node scripts/release-uat-evidence.mjs > savant-uat-verification.json
```

Use the installed GitHub CLI `gh` and Node 24. Keep `GH_TOKEN` out of shell arguments, Git history and logs. The downloaded assets are stored in a unique temporary directory and removed immediately afterward; only a sanitized evidence verdict is printed.

## Independent checks

The verifier rejects malformed versions, unexpected repositories, wrong commit/run IDs, missing tags, incorrect package versions, or tags not reachable from `origin/main`. It separately queries the **current remote Git tag reference**, resolving direct and annotated tags with bounded depth and rejecting mismatched, missing or cyclic refs. This prevents a stale local tag from being accepted as a live tag binding. It looks up the *exact versioned GitHub Release* before downloading and requires a finalized (not draft) release with exactly three assets: `savant-vX.Y.Z.tar.gz`, `SHA256SUMS`, and `release-provenance.json`. Asset names, sizes and SHA-256 metadata must be complete and within bounds.

It uses read-only `gh release download` for the exact tag, validates each downloaded asset as a regular bounded file, recomputes archive and metadata SHA-256, and compares the complete asset digest set against GitHub's REST metadata. Before accepting the release as published, it checks the authenticated GitHub Actions workflow run and its jobs: the run must be a successful completed `workflow_dispatch` of `publish-source-release.yml` on `main` for the requested commit, and both the prepare and **protected publish** jobs must have succeeded. When GitHub exposes the workflow_dispatch inputs in its run metadata, the version, exact commit SHA, and confirmation must match the requested release. GitHub can omit inputs from this API response; in that case, the version binding is established by the exact downloaded source manifest and remote asset digests, not by the workflow-run metadata alone. Denied/skipped publishing or a run with a different SHA cannot pass.

It then calls `gh attestation verify` with the exact artifact, `--repo LATTIX-IO/savant`, `--source-digest` and `--source-ref refs/heads/main`, with the signer restricted to `github.com/LATTIX-IO/savant/.github/workflows/publish-source-release.yml`, default SLSA v1 provenance and no self-hosted runners. Both the CLI's cryptographic verification **and** its JSON statement's subject SHA-256 must succeed. The cryptographically verified certificate's `runInvocationURI` must also identify the **same requested workflow run ID** and a valid run attempt, preventing use of a different run's attestation for an identical source commit. This is not inferred from the unsigned release manifest.

The output includes a versioned `savant.release-uat-evidence.v2` schema, release reference, source SHA, run ID, three artifact digests and eight boolean checks. No token, raw certificate, private reviewer identity or GitHub error response is emitted. A failed prerequisite causes a nonzero process exit with a stable error code.

## Security and acceptance boundaries

The local unit/regression tests use temporary, fixture-generated source bundles and stubbed GitHub/gh responses; **they do not demonstrate a live signed release**. The `gh` command's successful signature verification is necessary but not sufficient for the overall PER-1209 acceptance. Also capture independent GitHub Actions evidence for successful required environment approval, an unauthorized approval denial, governance App permissions, failed wrong-ref/tag/confirmation attempts, idempotent replay, concurrent/conflicting release handling, emergency flag disable, and no unintended Vercel deployment.

Do not set `SAVANT_RELEASE_PUBLISH_ENABLED=true` solely to run the verifier. The publishing operator must disable it again immediately after the authorized non-production run, and the separate audit must confirm that state. Existing tags and releases should not be deleted or overwritten to correct an acceptance failure.

Run local tests with `node --test scripts/release-uat-evidence.test.mjs` or the complete `pnpm test` suite. Fix any finding through a reviewed PR rather than relaxing the verifier's trust or signer restrictions.

## Independent release approval history (PER-1369)

The verifier now reads GitHub's `GET /repos/LATTIX-IO/savant/actions/runs/{run_id}/approvals` endpoint using the same **read-only Actions credential** already required for run/job evidence. <https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run>. The check requires a single successful approval record for the exact `savant-release` environment from a verified human User ID that differs from both the initiating `actor` and `triggering_actor`. Denied, skipped, pending, self-approved, missing, duplicate, mixed-environment, malformed or paginated history fails closed. The report exposes only the boolean `independentEnvironmentApproval`, never the reviewer ID.

GitHub approval history is scoped to a workflow run rather than unequivocally to an individual rerun attempt. Therefore **only `run_attempt=1` is accepted**. A rerun, absent attempt number, or signed attestation from `/attempts/2` cannot satisfy this evidence contract. Start a new authorized, independently approved workflow run instead of reusing an earlier approval. The attestation certificate must bind to the exact `/actions/runs/{run_id}/attempts/1` URI.

The evidence schema was incremented from `v1` to `v2`; consumers must explicitly handle the new `independentEnvironmentApproval` check and updated version rather than assume compatibility. This proves an independent approval event **for the audited run**, but not that historical environment ruleset settings were correctly configured at approval time. Verify the actual `main`/tag rulesets, independent reviewer configuration, and authorization through the separate PER-1209 administrator audit and controlled negative test. No GitHub approval was executed by this implementation.
