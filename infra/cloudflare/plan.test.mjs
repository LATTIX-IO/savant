import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildRedirectRule,
  planBotManagement,
  planDnsRecords,
  planRedirectRules,
  planZoneSettings,
  resolveDesiredRecords,
} from "./plan.mjs";

const ZONE = { zoneId: "z1", zoneName: "savantskills.app" };

test("zone.config.json keeps AI crawlers allowed and robots.txt ours", async () => {
  const config = JSON.parse(await readFile(new URL("./zone.config.json", import.meta.url), "utf8"));

  assert.equal(config.botManagement.ai_bots_protection, "disabled");
  assert.equal(config.botManagement.is_robots_txt_managed, false);
  assert.equal(config.botManagement.crawler_protection, "disabled");
  assert.equal(config.settings.ssl, "strict");
  // Vercel redirects to HTTPS itself; a Cloudflare port-80 redirect can break ACME HTTP-01.
  assert.equal(config.settings.always_use_https, "off");
});

test("resolveDesiredRecords applies the zone proxy flag to web records only", () => {
  const records = resolveDesiredRecords({
    proxied: true,
    dnsRecords: [
      { type: "A", name: "@", content: "76.76.21.21" },
      { type: "CNAME", name: "www", content: "cname.vercel-dns.com", proxied: false },
      { type: "CAA", name: "@", data: { flags: 0, tag: "issue", value: "letsencrypt.org" } },
    ],
  });

  assert.deepEqual(records.map((record) => record.proxied), [true, false, false]);
});

test("planDnsRecords creates missing records and leaves matching ones alone", () => {
  const { operations, conflicts } = planDnsRecords({
    ...ZONE,
    desired: [
      { type: "A", name: "@", content: "76.76.21.21", proxied: false },
      { type: "CNAME", name: "www", content: "cname.vercel-dns.com", proxied: false },
    ],
    current: [{ id: "r1", type: "A", name: "savantskills.app", content: "76.76.21.21", proxied: false, ttl: 1 }],
  });

  assert.equal(operations.length, 1);
  assert.equal(operations[0].method, "POST");
  assert.equal(operations[0].body.name, "www.savantskills.app");
  assert.deepEqual(conflicts, []);
});

test("planDnsRecords updates a stale record in place and flags extras", () => {
  const { operations, conflicts } = planDnsRecords({
    ...ZONE,
    desired: [{ type: "A", name: "@", content: "76.76.21.21", proxied: false }],
    current: [
      { id: "r1", type: "A", name: "savantskills.app", content: "216.198.79.65", proxied: true },
      { id: "r2", type: "A", name: "savantskills.app", content: "64.29.17.65", proxied: false },
    ],
  });

  assert.equal(operations.length, 1);
  assert.equal(operations[0].method, "PATCH");
  assert.equal(operations[0].path, "/zones/z1/dns_records/r1");
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /64\.29\.17\.65/);
});

test("planDnsRecords compares CAA records by their structured data", () => {
  const caa = { type: "CAA", name: "@", data: { flags: 0, tag: "issue", value: "letsencrypt.org" }, proxied: false };
  const { operations } = planDnsRecords({
    ...ZONE,
    desired: [caa],
    current: [{ id: "c1", type: "CAA", name: "savantskills.app", content: '0 issue "letsencrypt.org"', data: caa.data, proxied: false }],
  });

  assert.deepEqual(operations, []);
});

test("planDnsRecords reports a CNAME/A clash on the same name", () => {
  const { conflicts } = planDnsRecords({
    ...ZONE,
    desired: [{ type: "CNAME", name: "www", content: "cname.vercel-dns.com", proxied: false }],
    current: [{ id: "a1", type: "A", name: "www.savantskills.app", content: "216.198.79.1", proxied: false }],
  });

  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /clashes/);
});

test("planZoneSettings patches only settings that differ", () => {
  const operations = planZoneSettings({
    zoneId: "z1",
    desired: { ssl: "strict", http3: "on" },
    current: { ssl: "full", http3: "on" },
  });

  assert.deepEqual(operations.map((op) => [op.path, op.body]), [["/zones/z1/settings/ssl", { value: "strict" }]]);
});

test("planBotManagement sends only the managed fields that changed", () => {
  const operations = planBotManagement({
    zoneId: "z1",
    desired: { ai_bots_protection: "disabled", is_robots_txt_managed: false },
    current: { ai_bots_protection: "block", is_robots_txt_managed: false, fight_mode: true },
  });

  assert.equal(operations.length, 1);
  assert.deepEqual(operations[0].body, { ai_bots_protection: "disabled" });
  assert.equal(planBotManagement({ zoneId: "z1", desired: { fight_mode: false }, current: { fight_mode: false } }).length, 0);
});

test("buildRedirectRule preserves path and query without duplicating it", () => {
  const rule = buildRedirectRule({ zoneName: "savantskills.app", ref: "www", statusCode: 301 });

  assert.equal(rule.expression, '(http.host eq "www.savantskills.app")');
  assert.equal(rule.action_parameters.from_value.target_url.expression, 'concat("https://savantskills.app", http.request.uri.path)');
  assert.equal(rule.action_parameters.from_value.preserve_query_string, true);
});

test("planRedirectRules keeps foreign rules and is idempotent", () => {
  const redirect = { ref: "savant_www_to_apex", statusCode: 301 };
  const foreign = { id: "x", version: "3", ref: "other", expression: "true", action: "redirect", action_parameters: {} };

  const [operation] = planRedirectRules({ zoneId: "z1", zoneName: "savantskills.app", redirect, currentRuleset: { rules: [foreign] } });
  assert.equal(operation.method, "PUT");
  assert.deepEqual(operation.body.rules.map((rule) => rule.ref), ["other", "savant_www_to_apex"]);
  assert.equal("id" in operation.body.rules[0], false, "server-owned fields are stripped before PUT");

  const converged = { rules: [foreign, { id: "y", ...buildRedirectRule({ zoneName: "savantskills.app", ...redirect }) }] };
  assert.deepEqual(planRedirectRules({ zoneId: "z1", zoneName: "savantskills.app", redirect, currentRuleset: converged }), []);
});
