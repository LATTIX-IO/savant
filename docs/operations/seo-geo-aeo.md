# SEO, GEO, and AEO

How `savantskills.app` presents itself to search engines (SEO), generative engines that train on or retrieve the web (GEO), and answer engines that quote it (AEO). The edge and DNS side is covered in `infra/cloudflare/README.md`.

## What the app serves

| Surface | Source | Notes |
| --- | --- | --- |
| `/robots.txt` | `src/app/robots.txt/route.ts` → `buildRobotsTxt` | Explicitly allows named AI search, answer, and training crawlers. Carries `Content-Signal: search=yes, ai-input=yes, ai-train=yes`. Disallows `/api/`, `/auth/`, `/o/`, and dashboard paths. Non-production builds serve `Disallow: /`. |
| `/sitemap.xml` | `src/app/sitemap.ts` | Built from `PUBLIC_ROUTES`. Empty outside production. |
| `/llms.txt`, `/llms-full.txt` | `buildLlmsTxt`, `buildLlmsFullTxt` | Follows [llmstxt.org](https://llmstxt.org). The full file carries the docs, security, pricing, and FAQ text verbatim. Linked from every page as `<link rel="alternate" type="text/markdown">`. |
| JSON-LD | `src/components/seo/json-ld.tsx` | Home: `Organization` + `WebSite` + `SoftwareApplication` (per-seat offers) and `FAQPage`. `/docs`: `HowTo` + `BreadcrumbList`. `/security`: `BreadcrumbList`. |
| Metadata | `src/lib/seo-metadata.ts` | `metadataBase`, per-page canonical, Open Graph, `summary_large_image` Twitter card, and search console verification. |
| `/opengraph-image` | `src/app/opengraph-image.tsx` | 1200×630 default social card. |
| `/indexnow.txt` | `INDEXNOW_KEY` | IndexNow key file. 404 when the variable is unset. |
| `X-Robots-Tag: noindex` | `next.config.ts` headers | On `NOINDEX_PATH_PREFIXES` (workspaces, APIs, auth, signin, onboarding, auth-status), and on every path of a non-production deployment. |

**One source of copy.** Docs guides, security sections, FAQ answers, and pricing live in `src/lib/marketing-content.ts`. The pages, the JSON-LD, and the llms files all render from it, so they cannot drift. Write FAQ answers so they stand alone, because answer engines quote them out of context.

**Adding a public page.** Add it to `PUBLIC_ROUTES` in `src/lib/seo.ts`, set `export const metadata = buildPublicPageMetadata("/path")`, and link it from `buildLlmsTxt`. Private pages need nothing extra if they sit under an existing `NOINDEX_PATH_PREFIXES` prefix. Otherwise add the prefix.

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `VERCEL_ENV` | set by Vercel | Only `production` is indexable. |
| `SAVANT_SEO_INDEXING` | optional | `0` keeps production dark (soft launch). `1` forces indexing elsewhere. |
| `GOOGLE_SITE_VERIFICATION` | Production | Google Search Console HTML-tag token. |
| `BING_SITE_VERIFICATION` | Production | Bing Webmaster Tools `msvalidate.01` token. Bing's index also feeds Copilot and ChatGPT search. |
| `INDEXNOW_KEY` | Production | 8–128 chars of `[a-zA-Z0-9-]`, for example from `openssl rand -hex 16`. |

Indexability is read at build time for headers, robots.txt, and the sitemap. Redeploy after changing these variables.

## After a production deploy

```bash
pnpm seo:verify                         # DNS, redirects, robots, sitemap, llms, noindex, crawler access
INDEXNOW_KEY=... pnpm seo:indexnow      # ping Bing/Yandex/Seznam/Naver with the sitemap URLs
```

`.github/workflows/seo-verify.yml` runs the verification daily.

## One-time registrations

1. **Google Search Console.** Add the `savantskills.app` property with a DNS TXT record (in Cloudflare once the zone is live) or `GOOGLE_SITE_VERIFICATION`, then submit `https://savantskills.app/sitemap.xml`.
2. **Bing Webmaster Tools.** Import from Search Console or use `BING_SITE_VERIFICATION`, then submit the sitemap.
3. **Validate structured data** with the [Rich Results Test](https://search.google.com/test/rich-results) and the [Schema Markup Validator](https://validator.schema.org/).
