# Savant live billing — operational runbook (PER-681)

## Merchant and catalog

Legal entity: Lattix Technologies Corp. Customer-facing service: Savant.

- Savant Stripe merchant: `acct_1UUUQuRXtgzihaET` — verified charges and payouts enabled, distinct from the Lattix merchant.
- Live product: `prod_VVVsMOvk4P2oMl` (Savant Seat).
- Monthly: `price_1UUUrERXtgzihaETqV0MC7DF`, USD $1/seat/month.
- Annual: `price_1UUUrGRXtgzihaETyZiLSGlr`, USD $10/seat/year.
- Live webhook: `we_1UUUrMRXtgzihaET9lQ9ZoKG`, `https://savantskills.app/api/billing/webhook`.
- Stripe Customer Portal: `bpc_1UUW8NRXtgzihaETq3pxNZXc`; invoice history, payment method updates, cancel at period end, monthly/annual plan and seat-quantity changes (1–500 seats) enabled.

## Production environment

In Vercel project `savant-web`, **production only**:

| Variable | Value |
| --- | --- |
| `STRIPE_EXPECTED_ACCOUNT_ID` | `acct_1UUUQuRXtgzihaET` |
| `STRIPE_PRICE_ID_MONTHLY` | `price_1UUUrERXtgzihaETqV0MC7DF` |
| `STRIPE_PRICE_ID_YEARLY` | `price_1UUUrGRXtgzihaETyZiLSGlr` |
| `STRIPE_SECRET_KEY` | Sensitive Savant `rk_live_...` (preferred) or `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Sensitive `whsec_...` for the *Savant live webhook* |
| `SAVANT_LIVE_CHECKOUT_ENABLED` | `true` only for authorized live rollout; `false` for immediate checkout kill switch |
| `APP_BASE_URL` | `https://savantskills.app` |
| `DATABASE_URL` | Production PostgreSQL control plane (0001/0002+ migrations applied) |

Never write secrets in this document, GitHub, logs or application responses. The old embedded pricing table and publishable key are excluded from production onboarding to prevent account mixing.

## Restricted API key permissions

Stripe's production key may be restricted. Required operations:

- **Account Read**: `GET /v1/account` to verify the key belongs to Savant, rather than its parent merchant.
- **Prices Read**: fetch and validate both active recurring products and amounts.
- **Checkout Sessions Write**: initiate hosted subscription onboarding.
- **Customers Write**: add verified tenant metadata after checkout.
- **Subscriptions Read + Write**: retrieve current subscription state and attach tenant metadata.
- **Customer Portal Sessions Write**: create short-lived authenticated portal sessions.

No payout, refund, transfer, account creation, Connect, or general unrestricted access is necessary. If one of these checks fails, Checkout fails closed with 503. Verify the key begins `rk_live_`, not `rk_test_`.

## Runtime contract

1. A signed-in user creates a workspace draft. Production Checkout validates the merchant, price catalog, and persistent database **before** creating a session.
2. Stripe-hosted checkout creates a subscription with **14-day trial, no card required**. At trial expiry without a payment method, Stripe cancels the subscription rather than charging without authorization.
3. Stripe posts signed `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted` to `/api/billing/webhook`. The Auth0 proxy permits this route; the handler verifies `stripe-signature` on the raw body, claims event IDs, provisions tenant metadata, and reconciles the *current* subscription state.
4. Newly created tenants are authorized only if the linked live subscription is `trialing` or `active`. Statuses `canceled`, `unpaid`, `past_due`, `paused`, and pending sync fail closed.
5. Previously existing synthetic workspaces created before `2026-10-25T18:00:00Z` with no live billing account remain grandfathered. **This cutoff must not roll forward.** Never permit newly created, unbilled organizations via the legacy exception.
6. Authenticated owners/admins access `POST /api/billing/portal` from Classic or v2 Settings; inactive subscriptions can access `/billing/recover` without bypassing tenant role checks. Customer Portal holds the payment method, invoice and cancellation controls.
7. `GET /api/billing/readiness` is a CDN-cacheable, nonsecret readiness endpoint. 200 means the deployed live key can verify the Savant account and catalog and the billing DB tables exist; 503 means no-go. This does not by itself prove webhook delivery or an actual charged card.

## Acceptance evidence and next checks

- Exact-head Vercel Next.js build, TypeScript, and billing-focused Node tests must pass.
- Production readiness endpoint must return **HTTP 200** after the production environment is activated and redeployed.
- Exercise fresh authenticated onboarding, successful cardless trial, valid webhook processing, tenant association, card addition via portal, recurring invoice and cancellation. Check duplicate/reordered webhook delivery and cross-tenant unauthorized portal access.
- Reconcile actual live payment and refund/cancellation in Savant Stripe (no test cards in live mode). **Do not claim successful live payment acceptance without evidence of a settled live charge.**
- Known follow-up: automated self-service restart of a *fully canceled* subscription is not yet available; the recovery page directs users to support. Subscription portal can manage active/trialing subscriptions and cancel at period end.
- Separately review tax registration / Stripe Tax configuration, customer receipt branding and dispute/support processes before broad public marketing.

## Recovery

To block new paid enrollments quickly, set `SAVANT_LIVE_CHECKOUT_ENABLED=false` in `savant-web` production and redeploy. Do **not** disable the webhook or delete subscription data; existing customers still require webhook reconciliation, portal access and customer support. If a deployment is defective, use a verified Vercel production rollback to the previous working deployment, and inspect runtime logs without revealing keys.
