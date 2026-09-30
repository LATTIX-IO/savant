# `infra/cloudflare`

Cloudflare DNS for `savantskills.app`, which is served by Vercel. `zone.config.json` is the desired state. `apply.mjs` reads the live zone, prints what would change, and applies it only with `--apply`. The planning logic lives in `plan.mjs` and is unit-tested in `plan.test.mjs`.

```bash
CLOUDFLARE_API_TOKEN=... pnpm cloudflare:plan     # dry run
CLOUDFLARE_API_TOKEN=... pnpm cloudflare:apply    # execute
pnpm seo:verify                                   # check what crawlers get afterwards
```

## Current state (checked 2026-09-29)

- `savantskills.app` delegates to **Vercel DNS** (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`), not Cloudflare. No Cloudflare zone is serving it yet, so none of the settings below are live.
- Vercel DNS serves a wildcard, so every subdomain resolves (for example `app.savantskills.app` returns a 404 page). It also serves CAA `letsencrypt.org`, `pki.goog`, and `sectigo.com`. There are no MX or TXT records.
- `www` redirects to the apex with a **307**. A permanent redirect (301/308) is needed so search engines consolidate on the apex.

## Mode: DNS-only (default) vs proxied

`"proxied": false` is the default because Vercel [recommends against](https://vercel.com/docs/security/reverse-proxy) putting a reverse proxy in front of it:

- A proxy hides traffic from Vercel's Firewall and Bot Protection.
- It adds a second CDN hop.
- It can break Let's Encrypt HTTP-01 renewals.

In DNS-only mode Cloudflare is only the authoritative DNS. Vercel still terminates TLS, serves, and caches.

| Feature | DNS-only | Proxied |
| --- | --- | --- |
| Records, CAA | ✓ | ✓ |
| `www` → apex redirect | Vercel → Domains → `www` → *Redirect to* `savantskills.app`, **308** | Cloudflare redirect rule (`redirect` in config) |
| Crawler Hints (IndexNow on cache changes) | — (use `pnpm seo:indexnow` after deploys) | ✓ |
| Bot settings below | Stored; take effect if the proxy is turned on later | Active |

Set `"proxied": true` only if you want Cloudflare's edge features. In that case, keep `ssl: strict`, keep `always_use_https: off` (Vercel already redirects, and a port-80 redirect can intercept `/.well-known/acme-challenge/`), and keep Bot Fight Mode off.

## AI crawlers (GEO/AEO)

Cloudflare can block AI crawlers on new zones, and its **managed robots.txt** prepends `Disallow` groups for GPTBot, ClaudeBot, and others in front of ours. Either one removes Savant from ChatGPT search, Claude, Perplexity, and similar answer engines. `botManagement` in the config pins these settings:

| Field | Value | Why |
| --- | --- | --- |
| `ai_bots_protection` | `disabled` | "Block AI bots" off |
| `is_robots_txt_managed` | `false` | Next.js serves `robots.txt` with `Content-Signal: search=yes, ai-input=yes, ai-train=yes` |
| `bot_preference_sync_enabled` | `false` | Cloudflare does not rewrite robots.txt from dashboard toggles |
| `crawler_protection` | `disabled` | AI Labyrinth off |
| `fight_mode` | `false` | Bot Fight Mode can challenge verified crawlers and ACME |

The daily `.github/workflows/seo-verify.yml` job fetches the site as Googlebot, Bingbot, OAI-SearchBot, GPTBot, ClaudeBot, and PerplexityBot. It fails if any of them is blocked or challenged, or if robots.txt gains a site-wide `Disallow`.

## API token

Create a custom token scoped to the `savantskills.app` zone with:

- Zone → Zone → Read
- Zone → DNS → Edit
- Zone → Zone Settings → Edit
- Zone → Bot Management → Edit
- Zone → Single Redirect → Edit (proxied mode only)
- Account → Zone → Edit (only for `--create-zone`; drop it afterwards)

Store it as a local env var or a CI secret. Never commit it.

## Cutover runbook: Vercel DNS → Cloudflare DNS

1. **Confirm the Vercel targets.** In Vercel → project → Settings → Domains, open `savantskills.app` and `www.savantskills.app` and note the A value and CNAME target they recommend for external DNS. If they differ from `76.76.21.21` / `cname.vercel-dns.com`, update `zone.config.json`.
2. **Create the zone and records.** Run `CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node infra/cloudflare/apply.mjs --create-zone`, review the plan, then add `--apply`. Note the two assigned `*.ns.cloudflare.com` nameservers it prints.
3. **Registrar.** If DNSSEC is on at the registrar, turn it off. Then replace `ns1/ns2.vercel-dns.com` with the Cloudflare nameservers. Keep both domains attached to the Vercel project, since moving DNS does not detach them.
4. **Wait for activation.** The zone shows `active`, usually within an hour and at most 24 h. Vercel's Domains page then shows *Valid Configuration* and a certificate.
5. **Fix the www redirect.** In DNS-only mode, set `www.savantskills.app` in Vercel to *Redirect to `savantskills.app`* with **308 Permanent**.
6. **Verify.** Run `pnpm seo:verify`. Every check should pass, and the nameserver line should read `Cloudflare`.
7. **Optional:** enable DNSSEC in Cloudflare (DNS → Settings) and add the DS record at the registrar.

To roll back, point the registrar back at `ns1/ns2.vercel-dns.com`. Vercel DNS keeps its records while the domain stays in the Vercel account.
