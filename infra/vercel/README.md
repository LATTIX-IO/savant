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

For search and AI-engine visibility (see `docs/operations/seo-geo-aeo.md`), set in `Production` only:

- `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`
- `INDEXNOW_KEY`
- optionally `SAVANT_SEO_INDEXING=0` to keep production out of search indexes

Preview deployments are `noindex` automatically.

## Domains and DNS

`savantskills.app` is the canonical domain. It's registered with Vercel and uses Vercel DNS. Set `www.savantskills.app` in Vercel → Domains to redirect to `savantskills.app` with **308 Permanent**. The Vercel default of 307 is temporary and splits ranking signals between hosts.

The previous domain, `savantrepo.com` (and `www.savantrepo.com`), stays attached to the project as an alias:

- **Page requests** on alias hosts get a 308 to the canonical origin. See `apps/web/src/lib/canonical-host.ts`; the alias list is overridable with `SAVANT_REDIRECT_HOSTS`.
- **`/api/*`, `/auth/*` and `/.well-known/*` keep working on every host.** That covers Git provider webhooks and OAuth callbacks, MCP router URLs already configured in AI tools, and the public catalog API.

The canonical origin is `APP_BASE_URL`, which is also the origin Auth0 is configured for. So redirects follow the sign-in configuration and never land users on a host without their session. `NEXT_PUBLIC_APP_URL` and `APP_BASE_URL` take precedence over Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, because Vercel sets that to the *shortest* production domain, which isn't necessarily the canonical one.

**Changing domains.** Do these in order:

1. Add the new callback URLs to Auth0 and to each Git provider app, keeping the old ones.
2. Switch `APP_BASE_URL` and `NEXT_PUBLIC_APP_URL`.
3. Redeploy.
4. Remove the old callbacks once traffic has moved.

## Auth0 application settings

For the production domain `https://savantskills.app`, configure the Auth0 Regular Web Application with:

- Allowed Callback URLs: `https://savantskills.app/auth/callback` (keep `https://savantrepo.com/auth/callback` during the domain migration)
- Allowed Logout URLs: `https://savantskills.app/`
- Allowed Web Origins: `https://savantskills.app`
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
