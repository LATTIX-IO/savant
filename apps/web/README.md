# `@savant/web`

Next.js App Router frontend for Savant.

## Current scope

- branded starting point for the admin console and skill catalog
- `src/components`, `src/lib`, `src/hooks`, and `src/styles` scaffolded for product work
- intentionally no dedicated API or worker implementation yet

## Run from the repo root

```bash
pnpm install
pnpm dev
```

Validation commands:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Auth0 setup

This app now uses `@auth0/nextjs-auth0` v4 with Next.js 16 `src/proxy.ts` for server-side session management.

All dashboard routes are protected by default and redirect to `/auth/login` when the user is unauthenticated. The only bypass is true local development on loopback hosts such as `localhost` or `127.0.0.1` while `NODE_ENV=development`.

1. Copy `../../.env.example` into your local `.env.local` (or update the existing one without exposing secrets).
2. Fill in the real `AUTH0_CLIENT_SECRET` and a 64-character hex `AUTH0_SECRET`.
3. Keep `APP_BASE_URL=https://savantrepo.com` unless you add another origin to the Auth0 application's allowed callback/logout URLs.

On Vercel, Savant will fall back to `VERCEL_PROJECT_PRODUCTION_URL` (and then `VERCEL_URL`) when `APP_BASE_URL` is missing, but setting `APP_BASE_URL` explicitly is still the safest production configuration.

If Auth0 is still incomplete in a non-local deployment, Savant now fails closed with a `503` unavailable response instead of a generic internal server error.

The currently configured Auth0 application expects:

- Callback URL: `https://savantrepo.com/auth/callback`
- Logout URL: `https://savantrepo.com/`
- Application type: `regular_web`
- Token endpoint auth method: `client_secret_post`

If you want login to work on `localhost` or a preview URL, register that exact origin in the Auth0 dashboard first; otherwise Auth0 will reject the callback/logout redirect.

## Stripe billing setup

Savant uses hosted Stripe Checkout from `src/app/api/billing/checkout/route.ts`.

For production-ready onboarding, configure a PostgreSQL database first. Apply:

- `db/schema/0001_control_plane.sql`
- `db/schema/0002_onboarding.sql`
- `db/schema/0003_multitenancy.sql`

Then set `DATABASE_URL` for `apps/web`.

1. Open `apps/web/.env.local`.
2. Set `DATABASE_URL` to the PostgreSQL instance that stores control-plane state.
3. Paste your Stripe publishable test key into `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
4. Paste your Stripe secret test key into `STRIPE_SECRET_KEY`.
5. Add `STRIPE_WEBHOOK_SECRET` once you register a webhook endpoint for `/api/billing/webhook`.
6. Set `STRIPE_PRICE_ID_MONTHLY` and `STRIPE_PRICE_ID_YEARLY` to the recurring prices for the single `Savant Seat` product (`$1 / seat / month`, `$10 / seat / year`). If they are omitted, Savant falls back to the same inline recurring pricing.

The hardened onboarding flow now persists drafts, requires Auth0 identity correlation at checkout, provisions the tenant from Stripe webhooks, and syncs the internal tenant id back into Stripe customer/subscription metadata.

For the first production multi-tenant rollout, protected product routes resolve under `https://savantrepo.com/o/{workspaceSlug}`. Root product URLs such as `/dashboard` and `/settings` now act as authenticated entry points that redirect into the user\'s preferred workspace when a tenant membership is available.

Moving from test to live does not require a code change: swap the Stripe keys, the webhook secret, and (if you use Stripe-managed catalog prices) the live monthly/yearly price ids, then redeploy.

If you want Stripe Checkout to return to a local URL during development, set `NEXT_PUBLIC_APP_URL` to your local origin, for example `http://127.0.0.1:3000`.

## Local onboarding sandbox

For local click-through testing without live Auth0 or Stripe, enable the development-only onboarding sandbox in `apps/web/.env.local`:

```bash
ONBOARDING_DEV_SANDBOX=1
ONBOARDING_DEV_SANDBOX_OUTCOME=success
```

Optional overrides:

- `ONBOARDING_SANDBOX_SUBJECT`
- `ONBOARDING_SANDBOX_EMAIL`
- `ONBOARDING_SANDBOX_NAME`

When the sandbox is enabled in `NODE_ENV=development`, onboarding uses a synthetic identity and a simulated hosted checkout redirect so you can click through the full flow locally without external provider callbacks. The real Auth0 + Stripe production path remains unchanged.

The local sandbox can also exercise the new tenant route shell directly after onboarding because tenant pages fall back to a development-only synthetic workspace when `DATABASE_URL` is not configured.

If you want to exercise cancel or error handling locally, set:

- `ONBOARDING_DEV_SANDBOX_OUTCOME=cancel`
- `ONBOARDING_DEV_SANDBOX_OUTCOME=fail`

## Notes

- backend runtime work is deferred pending the Rust vs Python on Vercel assessment
- lightweight control-plane routes can stay in this app until that decision is made
- the source product spec lives in `../../docs/product-specs/spec-core.md`
