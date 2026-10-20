import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Production schema changes must not originate from the Vercel build worker.
// Vercel automatically builds merged main. Auto-DDL before an independent
// database+key restore would turn a normal PR merge into an irreversible live
// mutation. Migrations are a separate operator action via db:migrate after
// protected staging, verified backup/restore and an approved release window.
// Even an inherited/mistaken SAVANT_MIGRATE_ON_BUILD=1 cannot override this.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

if (process.env.VERCEL_ENV === "production") {
  console.log("[migrate-on-deploy] Production schema migration is disabled during builds; use the separately authorized db:migrate operation after recovery acceptance.");
  process.exit(0);
}
if (process.env.SAVANT_MIGRATE_ON_BUILD !== "1") {
  console.log(`[migrate-on-deploy] Skipping schema migration (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}; explicit nonproduction opt-in absent).`);
  process.exit(0);
}

// DDL should use the direct (non-pooled) connection when the provider offers one.
const databaseUrl = [
  process.env.DATABASE_URL_UNPOOLED,
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.DATABASE_URL,
].find((value) => typeof value === "string" && value.trim() && !value.trim().startsWith("<"));

if (!databaseUrl) {
  console.error("[migrate-on-deploy] No DATABASE_URL is available to the production build.");
  process.exit(1);
}

console.log("[migrate-on-deploy] Applying db/schema to the production database...");
const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, "apply-db-schema.mjs")], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

if (result.status !== 0) {
  console.error("[migrate-on-deploy] Schema migration failed; aborting the deploy.");
  process.exit(result.status ?? 1);
}

console.log("[migrate-on-deploy] Schema is up to date.");
