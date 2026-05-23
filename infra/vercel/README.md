# `infra/vercel`

Vercel-specific configuration, deployment notes, and runtime-assessment artifacts.

## Included now

- `runtime-assessment/` — the Rust vs Python comparison kit for Vercel-hosted backend workloads

Use this directory to keep deployment-target concerns close to the infrastructure assumptions they depend on.

## Production env checklist for `apps/web`

Set these variables in the Vercel project settings for the environments you actually deploy (`Production`, and `Preview` if you expect preview auth to work):

- `AUTH0_DOMAIN` or `AUTH0_ISSUER_BASE_URL`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_SECRET`
- `APP_BASE_URL`
- `DATABASE_URL`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- optionally `STRIPE_PRICE_ID_MONTHLY`
- optionally `STRIPE_PRICE_ID_YEARLY`

For full feature readiness beyond sign-in, you should also set:

- `AI_CONNECTION_ENCRYPTION_KEY`
- `REPOSITORY_WEBHOOK_SECRET`
- `GITHUB_WRITE_TOKEN` (or whichever provider credential refs your connected repositories expect)

Savant can also normalize these fallback values if your deployment currently exposes them instead of the server-side names:

- `AUTH0_BASE_URL`
- `NEXT_PUBLIC_AUTH0_DOMAIN`
- `NEXT_PUBLIC_AUTH0_ISSUER_BASE_URL`
- `NEXT_PUBLIC_AUTH0_CLIENT_ID`
- `NEXT_PUBLIC_APP_URL`
- `VERCEL_PROJECT_PRODUCTION_URL`
- `VERCEL_URL`

## Auth0 application settings

For the production domain `https://savantrepo.com`, configure the Auth0 Regular Web Application with:

- Allowed Callback URLs: `https://savantrepo.com/auth/callback`
- Allowed Logout URLs: `https://savantrepo.com/`
- Application Type: `Regular Web Application`
- Token Endpoint Authentication Method: `client_secret_post`

If you want Vercel preview deployments to support live login too, add each preview origin to the Auth0 Allowed Callback URLs and Allowed Logout URLs. If you do not register a preview origin, Auth0 will reject the callback even when the env vars are otherwise correct.

## Deployment notes

- Postgres on Vercel is now provisioned through Marketplace integrations (for example Neon), not the retired native `Vercel Postgres` product.
- The linked `savant-web` project can provision a production database with:
	- `pnpm dlx vercel@latest integration add neon --name savant-production --plan free_v3 -e production -m region=iad1 -m auth=false`
- After the Marketplace resource injects `DATABASE_URL`, apply Savant's schema with:
	- `pnpm db:migrate`
- Prefer a separate preview database instead of connecting preview deployments to the production database.

- Set env vars in the Vercel dashboard, then redeploy. Existing deployments do not retroactively pick up newly-added secrets.
- Keep `APP_BASE_URL` aligned with the actual deployed browser origin for the environment you are testing.
- Visit `/auth-status` after each deploy to confirm Auth0 readiness, discovery reachability, callback/logout URL resolution, and onboarding prerequisites.
- If `/auth-status` shows sign-in blockers, fix those before debugging Stripe or onboarding.
- If sign-in is ready but onboarding is blocked, focus on `DATABASE_URL`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`.
- For the current deployment, `AUTH0_*`, `APP_BASE_URL`, and `DATABASE_URL` are in place for production, but checkout/onboarding still requires real Stripe secrets before the app is fully user-ready.
