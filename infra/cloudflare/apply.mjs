// Converge the Cloudflare zone for savantskills.app with zone.config.json.
//
//   CLOUDFLARE_API_TOKEN=... node infra/cloudflare/apply.mjs            # dry run: print the plan
//   CLOUDFLARE_API_TOKEN=... node infra/cloudflare/apply.mjs --apply    # execute it
//
// First-time setup (zone does not exist yet):
//   CLOUDFLARE_ACCOUNT_ID=... node infra/cloudflare/apply.mjs --create-zone --apply
//
// Token permissions (scope to this zone): Zone:Read, DNS:Edit, Zone Settings:Edit,
// Bot Management:Edit, Single Redirect:Edit (plus account Zone:Edit for --create-zone).
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  planBotManagement,
  planDnsRecords,
  planRedirectRules,
  planZoneSettings,
  resolveDesiredRecords,
} from "./plan.mjs";

const API = "https://api.cloudflare.com/client/v4";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const apply = process.argv.includes("--apply");
const createZone = process.argv.includes("--create-zone");
const configPath = process.argv.includes("--config")
  ? path.resolve(process.argv[process.argv.indexOf("--config") + 1])
  : path.join(HERE, "zone.config.json");

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();

if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN (see infra/cloudflare/README.md for the permissions it needs).");
  process.exit(1);
}

async function cf(method, apiPath, body) {
  const response = await fetch(`${API}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    const messages = (payload.errors ?? []).map((error) => `${error.code}: ${error.message}`).join("; ");
    const failure = new Error(`${method} ${apiPath} → ${response.status} ${messages}`);
    failure.status = response.status;
    throw failure;
  }

  return payload;
}

async function listAll(apiPath) {
  const results = [];
  for (let page = 1; ; page += 1) {
    const separator = apiPath.includes("?") ? "&" : "?";
    const payload = await cf("GET", `${apiPath}${separator}per_page=100&page=${page}`);
    results.push(...payload.result);
    if (page >= (payload.result_info?.total_pages ?? 1)) return results;
  }
}

async function readOptional(apiPath) {
  try {
    return (await cf("GET", apiPath)).result;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function ensureZone(zoneName) {
  const zones = (await cf("GET", `/zones?name=${encodeURIComponent(zoneName)}`)).result;

  if (zones.length > 0) return zones[0];

  if (!createZone) {
    throw new Error(`Zone ${zoneName} does not exist in this account. Re-run with --create-zone (and CLOUDFLARE_ACCOUNT_ID).`);
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) throw new Error("--create-zone needs CLOUDFLARE_ACCOUNT_ID.");

  if (!apply) {
    console.log(`[plan] create zone ${zoneName} (type full) in account ${accountId}`);
    return null;
  }

  const zone = (await cf("POST", "/zones", { name: zoneName, account: { id: accountId }, type: "full" })).result;
  console.log(`Created zone ${zoneName} (${zone.id}), status ${zone.status}.`);
  return zone;
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const zone = await ensureZone(config.zone);

  if (!zone) {
    console.log("\nZone creation is pending --apply; the rest of the plan needs the zone to exist.");
    return;
  }

  const zoneId = zone.id;
  const operations = [];
  const warnings = [];

  // 1. Zone settings first: SSL must be Full (strict) before anything is proxied.
  const settingEntries = Object.entries(config.settings).filter(([key]) => !key.startsWith("$"));
  const currentSettings = {};
  for (const [setting] of settingEntries) {
    const result = await readOptional(`/zones/${zoneId}/settings/${setting}`);
    currentSettings[setting] = result?.value;
  }
  operations.push(...planZoneSettings({ zoneId, desired: Object.fromEntries(settingEntries), current: currentSettings }));

  // 2. DNS records.
  const desiredRecords = resolveDesiredRecords(config);
  const currentRecords = await listAll(`/zones/${zoneId}/dns_records`);
  const dns = planDnsRecords({ zoneId, zoneName: config.zone, desired: desiredRecords, current: currentRecords });
  operations.push(...dns.operations);
  warnings.push(...dns.conflicts);

  const wildcard = currentRecords.find((record) => record.name === `*.${config.zone}`);
  if (wildcard) warnings.push(`Wildcard ${wildcard.type} *.${config.zone} exists; every subdomain resolves to it. Remove it unless intended.`);

  // 3. Bot management: keep AI crawlers allowed and robots.txt ours.
  const botFields = Object.fromEntries(Object.entries(config.botManagement).filter(([key]) => !key.startsWith("$")));
  const currentBots = await readOptional(`/zones/${zoneId}/bot_management`);
  operations.push(...planBotManagement({ zoneId, desired: botFields, current: currentBots }));

  // 4. Edge features that only run on proxied traffic.
  if (config.proxied) {
    const ruleset = await readOptional(`/zones/${zoneId}/rulesets/phases/http_request_dynamic_redirect/entrypoint`);
    operations.push(...planRedirectRules({ zoneId, zoneName: config.zone, redirect: config.redirect, currentRuleset: ruleset }));

    if (config.crawlerHints) {
      // Not in the public API reference; this is the call the dashboard makes.
      operations.push({
        method: "POST",
        path: `/zones/${zoneId}/flags/products/cache/changes`,
        body: { feature: "crawlhints_enabled", value: true },
        summary: "enable Crawler Hints (IndexNow on cache changes)",
        optional: true,
      });
    }
  } else {
    warnings.push("DNS-only mode: the www → apex redirect is Vercel's job. Set www.savantskills.app to redirect to savantskills.app with 308 in Vercel → Domains.");
  }

  console.log(`Zone ${config.zone} (${zoneId}), status ${zone.status}, mode ${config.proxied ? "proxied" : "DNS-only"}`);
  console.log(`Nameservers: ${(zone.name_servers ?? []).join(", ")}\n`);

  if (operations.length === 0) {
    console.log("No changes: the zone already matches zone.config.json.");
  }

  for (const operation of operations) {
    const label = apply ? "apply" : "plan";
    console.log(`[${label}] ${operation.summary}`);

    if (!apply) continue;

    try {
      await cf(operation.method, operation.path, operation.body);
    } catch (error) {
      if (!operation.optional) throw error;
      warnings.push(`Optional step failed (${operation.summary}): ${error.message}. Enable it in the dashboard instead.`);
    }
  }

  for (const warning of warnings) {
    console.log(`[warn] ${warning}`);
  }

  if (!apply && operations.length > 0) {
    console.log("\nDry run. Re-run with --apply to execute.");
  }

  if (zone.status === "pending") {
    console.log(`\nZone is pending: point the registrar's nameservers at ${(zone.name_servers ?? []).join(" and ")}, then check with node scripts/seo/verify-live.mjs.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
