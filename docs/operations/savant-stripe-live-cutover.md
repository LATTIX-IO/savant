# Savant: Stripe live merchant cutover (PER-681)

Status: **blocked on Savant Stripe account authorization and live billing acceptance**.

## Ownership and isolation

Lattix Technologies Corp. is the legal merchant; **Savant must use its own Stripe account**. Never copy credentials or product/price IDs from the existing corporate Lattix account or an earlier Connect test sandbox. No secrets are stored in Git.

## Implementation

Production onboarding uses the authenticated POST `/api/billing/checkout` route, which verifies live configuration before invoking Stripe and refuses the legacy embedded pricing table. Checkout verifies the active Stripe account ID and `charges_enabled` as well as both live catalog prices and their USD recurring amounts.

Required **production-only** Vercel settings for `savant-web`:

| Name | Value/source |
| --- | --- |
| `SAVANT_LIVE_CHECKOUT_ENABLED` | `true` **only after all checks are met** |
| `STRIPE_EXPECTED_ACCOUNT_ID` | Savant Stripe `acct_...` (not the Lattix account) |
| `STRIPE_SECRET_KEY` | Savant live restricted/secret key (encrypted) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for **Savant** live webhook (encrypted) |
| `STRIPE_PRICE_ID_MONTHLY` | Savant active recurring USD $1/seat/month |
| `STRIPE_PRICE_ID_YEARLY` | Savant active recurring USD $10/seat/year |

Existing `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID` values may belong to a prior account. They are intentionally not used for production onboarding after this change. Rotate or remove stale credentials once confirmed; do not copy production credentials into `savant-staging`.

Register a Savant live webhook at `https://savantskills.app/api/billing/webhook`. Minimum existing subscriptions lifecycle events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Ensure the URL matches the actual public production hostname and that database schema `0002_onboarding.sql` and subsequent migrations have been applied.

The 14-day trial remains unchanged. The current onboarding flow collects payment information by default during Checkout despite marketing copy suggesting no card requirement. Resolve the intended policy and update copy or Checkout behavior before external launch.

## Remaining release blockers

1. Connect **Savant**, not Lattix, in Stripe integrations and confirm its `acct_` account identity, verification/charges capability, settlement/payout setup, and actual products/prices.
2. Configure production keys and webhook secret through Vercel's protected secret storage. Set `SAVANT_LIVE_CHECKOUT_ENABLED=true` only after acceptance.
3. Complete authorization and entitlement enforcement: current tenant membership is not gated on paid/trialing subscription; billing-state read model is not an access control.
4. Implement tenant-owner-scoped Stripe Customer Portal and cancellation/downgrade UX.
5. Prove webhook replay, reordered events, payment failure, expired trial, tenant isolation, and fresh subscription provisioning with exact-head tests.
6. Run **live** low-value/authorized payment acceptance, refund/cancel cleanup, Stripe Dashboard reconciliation and post-deployment logs before claiming payment readiness.

Security: current webhook uses verified raw-body signatures, but sequence ordering and stale-subscription overwrite still require hardening. Do not enable external customer payments before addressing these controls.

## Recovery

For a suspected merchant mix-up or broken payments, set `SAVANT_LIVE_CHECKOUT_ENABLED=false` (or remove it), redeploy `savant-web` and verify new Checkout sessions return HTTP 503. Do **not** disable the webhook until existing subscriber obligations and event queues have been reconciled.
