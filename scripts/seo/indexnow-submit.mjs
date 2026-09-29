// Submit every URL in the live sitemap to IndexNow (Bing, Yandex, Seznam, Naver,
// and the engines that share its feed). Run after a production deploy that
// changes public copy:
//
//   INDEXNOW_KEY=<key> node ./scripts/seo/indexnow-submit.mjs [--origin https://savantrepo.com] [--dry-run]
//
// The key must match the INDEXNOW_KEY env var of the deployment, which serves
// it at <origin>/indexnow.txt.
import process from "node:process";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function extractSitemapUrls(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
}

async function main() {
  const origin = (readArg("--origin") ?? process.env.SITE_ORIGIN ?? "https://savantrepo.com").replace(/\/+$/, "");
  const dryRun = process.argv.includes("--dry-run");
  const key = process.env.INDEXNOW_KEY?.trim();

  if (!key) {
    throw new Error("Set INDEXNOW_KEY to the key the deployment serves at /indexnow.txt.");
  }

  const served = await fetch(`${origin}/indexnow.txt`).then((response) => (response.ok ? response.text() : null));

  if (served?.trim() !== key) {
    throw new Error(`${origin}/indexnow.txt does not serve this key. Set INDEXNOW_KEY on the deployment and redeploy first.`);
  }

  const sitemap = await fetch(`${origin}/sitemap.xml`).then((response) => {
    if (!response.ok) throw new Error(`GET ${origin}/sitemap.xml returned ${response.status}.`);
    return response.text();
  });
  const urlList = extractSitemapUrls(sitemap);

  if (urlList.length === 0) {
    throw new Error("The sitemap lists no URLs. Is this a production (indexable) deployment?");
  }

  const body = { host: new URL(origin).host, key, keyLocation: `${origin}/indexnow.txt`, urlList };

  if (dryRun) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  // 200 = accepted, 202 = accepted pending key validation.
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow rejected the submission: ${response.status} ${await response.text()}`);
  }

  console.log(`Submitted ${urlList.length} URLs to IndexNow (${response.status}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
