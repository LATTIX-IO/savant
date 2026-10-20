# UX-01 — Real authenticated application acceptance

**Scope:** `apps/web` Overview → Library → Git Workbench on an **isolated staging host**, with the actual Auth0 session, server-selected tenant membership, real workspace skills and Git proposal eligibility. This script does **not** fake an identity, API response, skill or evaluation, and does not submit a Git proposal. A successful Next.js build or Vercel READY preview is not an authenticated browser test.

## Preconditions

1. Deploy the exact PR #73 head to a dedicated, non-production, access-controlled Vercel staging environment. Use its own Auth0 callback/origin configuration and safe staging identity/database. Do not inherit production secrets or blindly apply production database migrations.
2. On staging, set `SAVANT_UI_V2_ENABLED=true` and `SAVANT_UI_V2_WORKSPACES=tenant-a,tenant-b`. Neither flag grants membership. The two tenants must be genuinely accessible to the test identity; `tenant-denied` must be unauthorized.
3. Seed tenant A with an indexed Git source skill that supports review proposals. Its UUID must be stable; the source `SKILL.md` must be readable/editable by the authorized test identity, with approval still required. Tenant B must **not** contain that skill.
4. The operator signs in through real Auth0 in an approved local Playwright browser, saves `storageState` to an absolute path **outside the repository**, restricts its file permissions and treats it as a credential. Never commit, print, upload to public Actions artifacts, or send the state file through a PR.
5. Install a pinned Playwright version in the authorized operator runtime and its Chromium dependency. Supply the location with `PLAYWRIGHT_MODULE`; do not add browser credentials to untrusted PR workflows.

## Execute

Example environment variable names (replace with **actual authorized staging** fixture identifiers):

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

The runner refuses production domains, plaintext HTTP, tenant aliasing, missing/unscoped browser cookies, repository-local storage state and unsupported skill IDs. It fails when staging has no genuine v2 shell, indexed authorized skill or eligible pending-review Git workflow. It exercises eight responsive/theme combinations (390, 768, 1280, 1440 × light/dark), real navigation, editor draft/review without submitting, overflow and client exceptions, tenant switch A→B, denial of an A-only skill in B and complete denial of tenant C.

Screenshots are placed in a unique **local-only system temporary directory** and may contain private source/workspace data. Never upload them as public workflow artifacts. The script does not log cookie material or Markdown contents.

## Separate acceptance beyond this runner

- Verify a deliberately staged 403/409/503 via real backend denial, concurrent Git source edit, and service unavailability; do not treat mocked Playwright `route.fulfill` responses as real provider acceptance.
- Verify one approved review-only Git proposal in a separate disposable staging repository with audited Git branch/revision protections and explicit operator authorization.
- Independently inspect keyboard focus, screen-reader landmarks, low vision/contrast and reduced-motion behavior for WCAG 2.2 AA, then record defects and remediation.
- Require current-head GitHub Node/TS/lint/build/DB/secret scan/high-critical dependency audit, READY preview, **active protected main**, deployment rollback evidence, and staging authorization before merging or enabling v2 by default.

**Never write a production database migration or enable `SAVANT_UI_V2_WORKSPACES=*` as part of acceptance.** Real staging KMS/DB and provider billing/recovery are tracked under PER-1556/PER-1421. This workflow is UX-01's browser gate, not those separate release gates.
