# Source-release acceptance matrix — PER-1371

This command combines **live, read-only evidence** for the source-release requirements already implemented in Savant. It is deliberately **not** a publisher or repository policy setup tool. It cannot authorize a release by itself.

## Preconditions

PER-1209's operational prerequisites must be configured by a repository administrator: protected `main`, active no-bypass `v*` tag protections, independent approval in `savant-release`, and audited release App permissions. An authorized operator must separately execute one successful non-production release and two distinct blocked manual attempts:

1. Successful source release with independently approved environment (`PER-1291` and `PER-1369`).
2. Rejected source preflight (`PER-1370`, `preflight_denied`).
3. Rejected protected-environment approval (`PER-1370`, `approval_denied`).

Use **three different version tags and three different GitHub Actions run IDs**. Version collisions invalidate release-by-tag absence evidence. Do not reuse a failed attempt for multiple scenarios or replace real attempts with static JSON fixture files.

## Run against live GitHub evidence

Use a clean local clone with `origin/main`, the successfully published version tag and its Git history. The verifier uses Node 24, Git and the GitHub CLI.

```sh
git fetch origin main --tags

export GITHUB_REPOSITORY=LATTIX-IO/savant
export SAVANT_ACCEPT_SUCCESS_VERSION=v0.1.0
export SAVANT_ACCEPT_SUCCESS_COMMIT=<published-source-40-char-commit>
export SAVANT_ACCEPT_SUCCESS_RUN_ID=<approved-successful-run>

export SAVANT_ACCEPT_PREFLIGHT_VERSION=v0.1.1
export SAVANT_ACCEPT_PREFLIGHT_COMMIT=<rejected-preflight-40-char-commit>
export SAVANT_ACCEPT_PREFLIGHT_RUN_ID=<rejected-preflight-run>

export SAVANT_ACCEPT_DENIAL_VERSION=v0.1.2
export SAVANT_ACCEPT_DENIAL_COMMIT=<rejected-environment-40-char-commit>
export SAVANT_ACCEPT_DENIAL_RUN_ID=<rejected-environment-run>

# Two independently provisioned credentials; do not commit or echo their values.
export GH_TOKEN=<short-lived-releases-and-actions-read-token>
export SAVANT_GOVERNANCE_EVIDENCE_TOKEN=<separate-repo-ruleset-evidence-token>

node scripts/release-acceptance-matrix.mjs > acceptance-evidence.json
```

The UAT version strings above are examples only. Choose authorized disposable versions and provide the actual source SHA and workflow run ID for each. The source-release success script uses read-only `gh release download` and `gh attestation verify`, which independently validate the source archive, checksum manifest, remote release metadata and cryptographically verified workflow signature.

The separate governance credential must have enough GitHub ruleset visibility to expose `bypass_actors` (GitHub requires elevated access for this field, even when the audit only issues GET requests). Do not use the privileged token to publish releases. After UAT, keep `SAVANT_RELEASE_PUBLISH_ENABLED=false`; the matrix invokes the existing live governance audit in **audit** mode and will reject an enabled flag. Never store the privileged credential in a report artifact.

## Gate semantics

The matrix invokes the **existing** PER-1212 governance audit and PER-1291/PER-1369 and PER-1370 live verifiers in series. It will not accept user-supplied JSON reports as the basis for a ready result. It checks the precise version/run/commit identity and full fixed boolean check set of each returned verifier. It also requires the successful release's three correctly named SHA-256-tagged artifacts and denies duplicate versions or workflow IDs.

The output schema is `savant.release-acceptance-matrix.v1`. It includes current disabled-governance posture, the successful release's SHA-256, redacted scenario metadata and six boolean gate results. It does **not** include credentials, review identities, raw GitHub responses or the attestation certificate. A malformed, unavailable or unsuccessful condition yields a stable failure code and a nonzero exit.

The matrix is a **point-in-time observation**, not an authorization to enable source publication, a guarantee against historical rollback, an audit of organization-wide release configuration, or evidence that a release was never deleted. The operator must separately archive signed GitHub run details, administrative change approvals, rejected-workflow logs (to establish denial cause), App installation review, disabled-flag history, conflict/replay tests, concurrency safeguards and a completed PER-1209 operational acceptance record.

## Testing

```sh
node --test scripts/release-acceptance-matrix.test.mjs
```

The Node suite uses injected fixture verifiers for orchestration tests and continues to execute the full standalone verifier tests. Those tests do not perform live GitHub actions. A green CI build alone is **not** live PER-1209 acceptance, and the release flag must not be enabled on the strength of a unit test report.
