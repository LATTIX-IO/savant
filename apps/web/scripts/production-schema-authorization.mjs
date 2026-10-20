import {createPublicKey, verify} from "node:crypto";
import {readFileSync} from "node:fs";

/** The pilot is owner-operated and has no customer accounts.
 * A signature records operator authorization, not independent Neon attestation.
 * No production DB migration is ever authorized from a Vercel build/runtime.
 */
export const PRODUCTION_PROJECT_ID = "prj_0IlFmCr7MplvLgD8C3sLKgazxXwl";
export const PRODUCTION_RECEIPT_SCHEMA = "savant.production-mvp-schema-recovery.v1";
export const PRODUCTION_CONFIRM = "--confirm=APPLY-SAVANT-PRODUCTION-MVP-SCHEMA";
export const PRODUCTION_MIGRATIONS = Object.freeze(
  Array.from({length: 21}, (_, i) => String(15 + i).padStart(4, "0"))
);
export const PRODUCTION_ONLY = "--only=" + PRODUCTION_MIGRATIONS.join(",");
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DB_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/;
const DB_ROLE = /^[a-z][a-z0-9_]{2,63}$/;
const CHECKS = Object.freeze([
  "productionRecoveryPointVerified",
  "restoreOnDistinctComputeVerified",
  "rollbackRevisionVerified",
  "syntheticTenantScopeVerified",
]);

export class ProductionSchemaAuthorizationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "ProductionSchemaAuthorizationError";
  }
}
function deny(code) {throw new ProductionSchemaAuthorizationError(code);}
function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
function parseTarget(raw) {
  if (typeof raw !== "string" || raw.length > 4096 || /[\r\n]/.test(raw))
    deny("production_database_target_invalid");
  let uri;
  try {uri = new URL(raw);} catch {deny("production_database_target_invalid");}
  if (!["postgres:", "postgresql:"].includes(uri.protocol) || uri.hash ||
      !uri.hostname.toLowerCase().endsWith(".neon.tech") ||
      uri.hostname.toLowerCase().includes("-pooler") || !uri.username ||
      !uri.password || !uri.pathname.startsWith("/") ||
      [...uri.searchParams.keys()].some(k => !["sslmode", "channel_binding"].includes(k)) ||
      !["require", "verify-full", "verify-ca"].includes(uri.searchParams.get("sslmode")) ||
      (uri.searchParams.has("channel_binding") &&
        !["require", "prefer"].includes(uri.searchParams.get("channel_binding")))) {
    deny("production_database_target_invalid");
  }
  let database, role;
  try {
    database = decodeURIComponent(uri.pathname.slice(1));
    role = decodeURIComponent(uri.username);
  } catch {deny("production_database_target_invalid");}
  if (!DB_NAME.test(database) || !DB_ROLE.test(role))
    deny("production_database_target_invalid");
  return {host: uri.hostname.toLowerCase(), database, role};
}
function requireReceipt({receiptFile, trustFile, nowMs}) {
  let receipt, key;
  try {
    if (typeof receiptFile !== "string" || !receiptFile ||
        typeof trustFile !== "string" || !trustFile)
      deny("production_recovery_proof_missing");
    receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    key = createPublicKey(readFileSync(trustFile, "utf8"));
  } catch {deny("production_recovery_proof_missing");}
  if (!exactKeys(receipt, ["payload", "signature"]) ||
      key.asymmetricKeyType !== "ed25519" ||
      typeof receipt.signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature))
    deny("production_recovery_proof_invalid");
  const signature = Buffer.from(receipt.signature, "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== receipt.signature ||
      !verify(null, Buffer.from(JSON.stringify(receipt.payload), "utf8"), key, signature))
    deny("production_recovery_proof_invalid");
  const p = receipt.payload;
  if (!exactKeys(p, [
    "schema", "issuer", "repository", "vercelProjectId", "neonProjectId",
    "sourceCommitSha", "targetDatabaseHost", "targetDatabaseName", "targetDatabaseRole",
    "recoveryPointId", "restoredBranchId", "restoredDatabaseHost", "evidenceDigest",
    "issuedAt", "expiresAt", "checks"
  ]) ||
      p.schema !== PRODUCTION_RECEIPT_SCHEMA ||
      p.issuer !== "savant-owner-production-mvp" ||
      p.repository !== "LATTIX-IO/savant" ||
      p.vercelProjectId !== PRODUCTION_PROJECT_ID ||
      !SAFE_ID.test(p.neonProjectId) || !HEX40.test(p.sourceCommitSha) ||
      !DB_NAME.test(p.targetDatabaseName) || !DB_ROLE.test(p.targetDatabaseRole) ||
      !SAFE_ID.test(p.recoveryPointId) || !SAFE_ID.test(p.restoredBranchId) ||
      p.recoveryPointId === p.restoredBranchId ||
      typeof p.targetDatabaseHost !== "string" ||
      typeof p.restoredDatabaseHost !== "string" ||
      p.targetDatabaseHost.toLowerCase() === p.restoredDatabaseHost.toLowerCase() ||
      !HEX64.test(p.evidenceDigest) || !exactKeys(p.checks, CHECKS) ||
      !CHECKS.every(name => p.checks[name] === true) ||
      !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(p.issuedAt) ||
      !Number.isSafeInteger(p.expiresAt) || nowMs < p.issuedAt ||
      nowMs > p.expiresAt || p.expiresAt <= p.issuedAt ||
      p.expiresAt - p.issuedAt > 30 * 60 * 1000)
    deny("production_recovery_proof_invalid");
  return p;
}

