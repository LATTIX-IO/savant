// Pure planning logic for the Cloudflare zone in front of savantskills.app.
// Given the desired config (zone.config.json) and the zone's current state as
// read from the API, returns the list of API operations that converge them.
// No I/O here, so it is unit-tested in plan.test.mjs.

/** @typedef {{ method: "POST" | "PATCH" | "PUT", path: string, body: unknown, summary: string }} Operation */

/** Comparable value of a record: CAA records are structured, the rest use content. */
export function recordValue(record) {
  if (record.type === "CAA" && record.data) {
    return `${record.data.flags} ${record.data.tag} "${record.data.value}"`;
  }
  return record.content;
}

function sameRecord(current, desired) {
  return (
    current.type === desired.type
    && recordValue(current) === recordValue(desired)
    && Boolean(current.proxied) === Boolean(desired.proxied)
    && (desired.ttl === undefined || current.ttl === desired.ttl)
  );
}

function fqdn(name, zoneName) {
  return name === "@" ? zoneName : `${name}.${zoneName}`;
}

/**
 * DNS: every desired record must exist exactly once with the desired content.
 * Records of the same name+type that are not desired (for example the legacy
 * Vercel A record) are reported as conflicts rather than deleted, because a
 * delete on the wrong zone is not something to automate.
 */
export function planDnsRecords({ zoneId, zoneName, desired, current }) {
  /** @type {Operation[]} */
  const operations = [];
  const conflicts = [];

  const byKey = new Map();
  for (const record of current) {
    const key = `${record.type} ${record.name}`;
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }

  // Group desired records by name+type so multi-value A records work.
  const desiredByKey = new Map();
  for (const record of desired) {
    const name = fqdn(record.name, zoneName);
    const key = `${record.type} ${name}`;
    desiredByKey.set(key, [...(desiredByKey.get(key) ?? []), { ...record, name }]);
  }

  for (const [key, wanted] of desiredByKey) {
    const existing = [...(byKey.get(key) ?? [])];
    // CNAME and A/AAAA cannot coexist on a name; flag the other kind.
    const [type, name] = key.split(" ");
    const clashing = current.filter(
      (record) => record.name === name && record.type !== type && (type === "CNAME" || record.type === "CNAME"),
    );
    for (const record of clashing) {
      conflicts.push(`${record.type} ${record.name} → ${recordValue(record)} clashes with desired ${type}; remove it in the dashboard.`);
    }

    const unmatched = [];
    for (const record of wanted) {
      const exactIndex = existing.findIndex((candidate) => sameRecord(candidate, record));
      if (exactIndex !== -1) {
        existing.splice(exactIndex, 1);
        continue;
      }
      unmatched.push(record);
    }

    for (const record of unmatched) {
      const body = {
        type: record.type,
        name: record.name,
        ...(record.data ? { data: record.data } : { content: record.content }),
        proxied: Boolean(record.proxied),
        ttl: record.ttl ?? 1,
        comment: record.comment ?? "Managed by infra/cloudflare",
      };
      // Reuse a stale record of the same name+type before creating a new one.
      const stale = existing.shift();
      operations.push(
        stale
          ? { method: "PATCH", path: `/zones/${zoneId}/dns_records/${stale.id}`, body, summary: `update ${record.type} ${record.name}: ${recordValue(stale)}${stale.proxied ? " (proxied)" : ""} → ${recordValue(record)}${record.proxied ? " (proxied)" : ""}` }
          : { method: "POST", path: `/zones/${zoneId}/dns_records`, body, summary: `create ${record.type} ${record.name} → ${recordValue(record)}${record.proxied ? " (proxied)" : ""}` },
      );
    }

    for (const leftover of existing) {
      conflicts.push(`${leftover.type} ${leftover.name} → ${recordValue(leftover)} is not in zone.config.json; remove it in the dashboard if it is stale.`);
    }
  }

  return { operations, conflicts };
}

