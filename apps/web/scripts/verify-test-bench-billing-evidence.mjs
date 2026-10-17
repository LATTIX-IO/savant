import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import postgres from "postgres";
import {
  createPlatformBillingSourceStore,
} from "../src/server/test-bench/billing-source-evidence.ts";
import {
  createRunBillingEvidenceReader,
} from "../src/server/test-bench/billing-reconciliation.ts";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {createObservedProviderCallIntentStore} from "../src/server/test-bench/provider-call-intents.ts";
import {createObservedProviderUsageStore} from "../src/server/test-bench/observed-provider-usage.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_BILLING_SOURCE_TEST!=="1"||
  process.env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||
  process.env.SAVANT_BILLING_EPHEMERAL_DATABASE!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("PER-1547 requires explicit ephemeral CI loopback PostgreSQL");
process.env.TEST_BENCH_ENCRYPTION_KEY="29".repeat(32);
const sql=postgres(uri,{max:16,prepare:false});
const sources=createPlatformBillingSourceStore(sql);
const evidence=createRunBillingEvidenceReader(sql);
const definitions=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const intents=createObservedProviderCallIntentStore(sql);
const usage=createObservedProviderUsageStore(sql);
const operator={scope:"platform-billing-operator",subject:"billing-ci"};
const denied=code=>e=>e?.code===code;
const sha=value=>createHash("sha256").update(value).digest("hex");
const raw=value=>Buffer.from(JSON.stringify(value),"utf8");
const suffix=randomUUID().slice(0,8);
const account=sha("provider-account-"+suffix);
const foreignAccount=sha("foreign-account-"+suffix);
const month="2026-10";
const fixture=(ref,lines,accountSha256=account)=>({
  schemaVersion:"savant.billing.statement.v1",
  provider:"nim",accountSha256,utcMonth:month,
  statementRef:ref,sourceKind:"invoice",
  issuedAt:"2026-10-16T00:00:00.000Z",currency:"USD",lines,
});
const charge=(ref,amount="1000000")=>({
  lineRef:ref,model:"nim-fixture",kind:"charge",amountMicroUsd:amount,
});
const credit=(ref,amount,originalDigest,sourceLine="charge-1")=>({
  lineRef:ref,model:"nim-fixture",kind:"credit",amountMicroUsd:amount,
  corrects:{documentSha256:originalDigest,lineRef:sourceLine},
});
const importOne=async(obj,actor=operator)=>{
  const b=raw(obj);
  return sources.import(actor,b,sha(b));
};
const docs=async()=>sql`
  select count(*)::int as n from test_bench_billing_documents
  where provider_code='nim' and account_sha256=${account}
`;
const orgs=[];
async function tenant(label){
 const [org]=await sql`insert into organizations(slug,display_name)
  values(${"billing-"+label+"-"+suffix},${"Billing "+label}) returning id`;
 orgs.push(org.id);
 const [repo]=await sql`insert into repositories(
  organization_id,provider_type,owner_name,repo_name,default_branch)
  values(${org.id},'github',${"billing-"+label},${"repo-"+suffix},'main')
  returning id`;
 const skillId="billing-"+label+"-"+suffix;
 await sql`insert into indexed_skills(
   organization_id,repository_id,skill_id,display_name,tier,status,
   source_path,source_commit_sha,content_hash
 ) values(${org.id},${repo.id},${skillId},'Billing fixture','tier1',
  'active',${"skills/"+skillId},${"a".repeat(40)},'hash')`;
 const actor={organizationId:org.id,subject:"admin-"+label,role:"admin"};
 const suite=(await definitions.create(actor,skillId,{
  name:"Billing scope fixture",requestId:randomUUID(),
  cases:[{caseId:"c1",kind:"positive",prompt:"PRIVATE_RUN_PROMPT_NEVER_STORE",
   context:null,expectedBehavior:"4"}],
 })).definition;
 return {orgId:org.id,repoId:repo.id,actor,skillId,suite};
}
try{
 const source=fixture("statement-"+suffix,[charge("charge-1")]);
 // Unprivileged actor cannot import regardless of contents or digest.
 await assert.rejects(()=>importOne(source,{scope:"tenant",subject:"admin"}),
   denied("test_bench_billing_operator_forbidden"));
 const payload=raw(source);
 const digest=sha(payload);
 const results=await Promise.allSettled(Array.from({length:12},
  ()=>sources.import(operator,payload,digest)));
 const accepted=results.filter(x=>x.status==="fulfilled"&&x.value.inserted);
 const replayed=results.filter(x=>x.status==="fulfilled"&&!x.value.inserted);
 assert.equal(accepted.length,1);
 assert.equal(replayed.length,11);
 assert.equal(results.filter(x=>x.status==="rejected").length,0);
 assert.equal((await docs())[0].n,1);
 assert.equal(results.filter(x=>x.status==="fulfilled")
  .every(x=>x.value.documentId===accepted[0].value.documentId),true);
 const sourceId=accepted[0].value.documentId;
 await assert.rejects(()=>sources.import(operator,payload,"0".repeat(64)),
  denied("test_bench_billing_digest_mismatch"));
 // Same operator statement reference + different bytes cannot silently overwrite.
 await assert.rejects(()=>importOne(fixture("statement-"+suffix,
  [charge("charge-1","1000001")])),
 denied("test_bench_billing_statement_conflict"));
 const forged={...source,secretHeader:"PRIVATE_SECRET_BILLING_CONTENT"};
 await assert.rejects(()=>importOne(forged),
   denied("test_bench_billing_document_invalid"));

 const cred=fixture("credit-"+suffix,[credit("credit-1","-300000",digest)]);
 const firstCredit=await importOne(cred);
 assert.equal(firstCredit.inserted,true);
 assert.equal((await sources.accountSummary(operator,"nim",account,month))
  .models[0].unverified_micro_usd,"700000");

 // Corrections must remain on same provider account, model and original
 // positive charge. Cumulative signed credits cannot exceed original amount.
 await assert.rejects(()=>importOne(fixture("wrong-model-"+suffix,[{
  ...credit("credit-m","-1",digest),model:"forged-model",
 }])),denied("test_bench_billing_correction_invalid"));
 await assert.rejects(()=>importOne(fixture("overcredit-"+suffix,
   [credit("credit-2","-700001",digest)])),
   denied("test_bench_billing_overcredit"));
 assert.equal((await docs())[0].n,2,"failed imports cannot leave document");
 await assert.rejects(()=>importOne(fixture("foreign-correction-"+suffix,
  [credit("credit-3","-10",digest)],foreignAccount)),
  denied("test_bench_billing_correction_invalid"));
 // Direct SQL also cannot use a valid charge from platform account A as a
 // credit target under platform account B; this exercises the COMPOSITE FK,
 // not merely rejection of an absent random correction UUID.
 const foreignDoc=await importOne(fixture("foreign-source-"+suffix,
   [charge("foreign-positive","500000")],foreignAccount));
 const [realCharge]=await sql`select id from test_bench_billing_lines
   where document_id=${sourceId} and line_ref='charge-1'`;
 await assert.rejects(()=>sql`insert into test_bench_billing_lines(
   id,document_id,provider_code,account_sha256,utc_month,
   line_ref,model,line_kind,amount_micro_usd,corrects_line_id
 ) values(${randomUUID()},${foreignDoc.documentId},'nim',
   ${foreignAccount},${month+"-01"}::date,
   'forged-cross-account-credit','nim-fixture','credit',-1,
   ${realCharge.id})`,e=>e?.code==="23503");

 // Schema defense in depth; immutable evidence cannot be changed or purged.
 await assert.rejects(()=>sql`update test_bench_billing_documents
  set statement_ref='tampered' where id=${sourceId}`,e=>e?.code==="P0001");
 const [line]=await sql`select id from test_bench_billing_lines
  where document_id=${sourceId} and line_ref='charge-1'`;
 await assert.rejects(()=>sql`update test_bench_billing_lines
  set amount_micro_usd=1 where id=${line.id}`,e=>e?.code==="P0001");
 await assert.rejects(()=>sql`delete from test_bench_billing_lines
  where id=${line.id}`,e=>e?.code==="P0001");
 await assert.rejects(()=>sql`insert into test_bench_billing_lines(
  id,document_id,provider_code,account_sha256,utc_month,
  line_ref,model,line_kind,amount_micro_usd,corrects_line_id
 ) values(${randomUUID()},${firstCredit.documentId},'nim',${account},
  ${month+"-01"}::date,'illegal-credit','nim-fixture','credit',-1,
  ${randomUUID()})`,e=>e?.code==="23503");

 // Freeze means immutable import boundary, not provider financial closure.
 await sources.freezePeriod(operator,"nim",account,month);
 await sources.freezePeriod(operator,"nim",account,month);
 await assert.rejects(()=>importOne(fixture("after-freeze-"+suffix,
  [charge("charge-new")])),denied("test_bench_billing_period_frozen"));
 await assert.rejects(()=>sql`update test_bench_billing_periods
   set frozen_at=null,frozen_by=null
   where provider_code='nim' and account_sha256=${account}
     and utc_month=${month+"-01"}::date`,e=>e?.code==="P0001");

 // Per-run interpretation is tenant-scoped and deliberately NOT joined to
 // a platform account invoice. A provider timeout remains UNKNOWN.
 const a=await tenant("a"),b=await tenant("b");
 const {run}=await runs.start(a.actor,a.skillId,a.suite.id,{
  expectedRevision:1,requestId:randomUUID(),executionSource:"platform-nim"});
 const [saved]=await sql`select job_id from test_bench_runs where id=${run.id}`;
 const began=await runs.beginJob(a.orgId,a.repoId,run.id,saved.job_id,1);
 assert.ok(began);
 await intents.record(a.orgId,run.id,saved.job_id,{index:1,phase:"executor"});
 let recon=await evidence.read(a.orgId,run.id);
 assert.equal(recon.state,"unknown");
 assert.equal(recon.phases[0].receiptAcknowledged,false);
 assert.equal(recon.phases[0].reportedTokens,null);
 assert.equal(recon.actualBilledMicroUsd,null);
 assert.equal(recon.providerInvoiceMatched,false);
 await assert.rejects(()=>evidence.read(b.orgId,run.id),
   denied("test_bench_billing_run_not_found"));
 await assert.rejects(()=>evidence.read(randomUUID(),randomUUID()),
   denied("test_bench_billing_run_not_found"));

 await usage.record(a.orgId,run.id,saved.job_id,{
  index:1,phase:"executor",model:"nim-fixture",
  promptTokens:63,completionTokens:17,
 });
 recon=await evidence.read(a.orgId,run.id);
 assert.equal(recon.phases[0].receiptAcknowledged,true);
 assert.equal(recon.phases[0].reportedTokens,80);
 assert.equal(recon.state,"unknown","no rate card or invoice match, never bill 0");
 assert.equal(recon.actualBilledMicroUsd,null);
 const unverified=(await sources.accountSummary(operator,"nim",account,month));
 assert.equal(unverified.actualBilledMicroUsd,null);
 assert.equal(unverified.requestLevelAttribution,false);
 assert.equal(unverified.models[0].unverified_micro_usd,"700000");
 const stored=JSON.stringify(await sql`
  select d.provider_code,d.account_sha256,d.document_sha256,d.statement_ref,
    l.line_ref,l.model,l.amount_micro_usd
  from test_bench_billing_documents d
    join test_bench_billing_lines l on l.document_id=d.id
  where d.provider_code='nim' and d.account_sha256=${account}
 `);
 for(const secret of ["PRIVATE_RUN_PROMPT_NEVER_STORE",
   "PRIVATE_SECRET_BILLING_CONTENT","sk-PROVIDER_TOKEN","Bearer "])
  assert.ok(!stored.includes(secret),"no sensitive document or run data persisted");
 console.log(JSON.stringify({billingSource:"passed",checks:[
  "exact SHA source binding and operator-only interface",
  "12-way identical import: one insert and eleven idempotent replays",
  "conflicting ref and tampered digest rejected",
  "append-only documents, signed USD lines and account-scoped credit constraints",
  "cumulative overcredit and cross-account correction denied",
  "period freeze irreversible and rejects imports",
  "tenant-scoped run evidence; no falsely attributed provider invoices",
  "timeouts remain unknown, provider ACKs remain non-invoiced",
  "no plaintext prompt, provider secrets or billing source content persisted",
 ]}));
}finally{
 // Do not remove immutable source records: this entire CI database is ephemeral.
 // Tenant fixture cascade only; approved source records remain for verification.
 for(const id of orgs)
  await sql`delete from organizations where id=${id}`;
 await sql.end({timeout:5});
}
