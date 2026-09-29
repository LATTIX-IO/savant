import process from "node:process";

import postgres from "postgres";

// Read-only check that db/schema/0006_git_provider_integration.sql is applied.
// Usage: DATABASE_URL=... node apps/web/scripts/verify-git-provider-schema.mjs

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || databaseUrl.startsWith("<")) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { connect_timeout: 10, max: 1, prepare: false });

const REQUIRED_TABLES = ["git_provider_secrets", "git_oauth_states", "repository_connections"];
const REQUIRED_COLUMNS = {
  git_provider_connections: [
    "auth_type",
    "provider_host",
    "provider_account_id",
    "provider_account_name",
    "provider_installation_id",
    "provider_scope",
    "secret_id",
    "scopes",
    "last_validated_at",
    "last_error_code",
    "last_error_at",
    "created_by",
    "disconnected_at",
  ],
  repositories: ["provider_host", "provider_namespace", "provider_project"],
  repository_sync_state: ["sync_started_at", "sync_target_revision"],
};
// [constraint name, text its definition must contain]
const REQUIRED_CONSTRAINTS = [
  ["git_provider_connections_auth_type_check", "legacy_env"],
  ["git_provider_connections_status_check", "needs_reauthorization"],
  ["git_provider_connections_credential_source_check", "credentials_ref"],
  ["git_provider_connections_secret_id_fkey", "REFERENCES"],
  ["repository_sync_state_status_check", "auth_required"],
];
const REQUIRED_INDEXES = [
  "git_provider_connections_org_provider_idx",
  "git_provider_connections_org_account_key",
  "git_oauth_states_expiry_idx",
  "repository_connections_connection_idx",
  "repositories_org_provider_external_id_key",
];

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

try {
  await sql.begin("read only", async (tx) => {
    const tables = await tx`
      select table_name from information_schema.tables
      where table_schema = current_schema() and table_name = any(${REQUIRED_TABLES})
    `;
    for (const table of REQUIRED_TABLES) {
      check(`table ${table}`, tables.some((row) => row.table_name === table));
    }

    const columns = await tx`
      select table_name, column_name, is_nullable from information_schema.columns
      where table_schema = current_schema() and table_name = any(${Object.keys(REQUIRED_COLUMNS)})
    `;
    for (const [table, names] of Object.entries(REQUIRED_COLUMNS)) {
      const missing = names.filter((name) => !columns.some((row) => row.table_name === table && row.column_name === name));
      check(`columns on ${table}`, missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");
    }
    const column = (table, name) => columns.find((row) => row.table_name === table && row.column_name === name);
    check("auth_type is NOT NULL", column("git_provider_connections", "auth_type")?.is_nullable === "NO");
    check("credentials_ref is nullable", column("git_provider_connections", "credentials_ref")?.is_nullable === "YES");

    const constraints = await tx`
      select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conname = any(${REQUIRED_CONSTRAINTS.map(([name]) => name)})
    `;
    for (const [name, mustContain] of REQUIRED_CONSTRAINTS) {
      const found = constraints.find((row) => row.conname === name);
      check(`constraint ${name}`, Boolean(found?.definition.includes(mustContain)), found ? "" : "missing");
    }

    const indexes = await tx`
      select indexname from pg_indexes where schemaname = current_schema() and indexname = any(${REQUIRED_INDEXES})
    `;
    for (const index of REQUIRED_INDEXES) {
      check(`index ${index}`, indexes.some((row) => row.indexname === index));
    }

    // Before the migration, auth_type does not exist; report FAILs instead of crashing.
    if (!column("git_provider_connections", "auth_type")) {
      return;
    }

    const connections = await tx`
      select auth_type, status, count(*)::int as count,
        count(*) filter (where auth_type = 'legacy_env' and credentials_ref is null)::int as broken_legacy
      from git_provider_connections
      group by auth_type, status
      order by auth_type, status
    `;
    check("no connections without auth_type", !connections.some((row) => row.auth_type === null));
    check("legacy connections keep credentials_ref", !connections.some((row) => row.broken_legacy > 0));

    console.log("git_provider_connections by auth_type/status:");
    console.table(connections.map(({ auth_type, status, count }) => ({ auth_type, status, count })));
  });
} catch (error) {
  console.error(`Verification query failed: ${error instanceof Error ? error.message : String(error)}`);
  await sql.end({ timeout: 5 });
  process.exit(1);
}

await sql.end({ timeout: 5 });

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? ` (${result.detail})` : ""}`);
}

const failed = results.filter((result) => !result.ok).length;
console.log(failed === 0 ? `\nMigration 0006 is applied (${results.length} checks passed).` : `\n${failed} check(s) failed; migration 0006 is not fully applied.`);
process.exit(failed === 0 ? 0 : 1);
