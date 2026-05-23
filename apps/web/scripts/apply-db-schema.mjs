import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

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

const databaseUrl = readConfiguredDatabaseUrl();
if (!databaseUrl) {
  console.error("DATABASE_URL is not configured with a real value.");
  process.exit(1);
}

const schemaFiles = await loadSchemaFiles();
if (schemaFiles.length === 0) {
  console.error(`No schema files were found in ${SCHEMA_DIR}.`);
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  connect_timeout: 10,
  idle_timeout: 20,
  max: 1,
  prepare: false,
});

try {
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
