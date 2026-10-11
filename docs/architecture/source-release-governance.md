# Governed source publication (PER-1207)

This increment publishes a **source archive**, not a desktop binary, customer artifact, container, or Vercel deployment. The existing `Release source verification` workflow remains read-only. The separate `Publish governed source release` workflow can only be started manually on `main`.

## One-time administration

Before enabling publication, repository administrators must:

1. Create the `savant-release` GitHub Actions environment with **required reviewers other than the initiating publisher** and **deployment branches restricted to `main`**. Disable self-review. An unprotected newly created GitHub environment is **not** an approval control.
2. Protect `v*` Git tags using a repository ruleset that blocks deletion and updates (tag immutability). Protect `main` with required reviews and CI. GitHub reports `main` as unprotected at the time of this implementation; do not enable publication until protection is configured.
3. Confirm the repository supports Actions artifact attestations and the GitHub `attestations: write` permission. The prepare job must fail if it cannot create a signed provenance attestation.
4. Set the repository Actions variable `SAVANT_RELEASE_PUBLISH_ENABLED=true` **only after** those settings are verified. The default is disabled.
5. Ensure a version tag such as `v0.1.0` **already exists**, resolves to exactly the **current main commit at dispatch** (the same source that passed the quality/security suite), and is reachable from `origin/main`. The package.json in that commit must declare the same version.

The workflow is launched via **Actions → Publish governed source release → Run workflow** on `main`, with the exact `version`, full `commit_sha` equal to the dispatched main SHA, and `confirmation` value `PUBLISH vX.Y.Z`. A tag cannot be created by the workflow. There is no `push`, `workflow_run`, schedule or PR publication trigger.

## Security and test gates

The read-only prepare job performs a frozen install, Node unit/regression tests, lint, typecheck, production build, dependency and committed-secret checks, then verifies exact annotated/lightweight tag-to-commit binding, origin/main ancestry, and tagged package version. It creates a deterministic `git archive` tarball, `SHA256SUMS`, and JSON provenance. GitHub's pinned `actions/attest-build-provenance` signs the archive's subject digest with GitHub-issued identity; the archive bundle is staged through Actions artifacts.

The publish job waits for the protected `savant-release` environment approval. Only that job has `contents: write`; it redownloads the exact job artifact, verifies SHA-256, identity and tag binding again, then queries GitHub releases with the job token. A prior release with matching version and exactly the expected archive digest/size and asset names is treated as verified no-op. Any conflicting release asset, missing digest, wrong version, unexpected file, API/auth outage, or changed tag fails closed. New publishing uses `gh release create --verify-tag` without tag creation; the published release is read back and checked.

**Scope boundary:** the workflow has not been manually invoked against a live tagged non-production release. CI validates its deterministic control logic, not an end-to-end publishing event. The workflow's attestation/publisher steps and environment approvals must receive a separate operational acceptance run before production enablement. An Actions attestation is distinct from GPG/codesign; this increment does not claim source-package signing.

## Reproducibility and recovery

`pnpm test` executes the release guard and publication regression suites. The generated archive bytes derive only from a tagged commit and deterministic gzip settings. Files outside tracked Git are never archived; no user credentials are injected. A failed prepare stage publishes nothing. A failure after GitHub release creation may have committed publication; re-run with the same inputs to verify the existing release. Do not delete or overwrite a release as an automatic retry.

**Rollback / emergency disable:** set `SAVANT_RELEASE_PUBLISH_ENABLED=false` and/or disable the publish workflow. Revert the PR to remove the workflow if necessary. Existing releases and tags remain for incident investigation; remediation requires an explicit signed advisory/revocation workflow, not force-retagging or deletion.

## Remaining acceptance

- Verify main/tag rulesets, environment reviewer policy and repository variable via GitHub administration.
- Validate a deliberately tagged disposable candidate using a separate non-production repository or authorized staging process, including attestation verification, approval denial, replay and outage simulation.
- Validate tagged source archive against independent clean checkout; ensure release is not conflated with Vercel deployment.
