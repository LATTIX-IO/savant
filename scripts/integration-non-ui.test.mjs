import assert from "node:assert/strict";
import {readFileSync,readdirSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve,join} from "node:path";
import test from "node:test";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const workflow=readFileSync(join(root,".github/workflows/savant-typescript.yml"),"utf8");
const schemaPath=join(root,"db/schema");

test("INTEGRATION: all 35 staged schema revisions exist in strict order",()=>{
 const sql=readdirSync(schemaPath).filter(s=>/^\d{4}_.*\.sql$/.test(s)).sort();
 assert.equal(sql.length,35);
 const seq=sql.map(s=>Number(s.slice(0,4)));
 assert.deepEqual(seq,Array.from({length:35},(_,i)=>i+1));
});

test("INTEGRATION: actual isolated PostgreSQL workflow executes all four product domains",()=>{
 const postgres=workflow.split("\n  workflow-postgres:")[1];
 assert.ok(postgres,"PostgreSQL workflow must exist");
 for(const symbol of [
   "SAVANT_HARNESS_SCHEMA_TEST: \"1\"",
   "verify-harness-reservations.mjs","verify-harness-signing-keys.mjs",
   "verify-harness-dispatch-leases.mjs","verify-harness-dispatch-worker.mjs",
   "verify-harness-provider-reconciliation.mjs","verify-harness-signed-status.mjs",
   "verify-harness-status-connector-config.mjs","verify-harness-azure-vault.mjs",
   "verify-test-bench-definitions.mjs","verify-observed-run-comparison.mjs",
   "verify-tenant-openai-test-bench.mjs","verify-provider-call-intents.mjs",
   "verify-test-bench-billing-evidence.mjs","verify-versioned-keyring-persistence.mjs",
   "verify-managed-ciphertext-rewrap.mjs","verify-ephemeral-db-backup-restore.mjs",
   "verify-crypto-maintenance-admission.mjs"
 ]){
   assert.equal(postgres.split(symbol).length,2,"Exactly one stage: "+symbol);
 }
 assert.ok(postgres.indexOf("Reapply migrations to prove idempotency")<
    postgres.indexOf("Verify durable harness invocation"));
 assert.ok(postgres.indexOf("Verify approved rates, tenant budgets")<
    postgres.indexOf("Verify immutable billing source ingestion"));
});

test("INTEGRATION: CI retains supply-chain and Python telemetry security gates",()=>{
 assert.match(workflow,/name: Blocking production dependency audit \(high\/critical\)/);
 assert.match(workflow,/run: pnpm run security:deps/);
 const pkg=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
 assert.equal(pkg.scripts?.["security:deps"],"pnpm audit --prod --audit-level high");
 assert.match(workflow,/node scripts\/verify-github-actions-pins\.mjs/);
 assert.match(workflow,/python3 -m unittest discover -s sdks\/python/);
 assert.match(workflow,/name: Savant unit, type, lint, build and secrets/);
 assert.equal((workflow.match(/uses: actions\/checkout@[a-f0-9]{40}/g)||[]).length,3);
 assert.equal((workflow.match(/persist-credentials: false/g)||[]).length,3);
 assert.doesNotMatch(workflow,/uses:\s+(?:actions|pnpm)\/[^\s@]+@(?:v\d+|main|master)/);
});

test("INTEGRATION: staged adapters and core security implementations remain present",()=>{
 for(const file of [
  "apps/web/src/server/harness/azure-vault-hmac.ts",
  "apps/web/src/server/harness/aks-projected-assertion.ts",
  "apps/web/src/server/harness/dispatch-worker.ts",
  "apps/web/src/server/test-bench/billing-source-evidence.ts",
  "apps/web/src/server/security/crypto-maintenance-authorization.ts",
  "apps/web/src/server/security/crypto-maintenance-oidc-runtime.ts",
  "apps/web/src/server/test-bench/definition-crypto.ts",
  "scripts/release-governance-bootstrap.mjs",
  "scripts/direct-cli-invocation.mjs"
 ]) assert.equal(existsSync(join(root,file)),true,file);
});
