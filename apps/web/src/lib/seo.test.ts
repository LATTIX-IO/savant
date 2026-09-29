import assert from "node:assert/strict";
import test from "node:test";

import { FAQ_ITEMS } from "./marketing-content.ts";
import {
  AI_CRAWLERS,
  buildBreadcrumbJsonLd,
  buildDocsJsonLd,
  buildFaqJsonLd,
  buildLlmsFullTxt,
  buildLlmsTxt,
  buildRobotsTxt,
  buildSiteJsonLd,
  isIndexableDeployment,
  isNoindexPath,
  PUBLIC_ROUTES,
  resolveIndexNowKey,
  resolveSiteOrigin,
  serializeJsonLd,
} from "./seo.ts";

const ORIGIN = "https://savantrepo.com";

test("resolveSiteOrigin defaults to the production domain", () => {
  assert.equal(resolveSiteOrigin({}), ORIGIN);
});

test("only production deployments are indexable", () => {
  assert.equal(isIndexableDeployment({ VERCEL_ENV: "production" }), true);
  assert.equal(isIndexableDeployment({ VERCEL_ENV: "preview", NODE_ENV: "production" }), false);
  assert.equal(isIndexableDeployment({ NODE_ENV: "development" }), false);
  assert.equal(isIndexableDeployment({ NODE_ENV: "production" }), true);
});

test("SAVANT_SEO_INDEXING overrides deployment detection", () => {
  assert.equal(isIndexableDeployment({ VERCEL_ENV: "production", SAVANT_SEO_INDEXING: "0" }), false);
  assert.equal(isIndexableDeployment({ VERCEL_ENV: "preview", SAVANT_SEO_INDEXING: "1" }), true);
});

test("isNoindexPath covers private surfaces without catching public pages", () => {
  for (const path of ["/o/acme/skills", "/api/audit", "/auth/callback", "/signin", "/onboarding/success", "/auth-status"]) {
    assert.equal(isNoindexPath(path), true, path);
  }

  for (const route of PUBLIC_ROUTES) {
    assert.equal(isNoindexPath(route.path), false, route.path);
  }

  assert.equal(isNoindexPath("/operations"), false, "prefix match must respect segment boundaries");
});

test("production robots.txt opens public pages to every AI crawler and points at the sitemap", () => {
  const robots = buildRobotsTxt({ origin: ORIGIN, indexable: true });

  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/o\/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/savantrepo\.com\/sitemap\.xml$/m);
  assert.match(robots, /^Content-Signal: search=yes, ai-input=yes, ai-train=yes$/m);

  for (const agent of [...AI_CRAWLERS.answer, ...AI_CRAWLERS.training]) {
    assert.match(robots, new RegExp(`^User-agent: ${agent}$`, "m"), agent);
  }

  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  // Transactional pages stay crawlable so their noindex header is seen.
  assert.doesNotMatch(robots, /^Disallow: \/signin/m);
});

test("non-production robots.txt blocks everything", () => {
  const robots = buildRobotsTxt({ origin: "https://savant-git-x.vercel.app", indexable: false });

  assert.match(robots, /^Disallow: \/$/m);
  assert.doesNotMatch(robots, /Sitemap:/);
});

test("llms.txt follows the llmstxt.org shape", () => {
  const llms = buildLlmsTxt(ORIGIN);
  const lines = llms.split("\n");

  assert.equal(lines[0], "# Savant");
  assert.ok(lines.some((line) => line.startsWith("> ")), "summary blockquote");
  assert.match(llms, /^## Product$/m);
  assert.match(llms, /\[Docs\]\(https:\/\/savantrepo\.com\/docs\)/);
  assert.match(llms, /\[Full text\]\(https:\/\/savantrepo\.com\/llms-full\.txt\)/);
  assert.match(llms, /\$1 per user per month/);
});

test("llms-full.txt carries every FAQ answer verbatim", () => {
  const full = buildLlmsFullTxt(ORIGIN);

  for (const item of FAQ_ITEMS) {
    assert.ok(full.includes(`### ${item.q}`), item.q);
    assert.ok(full.includes(item.a), item.q);
  }
});

test("site JSON-LD links organization, website, and software by @id", () => {
  const graph = buildSiteJsonLd(ORIGIN)["@graph"] as Record<string, unknown>[];
  const types = graph.map((node) => node["@type"]);

  assert.deepEqual(types, ["Organization", "WebSite", "SoftwareApplication"]);
  assert.deepEqual(graph[1]?.publisher, { "@id": `${ORIGIN}/#organization` });

  const offers = graph[2]?.offers as { price: number; priceCurrency: string }[];
  assert.deepEqual(
    offers.map((offer) => [offer.price, offer.priceCurrency]),
    [
      [1, "USD"],
      [10, "USD"],
    ],
  );
});

test("FAQ, breadcrumb, and docs JSON-LD mirror the rendered content", () => {
  const faq = buildFaqJsonLd(ORIGIN) as { mainEntity: { name: string }[] };
  assert.equal(faq.mainEntity.length, FAQ_ITEMS.length);

  const crumbs = buildBreadcrumbJsonLd(ORIGIN, [{ name: "Docs", path: "/docs" }]) as {
    itemListElement: { position: number; item: string }[];
  };
  assert.deepEqual(
    crumbs.itemListElement.map((crumb) => [crumb.position, crumb.item]),
    [
      [1, ORIGIN],
      [2, `${ORIGIN}/docs`],
    ],
  );

  const docs = buildDocsJsonLd(ORIGIN) as { step: { url: string }[] };
  assert.equal(docs.step[0]?.url, `${ORIGIN}/docs#connect`);
});

test("serializeJsonLd cannot close the surrounding script tag", () => {
  const serialized = serializeJsonLd({ text: "</script><script>alert(1)</script>" });

  assert.doesNotMatch(serialized, /</);
  assert.deepEqual(JSON.parse(serialized), { text: "</script><script>alert(1)</script>" });
});

test("resolveIndexNowKey accepts only spec-shaped keys", () => {
  assert.equal(resolveIndexNowKey({ INDEXNOW_KEY: "a1b2c3d4e5f6" }), "a1b2c3d4e5f6");
  assert.equal(resolveIndexNowKey({ INDEXNOW_KEY: "short" }), null);
  assert.equal(resolveIndexNowKey({ INDEXNOW_KEY: "has spaces in it" }), null);
  assert.equal(resolveIndexNowKey({}), null);
});
