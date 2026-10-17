# PER-1558 — Two-phase Savant protected-main governance

This runbook covers the gap between GitHub's nine legacy PER-1221 required check contexts on the existing \`main\` commit and the additional, separately blocking **production dependency audit (high/critical)** job introduced by draft PR #95. It does **not** publish a source release, rotate encryption material, authorize provider billing, or promote a Vercel deployment.

## Verified state on 2026-10-17

- \`main\` commit \`80e75b3651afdc5666d60203d24655be390ad7de\`: \`protected=false\`, repository rulesets \`[]\`; all nine legacy required GitHub Actions App contexts are present and successful.
- PR #95 exact tested commit \`c0c5821eceefd46096d130f7da0c0caa7d6d6a18\` has 3/3 green workflow runs including a separate successful \`Blocking production dependency audit (high/critical)\` job; zero high/critical production package advisories. PR remains draft/unmerged. A later head invalidates this cached evidence.
- Vercel \`savant-web\`: no custom staging environment, and required TEST_BENCH_ENCRYPTION_KEY/AI_CONNECTION_ENCRYPTION_KEY entries not provisioned. No production key write, KMS restore or authenticated provider acceptance occurred.
- Connected GitHub App has **no Administration (write)** capability to apply rulesets. Real phases below require an independent authorized operator through a separate trusted administrative session.

## Phase 1: bootstrap existing main before any code merge

1. Have a verified repository administrator and **distinct authorized independent reviewer** participate in an exclusive governance change window. Confirm the organization plan permits rulesets and environment required reviewers, including latest-push approval and required-check App pinning. Ensure any existing bot/Terraform admin automation is paused to avoid GET/PUT races.
2. Run from reviewed, clean, checked-out \`main\`. Do not grant GH_TOKEN to unreviewed PR code. Configure environment variables locally through a credential manager; never paste tokens into chat, CI logs or command history.
3. Set \`GITHUB_REPOSITORY=LATTIX-IO/savant\`, \`SAVANT_RELEASE_OPERATOR_ID\` to the signed-in admin's verified numeric GitHub user ID, and \`SAVANT_RELEASE_REVIEWER_ID\` to a **different** independent GitHub user ID. Set \`SAVANT_RELEASE_REVIEWER_TYPE=User\`. Use a short-lived \`GH_TOKEN\` with Administration (write), Variables (write), and the necessary read rights.
4. Review a zero-write local plan:
   \`node scripts/release-governance-bootstrap.mjs\`
   No external API requests or writes occur in this mode. Validate the repository, nine legacy check contexts, source-App ID 15368, no bypass actors, squash-only approved PRs, non-fast-forward, v* immutable tags, publish=false, and main-only protected savant-release.
5. Only after the dry-run and independent approval, invoke:
   \`node scripts/release-governance-bootstrap.mjs --apply --confirm=PROTECT-LATTIX-IO-savant\`
   This performs all live read checks **before** the first write. On any partial failure, stop and inspect actual controls manually; do not delete or bypass protections to retry.
6. Verify GitHub UI: Settings → Rules → Rulesets, Settings → Environments → savant-release, Settings → Secrets and variables → Actions; independently check force-push denial, reviewer independence, required status checks, and publication disabled. In a trusted local shell with scoped read token, run:
   \`node scripts/release-controls-audit.mjs\`
   This must return \`ready:true\`. A green fixture test does not establish live enforcement.

### Phase 1 limitation

Main currently does **not** have a successful standalone production dependency audit check, so Phase 1's existing nine-context ruleset cannot include the new check while continuing the original script's exact-head verification. Leave the release/publish flag disabled, and do not treat Phase 1 alone as completed security convergence.

## Controlled integration boundary

After Phase 1, obtain independent security/DevOps approval and all currently required exact-head checks on PR #95. Confirm real staging, managed secret recovery and authenticated access risks have been accepted for any deployment triggered by merging main. **Do not merge PR #95 solely because its preview is READY.** The required GitHub workflow is normal squash-only protected PR merge. There must be no temporary ruleset disablement or administrator bypass.

If new code and infrastructure cannot safely be deployed, leave PR #95 draft even after Phase 1.

## Phase 2: enforce standalone dependency audit in main ruleset

Run only after PR #95 is merged under the Phase 1 protections, its new main commit has a completed success for all ten GitHub Actions App ID 15368 required contexts, and all independent authorization controls remain enforced.

On **reviewed** main after that merge, set \`SAVANT_RELEASE_MAIN_SHA\` to the exact live, post-merge **main commit SHA** (not the old #95 feature SHA). Set \`GITHUB_REPOSITORY\`, \`SAVANT_RELEASE_OPERATOR_ID\`, and \`GH_TOKEN\` as above.

A read-only, authenticated preflight:

\`node scripts/release-governance-upgrade.mjs\`

It refuses any missing or spoofed App check, unexpected ruleset, drifted main SHA, absent independent reviewer, release flag enabled, changed protection, or incompatible existing governance. No write occurs without the exact second confirmation:

\`node scripts/release-governance-upgrade.mjs --apply --confirm=ENFORCE-SAVANT-DEPENDENCY-AUDIT\`

This issues exactly one scoped \`PUT /repos/LATTIX-IO/savant/rulesets/{id}\` update to the existing active main branch ruleset; the patch only appends \`Blocking production dependency audit (high/critical)\` pinned to GitHub Actions App 15368. Existing nine contexts, tag controls, review counts, environment policy, publication state and no-bypass rules remain unchanged. It verifies live readback and audit. Running it again returns \`already_verified\` and performs no writes.

The GitHub ruleset endpoint has no compare-and-swap guarantee. The code re-reads the main commit and target ruleset directly before its write, but it cannot eliminate a concurrent change between that read and the PUT. **Exclusive administration and independent review remain mandatory**. Do not automate retries after an unexpected write result. Never delete or weaken protections to resolve a conflict.

## Staging and operational qualification are separate release gates

PER-1556 remains blocked until the staging environment is created with reviewer-controlled access and production secret inheritance prohibited. Distinct Test Bench and BYO encryption keys must be KMS-backed and recoverable, including original v1 material if any historical v1 ciphertext exists. A complete encrypted database+key+application restoration must be independently verified before executing PER-1555 rewrap against real staging state. Preserve request HMAC replay semantics; do not retire original key material until all historical compatibility and retention requirements are proven.

Provider NIM production licensing and TypeSafe account-specific billing evidence (PER-1552/1553) remain separate. No real encryption material, GitHub admin token, production invoice or database contents belong in this PR or Linear comments.

## Test evidence required for this increment

\`node --test scripts/release-governance-upgrade.test.mjs scripts/release-governance-bootstrap.test.mjs scripts/release-controls-audit.test.mjs scripts/release-live-governance-gate.test.mjs\`

Pass all unit/security regressions plus the standard exact-head Node, lint, TypeScript, Next build, committed-secret scan, blocking dependency audit, PostgreSQL migrations twice and tenant checks, Vercel preview and independent reviewer approval. **Synthetic fixtures test the upgrade algorithm, not live GitHub ruleset enforcement.**
