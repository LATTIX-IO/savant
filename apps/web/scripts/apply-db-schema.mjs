import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import {authorizeSchemaApply,SchemaAuthorizationError} from "./schema-apply-authorization.mjs";
import {authorizeProductionMvpSchemaApply,ProductionSchemaAuthorizationError} from "./production-schema-authorization.mjs";
import {assertStagingRoleReadiness,STAGING_ROLE_QUERY} from "./staging-role-preflight.mjs";

function readConfiguredDatabaseUrl(env = process.env) {
  const value = env.DATABASE_URL;

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    ? trimmed.slice(1, -1).trim()
    : trimmed;

  if (!unquoted) {
    return null;
  }

  if (unquoted.startsWith("<") || unquoted.includes("REPLACE") || unquoted.startsWith("placeholder-")) {
    return null;
  }

  return unquoted;
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const SCHEMA_DIR = path.join(REPO_ROOT, "db", "schema");
const SCHEMA_FILE_PATTERN = /^\d+_.+\.sql$/i;

async function loadSchemaFiles() {
  const entries = await readdir(SCHEMA_DIR, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && SCHEMA_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

// DDL always uses the direct, non-pooler connection in staging; a Vercel
// deployment and the general pooled DATABASE_URL are never an authorization.
const env = process.env;
const databaseUrl = readConfiguredDatabaseUrl(
  ["staging", "production-mvp"].includes(env.SAVANT_SCHEMA_APPLY_TARGET)
    ? {...env,DATABASE_URL:env.DATABASE_URL_UNPOOLED}
    : env
);
if (!databaseUrl) {
  console.error("DATABASE_URL is not configured with a real value.");
  process.exit(1);
}
let grant;
try {
  // Production MVP is an explicit offline operator path. It never changes
  // the Vercel build migration restriction or introduces a remote DDL endpoint.
  if (env.SAVANT_SCHEMA_APPLY_TARGET === "production-mvp") {
    grant=authorizeProductionMvpSchemaApply({env,argv:process.argv.slice(2),databaseUrl});
  } else {
    grant=authorizeSchemaApply({env,argv:process.argv.slice(2),databaseUrl});
  }
  console.log("[db:migrate] Authorized "+grant.scope+" schema target.");
}catch(error){
  console.error("[db:migrate] "+(
    error instanceof SchemaAuthorizationError || error instanceof ProductionSchemaAuthorizationError
      ?error.code:"schema_authorization_failed"
  ));
  process.exit(1);
}

// Optional `--only=0006,0007` restricts the run to schema files with those prefixes.
const onlyArgument = process.argv.find((argument) => argument.startsWith("--only="));
const onlyPrefixes = onlyArgument
  ? onlyArgument.slice("--only=".length).split(",").map((prefix) => prefix.trim()).filter(Boolean)
  : null;

const schemaFiles = (await loadSchemaFiles()).filter(
  (schemaFile) => !onlyPrefixes || onlyPrefixes.some((prefix) => schemaFile.startsWith(prefix)),
);
if (schemaFiles.length === 0) {
  console.error(
    onlyPrefixes
      ? `No schema files in ${SCHEMA_DIR} match --only=${onlyPrefixes.join(",")}.`
      : `No schema files were found in ${SCHEMA_DIR}.`,
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  connect_timeout: 10,
  idle_timeout: 20,
  max: 1,
  prepare: false,
});

try {
  if (grant.scope === "signed-staging-only" || grant.scope === "signed-production-mvp") {
    try {
      const expected = new URL(databaseUrl);
      const rows = await sql.unsafe(STAGING_ROLE_QUERY);
      assertStagingRoleReadiness(rows, {
        expectedRole: decodeURIComponent(expected.username),
        expectedDatabase: decodeURIComponent(expected.pathname.slice(1)),
      });
    } catch {
      console.error("[db:migrate] staging_role_preflight_unavailable");
      process.exitCode = 1;
      throw new Error("staging_role_preflight_unavailable");
    }
  }
  for (const schemaFile of schemaFiles) {
    const schemaPath = path.join(SCHEMA_DIR, schemaFile);
    const schemaSql = await readFile(schemaPath, "utf8");

    console.log(`Applying ${schemaFile}...`);
    await sql.unsafe(schemaSql);
  }

  console.log(`Applied ${schemaFiles.length} schema file(s) from ${SCHEMA_DIR}.`);
} finally {
  await sql.end({ timeout: 5 });
}