/** Zone settings: PATCH /zones/:id/settings/:setting for each value that differs. */
export function planZoneSettings({ zoneId, desired, current }) {
  /** @type {Operation[]} */
  const operations = [];

  for (const [setting, value] of Object.entries(desired)) {
    const currentValue = current[setting];
    if (JSON.stringify(currentValue) === JSON.stringify(value)) continue;
    operations.push({
      method: "PATCH",
      path: `/zones/${zoneId}/settings/${setting}`,
      body: { value },
      summary: `setting ${setting}: ${JSON.stringify(currentValue ?? null)} → ${JSON.stringify(value)}`,
    });
  }

  return operations;
}

/**
 * Bot management: only the fields we manage are compared and sent, so Bot
 * Fight Mode or other fields tuned in the dashboard are left alone.
 */
export function planBotManagement({ zoneId, desired, current }) {
  const changed = Object.entries(desired).filter(([field, value]) => current?.[field] !== value);

  if (changed.length === 0) return [];

  return [
    {
      method: "PUT",
      path: `/zones/${zoneId}/bot_management`,
      body: Object.fromEntries(changed),
      summary: `bot_management: ${changed.map(([field, value]) => `${field}=${JSON.stringify(value)} (was ${JSON.stringify(current?.[field] ?? null)})`).join(", ")}`,
    },
  ];
}

/** The www → apex single redirect, expressed as a Rulesets API rule. */
export function buildRedirectRule({ zoneName, ref, statusCode }) {
  return {
    ref,
    description: `www.${zoneName} → ${zoneName} (managed by infra/cloudflare)`,
    expression: `(http.host eq "www.${zoneName}")`,
    action: "redirect",
    action_parameters: {
      from_value: {
        status_code: statusCode,
        target_url: { expression: `concat("https://${zoneName}", http.request.uri.path)` },
        preserve_query_string: true,
      },
    },
    enabled: true,
  };
}

function comparableRule(rule) {
  return JSON.stringify({
    expression: rule.expression,
    action: rule.action,
    action_parameters: rule.action_parameters,
    enabled: rule.enabled !== false,
  });
}

/**
 * Redirect rules live in the zone's http_request_dynamic_redirect entrypoint.
 * Our rule is identified by `ref`; rules owned by anyone else are kept as-is.
 * A PUT on the entrypoint replaces the full rule list, so it is rebuilt from
 * the current rules.
 */
export function planRedirectRules({ zoneId, zoneName, redirect, currentRuleset }) {
  const desired = buildRedirectRule({ zoneName, ...redirect });
  const rules = currentRuleset?.rules ?? [];
  const index = rules.findIndex((rule) => rule.ref === desired.ref);

  if (index !== -1 && comparableRule(rules[index]) === comparableRule(desired)) return [];

  const strip = ({ id, version, last_updated, ...rest }) => rest; // eslint-disable-line no-unused-vars
  const nextRules = index === -1 ? [...rules.map(strip), desired] : rules.map((rule, i) => (i === index ? desired : strip(rule)));

  return [
    {
      method: "PUT",
      path: `/zones/${zoneId}/rulesets/phases/http_request_dynamic_redirect/entrypoint`,
      body: { rules: nextRules },
      summary: `${index === -1 ? "add" : "update"} redirect rule ${desired.ref}: www.${zoneName}/* → https://${zoneName}/* (${redirect.statusCode})`,
    },
  ];
}

/**
 * Expand zone.config.json records: web records (A/AAAA/CNAME) follow the
 * zone-wide `proxied` flag unless a record overrides it; others never proxy.
 */
export function resolveDesiredRecords(config) {
  return config.dnsRecords.map((record) => ({
    ...record,
    proxied: ["A", "AAAA", "CNAME"].includes(record.type) ? (record.proxied ?? Boolean(config.proxied)) : false,
  }));
}
