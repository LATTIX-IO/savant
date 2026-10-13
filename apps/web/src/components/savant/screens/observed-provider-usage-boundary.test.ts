import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("PER-1447: Test Bench displays observed phase tokens for incomplete runs without claiming bills",async()=>{
 const ui=await readFile(new URL("./observed-test-bench-run-panel.tsx",import.meta.url),"utf8");
 const client=await readFile(new URL("../../../lib/observed-test-bench-runs.ts",import.meta.url),"utf8");
 assert.match(ui,/Acknowledged provider usage:/);
 assert.match(ui,/observedExecutorTokens/);
 assert.match(ui,/observedJudgeTokens/);
 assert.match(ui,/observedUsageReceipts/);
 assert.match(ui,/not an invoice/);
 assert.match(ui,/Missing receipts can/);
 assert.match(client,/observedExecutorTokens/);
 assert.match(client,/observedUsageReceipts/);
 assert.doesNotMatch(ui,/providerBillAmount|actualInvoice|chargedUsd|simulateCustomEvaluationTest/);
});
test("PER-1447: source uses real provider token usage and commits ACK before future egress",async()=>{
 const evaluator=await readFile(new URL("../../../server/test-bench/observed-evaluator.ts",import.meta.url),"utf8");
 const worker=await readFile(new URL("../../../server/test-bench/observed-run-worker.ts",import.meta.url),"utf8");
 const receipt=await readFile(new URL("../../../server/test-bench/observed-provider-usage.ts",import.meta.url),"utf8");
 const schema=await readFile(new URL("../../../../../db/schema/0029_test_bench_provider_usage_receipts.sql",import.meta.url),"utf8");
 assert.match(evaluator,/await input\.onUsage\?\.\(\{index:index\+1,phase:"executor"/);
 assert.match(evaluator,/await input\.onUsage\?\.\(\{index:index\+1,phase:"judge"/);
 assert.match(worker,/await usageStore\.record\(row\.organization_id,row\.id,job\.id,receipt\)/);
 assert.match(worker,/beforeJudge:ensureNotCanceled/);
 assert.match(receipt,/for update/);
 assert.match(receipt,/test_bench_usage_receipt_conflict/);
 assert.match(receipt,/observed_usage_receipts=observed_usage_receipts\+1/);
 assert.match(schema,/foreign key\(organization_id,run_id\)/);
 assert.match(schema,/primary key\(organization_id,run_id,case_index,phase\)/);
 assert.doesNotMatch(schema,/api_key|prompt_content|raw_output|invoice_usd/);
});
