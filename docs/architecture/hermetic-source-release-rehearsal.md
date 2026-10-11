# Hermetic source-release rehearsal (PER-1220)

This test increment exercises the actual Savant source-release preflight, Git tag verification, Git archive/staging, provenance/checksum validation, and publisher decision code in a **disposable local Git repository**. It does not call GitHub administration APIs, create GitHub tags/releases, approve an environment, or enable publication. It is a prerelease regression gate for the operational acceptance tracked by PER-1209.

## Run the rehearsal

From the Savant root with Node 24 and Git installed:

```sh
node --test scripts/release-rehearsal.test.mjs
```

The regular `pnpm test` suite automatically discovers the file and runs it in CI. Tests create unique temporary directories, initialize a local `main` branch, commit `package.json` and a public payload, create an annotated `v0.1.0` tag and local `refs/remotes/origin/main`, and use the actual `release-preflight.mjs` and `release-stage.mjs` CLI entrypoints. Temporary repositories are deleted in `finally` blocks. No user repository or GitHub token is needed.

The test checks the following independently:

- **Positive execution:** exact tagged SHA, default-branch ref, explicit publication flag/confirmation, valid tracked source payload and archive manifest.
- **Reproducibility:** two independent archives built from the same immutable Git commit have identical tar.gz bytes, checksums and provenance. Untracked `.env.production` and a secret sentinel are absent from extracted entries.
- **Source substitution:** deleted/moved tag, wrong current-run SHA, package-version drift, tag not reachable from `origin/main`, wrong branch and disabled publication all fail.
- **Artifact integrity:** corruption of the actual archive, checksum or provenance, extra untracked staging paths and symlinks are rejected. The shared validator rejects nonregular, linked, empty and oversized staging files before reading them.
- **Publication decisions:** a simulated GitHub 404 permits one mocked `gh release create` followed by remote digest readback; identical replays have zero writes. API authorization/rate-limit/server failures reject before mutation. All external writes are mocked.

## Security and production boundary

This rehearsal is **not a real workflow dispatch**. GitHub branch/tag rulesets, environment approvals, App permissions and identity-based attestations cannot be proven by a local Git fixture or simulated GitHub responses. A green test proves the exercised local code paths, not production readiness.

Do not create staging tags on the actual Savant repository as part of these tests. Do not set `SAVANT_RELEASE_PUBLISH_ENABLED=true` based on this increment. PER-1209 remains open until an administrator configures the required GitHub controls and records authorized non-production manual publication evidence, including denied approval, attestation verification, concurrent replay and emergency disable.

## Failure handling

An assertion failure exits nonzero, blocking the PR CI gate. Tests do not print secrets or token values. The release validator refuses symlinked or hardlinked files, unexpected bundle entries and oversized metadata before computing checksums. If CI shows an environment-specific Git version incompatibility, adjust the fixture without weakening validation of the actual production scripts.
