# PER-1562 — GitHub issuer-pinned maintenance identity (read-only preflight)

## Scope

The previous PER-1560-A PR #98 introduced pure RS256 GitHub Actions OIDC verification, separate Ed25519 signer approval, replay-fenced PostgreSQL state and a bounded internal rewrap adapter. This increment provides its missing concrete **trusted issuer metadata/JWKS retrieval**, **GitHub runner token transport**, and **complete read-only attestation**. Neither increment creates a privileged workflow, exposes a tenant route, provisions KMS, rotates data, or merges to main.

These components require the privileged runner to supply its runtime claims, approved reviewer public key and reviewed expected repository/main identity. `GITHUB_ACTIONS=true`, `GITHUB_REF=main`, and other unverified process variables **are not authentication on their own**. Authorization exists only after the JWT's RS256 signature is checked against an authenticated issuer signing key and its signed repo ID, protected-environment subject, main workflow/ref/SHA, event, run ID, attempt and actor are verified.

## Explicit trust boundaries

1. **Issuer discovery:** request exactly `https://token.actions.githubusercontent.com/.well-known/openid-configuration` via trusted HTTPS. Require issuer equality, exact `jwks_uri=https://token.actions.githubusercontent.com/.well-known/jwks` and advertised RS256 support. Never accept a JWT header's `jku`, `jwk`, `x5u` or arbitrary JWKS URL.
2. **JWKS:** fetch the exact URI with redirect refusal, bounded body and one 5-second deadline across discovery/JWKS. Accept only unique, public 2048+-bit RSA/RS256 signing JWKs. Deny duplicates, private RSA parameters, HMAC/downgrade, untrusted key IDs, malicious certificates, unexpectedly large JSON and stalled reads. Fail closed if key rotation temporarily makes the JWT's KID unavailable; reconcile and retry under a **new** approved run, not by weakening validation.
3. **Workload token:** only a `workflow_dispatch` on `refs/heads/main` from `LATTIX-IO/savant/.github/workflows/crypto-maintenance.yml` can request the fixed `api://savant-crypto-maintenance` audience. The request URL and opaque bearer value come from the privileged GitHub Actions runtime. Reject HTTP, credentials in URL, ports, redirects, foreign hostnames, incomplete response and secret-bearing logs. Token endpoint hostname is limited to GitHub Actions-managed `*.actions.githubusercontent.com`.
4. **Independent authorization:** only an admin-owned `MaintenanceTrustPolicy` can specify the reviewed repo ID/SHA, exact required environment subject, reviewer ID and Ed25519 public key; never take these from a PR payload, user-supplied JSON, tenant input or unverified token header. Require a valid, separate signed approval for the exact run ID/attempt, tenant, target, 1–20-row limit, key ID, restored backup reference/hash and change ticket. This preflight returns only the verified permit; it performs **no database transaction or encryption-key read**. PER-1560-A's PostgreSQL durable replay fence must still be invoked before any later execution.
5. **Network:** hostname validation and native HTTPS checks do not replace runtime-enforced DNS/IP egress controls. Configure an approved minimal DNS/network path to GitHub's issuer and token endpoints in the eventual protected maintenance runner. Do not run this adapter in a tenant-exposed Next.js API handler.

## OIDC subject lifecycle

The Savant GitHub repository ID is `1245790195` (LATTIX-IO owner ID `114814381`); it was created May 21, 2026, before GitHub's July 15, 2026 introduction of immutable-by-default OIDC subject IDs for new repositories. The current verifier's expected legacy environment subject is `repo:LATTIX-IO/savant:environment:savant-crypto-maintenance`. **Do not infer that the current live token necessarily uses legacy format**: an organization/repository may opt in to immutable subjects or configure a custom template. Before activation, the independent administrator must verify the actual `sub` configuration and update the *separately reviewed* trust policy and negative tests if the subject format has changed. Do not simultaneously accept any legacy/new subject as an automatic fallback. In all cases pin numeric `repository_id` and exact protected workflow/ref.

See GitHub's OpenID Connect reference: https://docs.github.com/en/actions/reference/security/oidc

## Automated acceptance

The original unit tests cover malformed issuer discovery, tampered key manifests, same-KID ambiguity, invalid RSA/alg, unbounded bodies, timeouts, redirects, non-HTTPS or foreign token URLs, disallowed GitHub events and workflow ref, short/fake runtime credentials, and JWT signature verified against issuer-derived signing keys.

The end-to-end fixture validates **real RSA signatures** issued by a synthetic GitHub issuer and a distinct Ed25519 review signature, correct runner/run/tenant/backup attribution, preview-only result, and early failure before networking when the trusted repository ID or commit changes. These are deterministic tests of the adapter, **not evidence of real GitHub OIDC issuance or protected environment approval**.

Run in an isolated, dependency-installed workspace:

```sh
node --test --experimental-strip-types apps/web/src/server/security/crypto-maintenance-oidc-runtime.test.ts
pnpm test
pnpm lint
pnpm typecheck
pnpm run security:secrets
pnpm audit --prod --audit-level high
pnpm build
```

### Operational blockers

- PER-1455: no active `main` branch protection, no independent review enforcement, and no live release rulesets.
- PER-1558: protected phase-two dependency-audit ruleset pending approved integration.
- PER-1556 / PER-1426: no protected staging environment, original/managed v1+v2 keys or KMS-backed restore drill.
- PER-1560 execution phase: no separately reviewed and protected `crypto-maintenance.yml` workflow, no verified reviewer public key rotation/control plane, no real tenant-restricted database role or key escrow attestation adapters. This increment **does not** create or enable any privileged workflow.

Keep both PER-1560-A PR #98 and the PER-1562 adapter PR in draft until independent review and live administrative controls exist. Do not claim authenticated real production/staging maintenance from these synthetic tests.
