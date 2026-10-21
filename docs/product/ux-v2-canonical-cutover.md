# Savant UX-08 — controlled canonical cutover / rollback

**Current decision: HOLD.** UX-00 prototype HTML remains a design reference only.
UX-03..06 source merge is necessary, not sufficient for canonical rollout.
The sole-owner production pilot can continue through the existing server-selected feature flag;
it is not a statement that an end-to-end production Test Bench provider-backed run has succeeded.

## Independent release gates

1. **Source and deployment:** all UX-03..06 PRs merged, exact-head CI green,
   production Vercel READY SHA matches latest main. Keep prior READY deployment ID and source SHA.
2. **Identity & genuine browser:** real Auth0 owner session, 2 distinct owner-accessible
   synthetic tenants A/B and denied C; private local Playwright run of
   `apps/web/scripts/ux-v2-authenticated-acceptance.cjs` for 8 viewport/theme combinations
   and 8 workspaces, including six primary + two administration. No mock identity, client
   fixture route fulfillment, or vendor-provided fake billing.
3. **Security and UX:** tenant A resource denied to B; C denied entirely; backend 401,
   403, 404, 409, 429, 503; focus/Escape, screen reader, WCAG 2.2 AA review, navigation
   Back/Forward and classic deep links. Record defects and owner risk acceptance.
4. **Production Test Bench:** PER-1592 real Neon recovery point restored to isolation,
   production schema migrations witness and separately recoverable encryption keys;
   PER-1421 observed provider cases, bounded admission, genuine token/usage receipts,
   reconciled estimate vs provider charge and negative tenant tests.
5. **Canary scope:** production must have an independently verified readback of
   `SAVANT_UI_V2_ENABLED=true` and an explicit two-slug
   `SAVANT_UI_V2_WORKSPACES=<synthetic-A>,<synthetic-B>`; `*` is not acceptable
   as a synthetic pilot. **As verified on October 20, 2026, production currently
   has `SAVANT_UI_V2_WORKSPACES=*`.** Do not silently change this setting without
   first identifying the real authorized fixture slugs.
6. **Rollback witnessed:** record baseline `SAVANT_UI_V2_ENABLED`,
   `SAVANT_UI_V2_WORKSPACES`, production Vercel deployment and last READY source.
   Test setting `SAVANT_UI_V2_ENABLED=false` with an authorized redeploy and verify
   the original classic tenant journeys. Then restore scoped two-workspace pilot.
   This operator step is separate from any application source PR; do not change
   Vercel flags or billing/provider database automatically.
7. **Explicit owner decision:** maintain versioned, private manifest with genuine
   external receipts, screenshots and hashes; independent review plus owner signoff.

## Read-only readiness command

```sh
export SAVANT_UX_READINESS_RECEIPT=/absolute/private/ux-v2-acceptance.json
export SAVANT_UX_EXPECTED_MAIN_SHA=<40-hex-character-actual-main-sha>
node apps/web/scripts/ux-v2-cutover-readiness.cjs
```

The operator must include a `rollout` object in the private receipt with
`enabled: true`, `workspaces: "synthetic-a,synthetic-b"` and
`deployConfigReadbackVerified: true`, tied to the same three tenant IDs.
Screenshots must be unique private files with unique SHA256 digests;
duplicating one generic capture across multiple screen slots fails closed.

The script checks **declared** coverage/freshness and screenshot SHA256 integrity;
it does not fetch Auth0, GitHub, Vercel, Neon, bank invoices, or evidence from an
independent source. A positive result means REVIEW-ELIGIBLE, **not independently verified**,
not an approval, and never changes production configuration.
The operator must review and corroborate every external field (deployment,
tenant isolation, HTTP denial, accessibility, key recovery and billing).

Never check the private JSON receipt, cookies, screenshots, key material or customer
data into Git/Linear/ChatGPT. Reference screenshots only by local private paths.

## Promotion and emergency rollback

Once all gates pass, manually narrow `SAVANT_UI_V2_WORKSPACES` to the two owner
synthetic tenant slugs, verify release and rollback, and obtain owner signoff.
Only then is an explicit default-on activation eligible. Do not replace Next
routes with prototype HTML, remove classic fallbacks prematurely, or delete
source/receipt history. Emergency recovery is `SAVANT_UI_V2_ENABLED=false`
and redeploy an exact previously READY source; confirm protected tenant routing.
Never claim a rollback happened unless an actual deployment readback proves it.

**At writing:** PER-1592 production schema/key/restore and PER-1421 real provider/cost
evidence remain IN PROGRESS; actual authenticated operator Playwright UAT is not recorded.
Therefore this runbook cannot authorize default-on promotion.
