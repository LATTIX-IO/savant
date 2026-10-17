import {createHash,randomUUID} from "node:crypto";
import {TextDecoder} from "node:util";
import type {Sql} from "postgres";
import {TestBenchError} from "./definition-contract.ts";

/** PER-1547: platform-only offline document import.
 * Operator-supplied content is UNVERIFIED. It is never an invoice settlement,
 * tenant charge, cost cap or proof that the provider authenticated the source.
 */
const HASH=/^[a-f0-9]{64}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const MODEL=/^[^\u0000-\u001f\u007f]{1,160}$/;
const MONTH=/^(\d{4})-(0[1-9]|1[0-2])$/;
const MICRO=/^-?(?:0|[1-9]\d{0,12})$/;
const MAX_AMOUNT=1_000_000_000_000n;
const MAX_DOCUMENT=65_536;
const MAX_LINES=64;
const deny=(code:string,status=422):never=>{throw new TestBenchError(code,status);};
type Provider="nim"|"jev";
export type BillingOperator={
  subject:string;
  scope:"platform-billing-operator";
};
export type BillingCorrection={
  documentSha256:string;lineRef:string;
};
export type BillingLineInput={
  lineRef:string;model:string;kind:"charge"|"credit";
  amountMicroUsd:string;corrects?:BillingCorrection;
};
export type BillingStatementInput={
  schemaVersion:"savant.billing.statement.v1";
  provider:Provider;accountSha256:string;utcMonth:string;
  statementRef:string;sourceKind:"invoice"|"rated_usage";
  issuedAt:string;currency:"USD";lines:BillingLineInput[];
};
export type BillingImportResult={
  documentId:string;documentSha256:string;inserted:boolean;
  provenance:"unverified";
};
function exactKeys(value:unknown,required:string[],optional:string[]=[]):void{
  if(!value||typeof value!=="object"||Array.isArray(value))
    deny("test_bench_billing_document_invalid");
  const found=Object.keys(value);
  if(required.some(key=>!Object.hasOwn(value,key))||
    found.some(key=>!required.includes(key)&&!optional.includes(key)))
    deny("test_bench_billing_document_invalid");
}
export function validateBillingAccount(provider:unknown,accountSha:unknown,
  utcMonth:unknown):asserts provider is Provider{
  if((provider!=="nim"&&provider!=="jev")||typeof accountSha!=="string"||
    !HASH.test(accountSha)||typeof utcMonth!=="string"||!MONTH.test(utcMonth))
    deny("test_bench_billing_scope_invalid");
}
export function parseMicroUsd(value:unknown,kind:"charge"|"credit"):bigint{
  if(typeof value!=="string"||!MICRO.test(value)||value==="-0")
    return deny("test_bench_billing_amount_invalid");
  const n=BigInt(value);
  if(n===0n||n>MAX_AMOUNT||n< -MAX_AMOUNT||
    (kind==="charge"&&n<0n)||(kind==="credit"&&n>0n))
    return deny("test_bench_billing_amount_invalid");
  return n;
}
function verifyOperator(actor:BillingOperator):void{
  // Caller must already hold server-side platform-operator authorization.
  // No tenant HTTP route may accept, infer or construct this capability.
  if(!actor||actor.scope!=="platform-billing-operator"||
    typeof actor.subject!=="string"||!REF.test(actor.subject))
    deny("test_bench_billing_operator_forbidden",403);
}
export function parseBillingSource(bytes:Uint8Array,
  expectedDocumentSha256:string):{
    statement:BillingStatementInput;documentSha256:string;
  }{
  if(!(bytes instanceof Uint8Array)||bytes.length<2||
    bytes.length>MAX_DOCUMENT||typeof expectedDocumentSha256!=="string"||
    !HASH.test(expectedDocumentSha256))
    return deny("test_bench_billing_document_invalid");
  const documentSha256=createHash("sha256").update(bytes).digest("hex");
  if(documentSha256!==expectedDocumentSha256)
    return deny("test_bench_billing_digest_mismatch",409);
  let parsed:unknown;
  try{
    parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }catch{
    return deny("test_bench_billing_document_invalid");
  }
  exactKeys(parsed,["schemaVersion","provider","accountSha256","utcMonth",
    "statementRef","sourceKind","issuedAt","currency","lines"]);
  const data=parsed as BillingStatementInput;
  if(data.schemaVersion!=="savant.billing.statement.v1"||
    data.sourceKind!=="invoice"&&data.sourceKind!=="rated_usage"||
    data.currency!=="USD"||typeof data.statementRef!=="string"||
    !REF.test(data.statementRef)||typeof data.issuedAt!=="string"||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(data.issuedAt)||
    !Number.isFinite(Date.parse(data.issuedAt))||
    new Date(data.issuedAt).toISOString()!==data.issuedAt||
    !Array.isArray(data.lines)||data.lines.length<1||data.lines.length>MAX_LINES)
    return deny("test_bench_billing_document_invalid");
  validateBillingAccount(data.provider,data.accountSha256,data.utcMonth);
  const seen=new Set<string>();
  for(const line of data.lines){
    exactKeys(line,["lineRef","model","kind","amountMicroUsd"],["corrects"]);
    if(typeof line.lineRef!=="string"||!REF.test(line.lineRef)||
      seen.has(line.lineRef)||typeof line.model!=="string"||
      !MODEL.test(line.model)||!line.model.trim()||
      (line.kind!=="charge"&&line.kind!=="credit"))
      return deny("test_bench_billing_line_invalid");
    seen.add(line.lineRef);
    parseMicroUsd(line.amountMicroUsd,line.kind);
    if(line.kind==="credit"){
      exactKeys(line.corrects,["documentSha256","lineRef"]);
      if(!line.corrects||typeof line.corrects.documentSha256!=="string"||
        !HASH.test(line.corrects.documentSha256)||
        typeof line.corrects.lineRef!=="string"||
        !REF.test(line.corrects.lineRef))
        return deny("test_bench_billing_correction_invalid");
      if(line.corrects.documentSha256===documentSha256)
        return deny("test_bench_billing_correction_invalid");
    }else if(line.corrects!==undefined){
      return deny("test_bench_billing_correction_invalid");
    }
  }
  return {statement:data,documentSha256};
}
export function createPlatformBillingSourceStore(sql:Sql){
  return {
    /** Duplicate exact source bytes + statement reference replay safely.
     * Different bytes under same provider/account/reference are a dispute.
     */
    async import(actor:BillingOperator,bytes:Uint8Array,
      expectedSha256:string):Promise<BillingImportResult>{
      verifyOperator(actor);
      const {statement:s,documentSha256:digest}=
        parseBillingSource(bytes,expectedSha256);
      const month=s.utcMonth+"-01";
      return sql.begin(async tx=>{
        await tx`
          insert into test_bench_billing_periods(
            provider_code,account_sha256,utc_month
          ) values (${s.provider},${s.accountSha256},${month}::date)
          on conflict(provider_code,account_sha256,utc_month) do nothing
        `;
        const [period]=await tx<{frozen_at:Date|null}[]>`
          select frozen_at from test_bench_billing_periods
          where provider_code=${s.provider} and account_sha256=${s.accountSha256}
            and utc_month=${month}::date for update
        `;
        if(!period||period.frozen_at)
          return deny("test_bench_billing_period_frozen",409);
        const [prior]=await tx<{id:string;document_sha256:string}[]>`
          select id,document_sha256 from test_bench_billing_documents
          where provider_code=${s.provider} and account_sha256=${s.accountSha256}
            and statement_ref=${s.statementRef}
        `;
        if(prior){
          if(prior.document_sha256===digest)
            return {documentId:prior.id,documentSha256:digest,
              inserted:false,provenance:"unverified" as const};
          return deny("test_bench_billing_statement_conflict",409);
        }
        const [sameBytes]=await tx<{id:string}[]>`
          select id from test_bench_billing_documents
          where provider_code=${s.provider} and account_sha256=${s.accountSha256}
            and document_sha256=${digest}
        `;
        if(sameBytes)return deny("test_bench_billing_digest_reused",409);
        const docId=randomUUID();
        await tx`
          insert into test_bench_billing_documents(
            id,provider_code,account_sha256,utc_month,statement_ref,
            document_sha256,source_kind,issued_at,imported_by
          ) values (
            ${docId},${s.provider},${s.accountSha256},${month}::date,
            ${s.statementRef},${digest},${s.sourceKind},
            ${s.issuedAt}::timestamptz,${actor.subject}
          )
        `;
        // A correction locks its original charge before checking all earlier
        // credits; a concurrent correction must wait and re-evaluate balance.
        const inBatch=new Map<string,bigint>();
        for(const line of s.lines){
          let originalId:string|null=null;
          if(line.kind==="credit"){
            const link=line.corrects!;
            const [original]=await tx<{
              id:string;model:string;line_kind:string;amount_micro_usd:string;
            }[]>`
              select l.id,l.model,l.line_kind,l.amount_micro_usd
              from test_bench_billing_lines l
                join test_bench_billing_documents d on d.id=l.document_id
              where d.provider_code=${s.provider}
                and d.account_sha256=${s.accountSha256}
                and d.document_sha256=${link.documentSha256}
                and l.line_ref=${link.lineRef}
              for update of l
            `;
            if(!original||original.line_kind!=="charge"||
              original.model!==line.model)
              return deny("test_bench_billing_correction_invalid",409);
            originalId=original.id;
            const [used]=await tx<{used:string}[]>`
              select coalesce(sum(-amount_micro_usd),0)::text as used
              from test_bench_billing_lines where corrects_line_id=${originalId}
            `;
            const extra=inBatch.get(originalId)??0n;
            const credit=-parseMicroUsd(line.amountMicroUsd,"credit");
            if(credit+BigInt(used?.used??"0")+extra>
              BigInt(original.amount_micro_usd))
              return deny("test_bench_billing_overcredit",409);
            inBatch.set(originalId,extra+credit);
          }
          await tx`
            insert into test_bench_billing_lines(
              id,document_id,provider_code,account_sha256,utc_month,
              line_ref,model,line_kind,amount_micro_usd,corrects_line_id
            ) values (
              ${randomUUID()},${docId},${s.provider},${s.accountSha256},
              ${month}::date,${line.lineRef},${line.model},${line.kind},
              ${line.amountMicroUsd},${originalId}
            )
          `;
        }
        return {documentId:docId,documentSha256:digest,
          inserted:true,provenance:"unverified" as const};
      });
    },
    async freezePeriod(actor:BillingOperator,provider:Provider,
      accountSha256:string,utcMonth:string):Promise<void>{
      verifyOperator(actor);
      validateBillingAccount(provider,accountSha256,utcMonth);
      await sql.begin(async tx=>{
        const [period]=await tx<{frozen_at:Date|null}[]>`
          select frozen_at from test_bench_billing_periods
          where provider_code=${provider} and account_sha256=${accountSha256}
            and utc_month=${utcMonth+"-01"}::date for update
        `;
        if(!period)return deny("test_bench_billing_period_unknown",404);
        if(period.frozen_at)return;
        await tx`
          update test_bench_billing_periods set
            frozen_at=now(),frozen_by=${actor.subject}
          where provider_code=${provider} and account_sha256=${accountSha256}
            and utc_month=${utcMonth+"-01"}::date
        `;
      });
    },
    /** This totals UNVERIFIED account statements, not reconciled actual
     * financial charges and never allocations to individual customer runs.
     */
    async accountSummary(actor:BillingOperator,provider:Provider,
      accountSha256:string,utcMonth:string){
      verifyOperator(actor);
      validateBillingAccount(provider,accountSha256,utcMonth);
      const items=await sql<{
        model:string;statement_count:number;line_count:number;
        unverified_micro_usd:string;
      }[]>`
        select l.model,count(distinct l.document_id)::int as statement_count,
          count(*)::int as line_count,
          sum(l.amount_micro_usd)::text as unverified_micro_usd
        from test_bench_billing_lines l
        where l.provider_code=${provider} and l.account_sha256=${accountSha256}
          and l.utc_month=${utcMonth+"-01"}::date
        group by l.model order by l.model
      `;
      return {provider,utcMonth,sourceProvenance:"unverified" as const,
        requestLevelAttribution:false,
        actualBilledMicroUsd:null,models:items};
    },
  };
}
