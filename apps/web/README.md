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

The currently configured Auth0 application expects:

- Callback URL: `https://savantrepo.com/auth/callback`
- Logout URL: `https://savantrepo.com/`
- Application type: `regular_web`
- Token endpoint auth method: `client_secret_post`

If you want login to work on `localhost` or a preview URL, register that exact origin in the Auth0 dashboard first; otherwise Auth0 will reject the callback/logout redirect.

## Notes

- backend runtime work is deferred pending the Rust vs Python on Vercel assessment
- lightweight control-plane routes can stay in this app until that decision is made
- the source product spec lives in `../../docs/product-specs/spec-core.md`
