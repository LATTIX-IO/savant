// End-to-end check of what search and AI crawlers actually receive from a
// deployed origin, through whatever DNS/CDN layer fronts it (Vercel, Cloudflare).
//
//   node ./scripts/seo/verify-live.mjs [--origin https://savantrepo.com]
//
// Exits non-zero when any check fails. Safe to run from CI after a deploy.
import process from "node:process";

const DOH = "https://cloudflare-dns.com/dns-query";

// A representative crawler per class. A 403/429/challenge for any of these
// usually means an edge bot rule (e.g. Cloudflare "Block AI bots") is on.
const CRAWLER_USER_AGENTS = {
  Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  Bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const origin = (readArg("--origin") ?? process.env.SITE_ORIGIN ?? "https://savantrepo.com").replace(/\/+$/, "");
const host = new URL(origin).host;
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

async function dns(name, type) {
  const response = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
  });
  const body = await response.json();
  return (body.Answer ?? []).map((answer) => answer.data.replace(/\.$/, ""));
}

async function check(name, fn) {
  try {
    await fn();
  } catch (error) {
    record(name, false, error.message);
  }
}

await check("DNS: nameservers", async () => {
  const ns = await dns(host, "NS");
  const provider = ns.some((n) => n.endsWith("ns.cloudflare.com"))
    ? "Cloudflare"
    : ns.some((n) => n.endsWith("vercel-dns.com"))
      ? "Vercel DNS"
      : "other";
  record("DNS: nameservers", ns.length > 0, `${provider} (${ns.join(", ")})`);
});

await check("DNS: apex resolves", async () => {
  const a = await dns(host, "A");
  record("DNS: apex resolves", a.length > 0, a.join(", "));
});

await check("Redirect: www → apex is permanent", async () => {
  const response = await fetch(`https://www.${host}/docs?utm=check`, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  const ok = (response.status === 301 || response.status === 308) && location.startsWith(`${origin}/docs`);
  record("Redirect: www → apex is permanent", ok, `${response.status} → ${location || "(none)"}`);
});

await check("Redirect: http → https", async () => {
  const response = await fetch(`http://${host}/`, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  record("Redirect: http → https", response.status >= 300 && response.status < 400 && location.startsWith("https://"), `${response.status} → ${location}`);
});

await check("robots.txt", async () => {
  const response = await fetch(`${origin}/robots.txt`);
  const body = await response.text();
  const problems = [];

  if (!response.ok) problems.push(`status ${response.status}`);
  if (!body.includes(`Sitemap: ${origin}/sitemap.xml`)) problems.push("missing Sitemap line");
  if (/^Disallow:\s*\/\s*$/m.test(body)) problems.push("contains a site-wide Disallow: / (edge-managed robots.txt or a non-production build?)");
  if (/BEGIN Cloudflare Managed content/i.test(body)) problems.push("Cloudflare managed robots.txt is prepending rules");

  record("robots.txt", problems.length === 0, problems.join("; ") || "ok");
});

await check("sitemap.xml", async () => {
  const response = await fetch(`${origin}/sitemap.xml`);
  const body = await response.text();
  const count = (body.match(/<loc>/g) ?? []).length;
  const foreign = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].filter((m) => !m[1].startsWith(origin));
  record("sitemap.xml", response.ok && count > 0 && foreign.length === 0, `${count} URLs${foreign.length ? `, ${foreign.length} off-origin` : ""}`);
});

for (const path of ["/llms.txt", "/llms-full.txt"]) {
  await check(path, async () => {
    const response = await fetch(`${origin}${path}`);
    const body = await response.text();
    record(path, response.ok && body.startsWith("# "), `${response.status} ${response.headers.get("content-type")}`);
  });
}

await check("Home: indexable with canonical + structured data", async () => {
  const response = await fetch(`${origin}/`);
  const html = await response.text();
  const robotsHeader = response.headers.get("x-robots-tag") ?? "";
  const problems = [];

  if (/noindex/i.test(robotsHeader)) problems.push(`X-Robots-Tag: ${robotsHeader}`);
  if (/<meta name="robots" content="[^"]*noindex/i.test(html)) problems.push("meta robots noindex");
  if (!html.includes(`<link rel="canonical" href="${origin}"`)) problems.push("canonical missing or wrong");
  if (!html.includes('"@type":"SoftwareApplication"')) problems.push("SoftwareApplication JSON-LD missing");
  if (!html.includes('"@type":"FAQPage"')) problems.push("FAQPage JSON-LD missing");
  if (!/<meta property="og:image"/.test(html)) problems.push("og:image missing");

  record("Home: indexable with canonical + structured data", problems.length === 0, problems.join("; ") || "ok");
});

await check("Private routes: noindex", async () => {
  const response = await fetch(`${origin}/o/verify-live/dashboard`, { redirect: "manual" });
  const header = response.headers.get("x-robots-tag") ?? "";
  record("Private routes: noindex", /noindex/i.test(header), `${response.status} X-Robots-Tag: ${header || "(none)"}`);
});

for (const [bot, userAgent] of Object.entries(CRAWLER_USER_AGENTS)) {
  await check(`Crawler access: ${bot}`, async () => {
    const response = await fetch(`${origin}/`, { headers: { "user-agent": userAgent } });
    const challenged = response.headers.get("cf-mitigated") === "challenge";
    record(`Crawler access: ${bot}`, response.ok && !challenged, `${response.status}${challenged ? " (Cloudflare challenge)" : ""}`);
  });
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed for ${origin}`);
process.exitCode = failed ? 1 : 0;
