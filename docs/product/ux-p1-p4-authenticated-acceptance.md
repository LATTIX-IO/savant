# UX-01 — Real authenticated application acceptance

**Scope:** `apps/web` Overview → Library → Git Workbench on an **isolated staging host by default or explicitly owner-authorized read-only production pilot**, with the actual Auth0 session, server-selected tenant membership, real workspace skills and Git proposal eligibility. This script does **not** fake an identity, API response, skill or evaluation, and does not submit a Git proposal. A successful Next.js build or Vercel READY preview is not an authenticated browser test.

## Preconditions

1. Merge the qualified PR #73 runtime source with the v2 server flag default OFF. For traditional staging, use a separate protected Vercel origin/Auth0 identity/database; for the single-owner/no-customer MVP, use **the current READY production deployment after source merge** and selectively enable v2 only for the existing authorized **synthetic workspaces**. Do not invoke any database migration as part of this UI journey.
2. In the selected environment only, set `SAVANT_UI_V2_ENABLED=true` and `SAVANT_UI_V2_WORKSPACES=<two explicitly known synthetic slugs>`. Neither flag grants membership. The two organizations must be genuinely accessible to the authorized owner identity; a third must be unauthorized. Do not use `*` or enable default-on.
3. Seed tenant A with an indexed Git source skill that supports review proposals. Its UUID must be stable; the source `SKILL.md` must be readable/editable by the authorized test identity, with approval still required. Tenant B must **not** contain that skill.
4. The operator signs in through real Auth0 in an approved local Playwright browser, saves `storageState` to an absolute path **outside the repository**, restricts its file permissions and treats it as a credential. Never commit, print, upload to public Actions artifacts, or send the state file through a PR.
5. Install a pinned Playwright version in the authorized operator runtime and its Chromium dependency. Supply the location with `PLAYWRIGHT_MODULE`; do not add browser credentials to untrusted PR workflows.

## Execute

Default staging example (replace with actual authorized fixture identifiers):

```sh
export SAVANT_UAT_BASE_URL=https://staging.example.org/
export SAVANT_UAT_STORAGE_STATE=/private/path/authenticated-playwright-state.json
export SAVANT_UAT_WORKSPACE_A=tenant-a
export SAVANT_UAT_WORKSPACE_B=tenant-b
export SAVANT_UAT_WORKSPACE_DENIED=tenant-denied
export SAVANT_UAT_SKILL_UUID=00000000-0000-4000-8000-000000000001
export PLAYWRIGHT_MODULE=/absolute/path/to/playwright
node apps/web/scripts/ux-v2-authenticated-acceptance.cjs
```

For the **sole-owner, read-only production pilot**, substitute `SAVANT_UAT_BASE_URL=https://savantskills.app/` (or another explicitly allowlisted, actual production host) and add both `SAVANT_UAT_OWNER_PRODUCTION_ACK=OWNER-READONLY-PRODUCTION-SYNTHETIC-UX` and `SAVANT_UAT_SYNTHETIC_TENANTS=true`. These are explicit local confirmations, not proof that the tenant data is synthetic. The operator must verify that all three workspace slugs and the indexed Git skill are owned testing fixtures. The runner deliberately **does not click Submit/Create change proposal**, write provider state, or alter a database. It creates local-only screenshots that may contain real tenant data; never upload them to public CI or send credentials to chat. If this exact opt-in is missing, known production domains are refused; unknown subdomains remain refused.

The runner refuses unacknowledged production domains, plaintext HTTP, tenant aliasing, missing/unscoped browser cookies, repository-local storage state and unsupported skill IDs. It fails when staging has no genuine v2 shell, indexed authorized skill or eligible pending-review Git workflow. It exercises eight responsive/theme combinations (390, 768, 1280, 1440 × light/dark), real navigation, editor draft/review without submitting, overflow and client exceptions, tenant switch A→B, denial of an A-only skill in B and complete denial of tenant C.

Screenshots are placed in a unique **local-only system temporary directory** and may contain private source/workspace data. Never upload them as public workflow artifacts. The script does not log cookie material or Markdown contents.

## Separate acceptance beyond this runner

- Verify a deliberately staged 403/409/503 via real backend denial, concurrent Git source edit, and service unavailability; do not treat mocked Playwright `route.fulfill` responses as real provider acceptance.
- Verify one approved review-only Git proposal in a separate disposable staging repository with audited Git branch/revision protections and explicit operator authorization.
- Independently inspect keyboard focus, screen-reader landmarks, low vision/contrast and reduced-motion behavior for WCAG 2.2 AA, then record defects and remediation.
- Require current-head GitHub Node/TS/lint/build/DB/secret scan/high-critical dependency audit and READY preview for a source-only merge. The sole owner may accept a fully qualified merge; do not claim GitHub protection while live rulesets are absent. Before **enabling v2**, require observed authenticated synthetic-owner browser results, server allowlist/kill-switch and deployment rollback evidence. Full protected staging remains post-pilot hardening.

**Never write a production database migration or enable `SAVANT_UI_V2_WORKSPACES=*` as part of this UX acceptance.** Test Bench database/key activation is separately gated by PER-1592/PER-1421; full staging KMS/DB rehearsal is deferred to PER-1556/PER-1589. A source merge is not default v2 enablement or evidence of production Test Bench readiness.


## UX-07 extension — complete v2 navigation UAT (source-qualification only)

The same operator-injected authenticated browser script now additionally navigates all five remaining
route surfaces, completing the six primary workspaces and two administration areas:
`/evaluations` (Savant Test Bench lifecycle, Suites/Datasets),
`/runs` (tenant-owned persisted case inspector),
`/intelligence` (Compare/Releases/Portfolio),
`/router` (Integrations source/models/agent clients/distribution/setup),
and `/settings` (General, Members, Access, Policies, Audit, Billing).
It checks native command-palette Ctrl+K / Escape, one active navigation landmark and viewport overflow.
The existing Library/Workbench draft remains **unsubmitted** and scope A/B/denied C tests remain.

The updated runner takes screenshots to a local private temporary directory only. This source
change does **not** supply an Auth0 session, preprovision three synthetic organizations, make
a verified backend response, confirm a billed provider receipt, or establish WCAG 2.2 AA compliance.
It must be run by the owner against the actual READY production revision after UX-03..06 are deployed.
Then record the exact SHA/host/tenant aliases, per-viewport screenshot manifests, WCAG review and
read-only HTTP denial evidence in private acceptance records. No credential file is ever committed.

Acceptance additionally needs independently observed 401/403/404/409/429/503 and read-after-save
provider Test Bench receipts; a no-write UI pass alone cannot satisfy PER-1421 or UX-08 default cutover.