/** Production DDL stays a standalone explicitly authorized local CLI action.
 * Requires evidence of an actual Neon recovery point + tested detached restore,
 * but the operator must independently verify provider evidence before signing.
 */
export function authorizeProductionMvpSchemaApply({
  env = process.env, argv = [], databaseUrl, nowMs = Date.now()
} = {}) {
  if (env.VERCEL === "1" || env.VERCEL_ENV ||
      env.CI === "true" || env.GITHUB_ACTIONS === "true")
    deny("production_migration_runtime_disallowed");
  if (env.SAVANT_SCHEMA_APPLY_TARGET !== "production-mvp" ||
      env.SAVANT_PRODUCTION_VERCEL_PROJECT_ID !== PRODUCTION_PROJECT_ID ||
      !HEX40.test(env.SAVANT_SCHEMA_EXACT_MAIN_SHA || "") ||
      typeof env.SAVANT_PRODUCTION_NEON_PROJECT_ID !== "string" ||
      !SAFE_ID.test(env.SAVANT_PRODUCTION_NEON_PROJECT_ID))
    deny("production_migration_context_untrusted");
  if (!Array.isArray(argv) || argv.length !== 2 ||
      !argv.includes(PRODUCTION_CONFIRM) || !argv.includes(PRODUCTION_ONLY))
    deny("production_migration_args_invalid");
  const db = parseTarget(databaseUrl);
  const proof = requireReceipt({
    receiptFile: env.SAVANT_PRODUCTION_RECOVERY_RECEIPT_FILE,
    trustFile: env.SAVANT_PRODUCTION_RECOVERY_TRUST_KEY_FILE, nowMs
  });
  if (proof.neonProjectId !== env.SAVANT_PRODUCTION_NEON_PROJECT_ID ||
      proof.sourceCommitSha !== env.SAVANT_SCHEMA_EXACT_MAIN_SHA ||
      proof.targetDatabaseHost.toLowerCase() !== db.host ||
      proof.targetDatabaseName !== db.database ||
      proof.targetDatabaseRole !== db.role ||
      proof.restoredDatabaseHost.toLowerCase() === db.host)
    deny("production_migration_receipt_target_mismatch");
  return Object.freeze({
    scope: "signed-production-mvp", authorized: true,
    commitSha: proof.sourceCommitSha, evidenceDigest: proof.evidenceDigest
  });
}
