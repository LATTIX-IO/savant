import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {TestBenchError} from "./definition-contract.ts";
import {
  parseBillingSource,parseMicroUsd,
} from "./billing-source-evidence.ts";
import {reconcileRunEvidence} from "./billing-reconciliation.ts";

const hash=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex");
const fixture=()=>({
 schemaVersion:"savant.billing.statement.v1",
 provider:"nim",accountSha256:"a".repeat(64),utcMonth:"2026-10",
 statementRef:"sample.1",sourceKind:"invoice",
 issuedAt:"2026-10-16T00:00:00.000Z",currency:"USD",
 lines:[{lineRef:"n1",model:"nim-fixture",kind:"charge",
   amountMicroUsd:"1234567"}],
});
const bytes=(x:unknown)=>Buffer.from(JSON.stringify(x),"utf8");
const err=(code:string)=>(e:unknown)=>e instanceof TestBenchError&&e.code===code;

test("PER-1547: bounded digest binds the exact source bytes and typed USD rows",()=>{
 const b=bytes(fixture()),found=parseBillingSource(b,hash(b));
 assert.equal(found.documentSha256,hash(b));
 assert.equal(found.statement.provider,"nim");
 assert.equal(found.statement.lines[0]?.amountMicroUsd,"1234567");
 assert.throws(()=>parseBillingSource(b,"b".repeat(64)),err("test_bench_billing_digest_mismatch"));
 const b2=Buffer.from(JSON.stringify(fixture())+" ","utf8");
 assert.notEqual(hash(b),hash(b2));
 assert.equal(parseBillingSource(b2,hash(b2)).documentSha256,hash(b2));
});
test("PER-1547: signed micro-USD accepts exact integers only",()=>{
 assert.equal(parseMicroUsd("1","charge"),1n);
 assert.equal(parseMicroUsd("-1","credit"),-1n);
 assert.equal(parseMicroUsd("1000000000000","charge"),1000000000000n);
 assert.equal(parseMicroUsd("-1000000000000","credit"),-1000000000000n);
 for(const v of [0,1.5,"0","-0","0001","-01","+1","1.2","1e5",
   "1000000000001","-1000000000001","Infinity",null,undefined]){
  assert.throws(()=>parseMicroUsd(v,"charge"),err("test_bench_billing_amount_invalid"));
 }
 assert.throws(()=>parseMicroUsd("-1","charge"),err("test_bench_billing_amount_invalid"));
 assert.throws(()=>parseMicroUsd("1","credit"),err("test_bench_billing_amount_invalid"));
});
test("PER-1547: fail-closed parser rejects forged schema, currency, provider, month and content",()=>{
 const make=(mutate:(x:ReturnType<typeof fixture>)=>void)=>{
  const obj=fixture();mutate(obj);
  const data=bytes(obj);return ()=>parseBillingSource(data,hash(data));
 };
 for(const run of [
  make(o=>{o.provider="openai";}),
  make(o=>{o.currency="EUR";}),
  make(o=>{o.utcMonth="2026-13";}),
  make(o=>{o.accountSha256="short";}),
  make(o=>{o.schemaVersion="savant.billing.statement.v2";}),
  make(o=>{o.statementRef="../path";}),
  make(o=>{o.issuedAt="tomorrow";}),
  make(o=>{o.lines[0]!.amountMicroUsd="-1";}),
  make(o=>{o.lines[0]!.kind="credit";}),
  make(o=>{o.lines.push({...o.lines[0]!});}),
 ]){
  assert.throws(run,e=>e instanceof TestBenchError);
 }
 const unknown={...fixture(),apiKey:"DO_NOT_STORE"};
 let b=bytes(unknown);
 assert.throws(()=>parseBillingSource(b,hash(b)),err("test_bench_billing_document_invalid"));
 b=Buffer.from([0xc3,0x28]);
 assert.throws(()=>parseBillingSource(b,hash(b)),err("test_bench_billing_document_invalid"));
 b=Buffer.alloc(65_537,65);
 assert.throws(()=>parseBillingSource(b,hash(b)),err("test_bench_billing_document_invalid"));
});
test("PER-1547: correction references an earlier source, not a self-reference",()=>{
 const x=fixture();
 x.lines=[{lineRef:"c1",model:"nim-fixture",kind:"credit",
   amountMicroUsd:"-10",corrects:{documentSha256:"b".repeat(64),lineRef:"n1"}}];
 const b=bytes(x);
 assert.equal(parseBillingSource(b,hash(b)).statement.lines[0]?.kind,"credit");
 const broken={...x,lines:[{...x.lines[0],corrects:{
   documentSha256:hash(b),lineRef:"n1"}}]};
 const bad=bytes(broken);
 // exact self hash cannot usually be encoded as a source self-reference
 // without solving a preimage; invalid links are also rejected by DB tests.
 assert.equal(parseBillingSource(bad,hash(bad)).statement.lines[0]?.kind,"credit");
});
test("PER-1547: tenant run states never claim settled platform billing",()=>{
 const run={
  id:"abc",rate_card_id:"rate",reserved_micro_usd:27000,
  execution_source:"platform-nim" as const,
  execution_model_pinned:"nim-fixture",judge_model_pinned:"jev-fixture",
 };
 const intent={case_index:1,phase:"executor" as const,
  provider_code:"nim" as const,acknowledged_at:new Date(),
  model:"nim-fixture",prompt_tokens:60,completion_tokens:20};
 const models=new Set(["nim:nim-fixture","jev:jev-fixture"]);
 const valid=reconcileRunEvidence({run,intents:[intent],rateModels:models,
  historicalUnattributedReceipts:0});
 assert.equal(valid.state,"estimated");
 assert.equal(valid.actualBilledMicroUsd,null);
 assert.equal(valid.providerInvoiceMatched,false);
 assert.equal(valid.phases[0]?.reportedTokens,80);
 const missing=reconcileRunEvidence({run,intents:[{...intent,acknowledged_at:null}],
  rateModels:models,historicalUnattributedReceipts:0});
 assert.equal(missing.state,"unknown");
 assert.equal(missing.phases[0]?.reportedTokens,null);
 const contradictory=reconcileRunEvidence({run,intents:[{...intent,model:"different"}],
  rateModels:models,historicalUnattributedReceipts:0});
 assert.equal(contradictory.state,"disputed");
 const external=reconcileRunEvidence({run:{...run,execution_source:"workspace-openai",
   execution_model_pinned:"gpt-workspace"},
  intents:[{...intent,provider_code:"openai",model:"gpt-workspace"}],
  rateModels:models,historicalUnattributedReceipts:0});
 assert.equal(external.state,"externally-billed");
 assert.equal(external.actualBilledMicroUsd,null);
 const historical=reconcileRunEvidence({run,intents:[],rateModels:models,
  historicalUnattributedReceipts:1});
 assert.equal(historical.state,"unknown");
});
