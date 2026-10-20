/** Pure, strict contract for persisted user-authored Test Bench cases.
 * This layer stores drafts only; it does not execute or score them.
 */
export const MAX_TEST_BENCH_CASES=8;
export const MAX_TEST_BENCH_BYTES=16*1024;
export type TestBenchCaseKind="positive"|"negative"|"edge"|"escalation";
export type TestBenchCase={
  caseId:string;kind:TestBenchCaseKind;prompt:string;
  context:string|null;expectedBehavior:string;
};
export type TestBenchDraft={name:string;cases:TestBenchCase[]};
export type TestBenchDefinition=TestBenchDraft&{
  id:string;skillId:string;sourceCommitSha:string;
  revision:number;createdAt:string;updatedAt:string;
};

export class TestBenchError extends Error{
  readonly code:string;
  readonly status:number;
  constructor(code:string,status=400){
    super(code);this.name="TestBenchError";this.code=code;this.status=status;
  }
}
function invalid(code:string):never{throw new TestBenchError(code,422);}
function obj(value:unknown,allowed:readonly string[],code:string):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))invalid(code);
  const result=value as Record<string,unknown>;
  if(Object.keys(result).some(key=>!allowed.includes(key)))invalid(code);
  return result;
}
const badControl=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function bounded(value:unknown,max:number,code:string):string{
  if(typeof value!=="string"||value.length>max||badControl.test(value))invalid(code);
  const v=value.trim();
  if(!v)invalid(code);
  return v;
}
const CASE_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const kinds=new Set<TestBenchCaseKind>(["positive","negative","edge","escalation"]);
export function parseTestBenchCases(value:unknown):TestBenchCase[]{
  if(!Array.isArray(value)||value.length<1||value.length>MAX_TEST_BENCH_CASES)
    invalid("test_bench_case_limit");
  const seen=new Set<string>();
  const cases=value.map((raw):TestBenchCase=>{
    const row=obj(raw,["caseId","kind","prompt","context","expectedBehavior"],"test_bench_case_invalid");
    if(typeof row.caseId!=="string"||!CASE_ID.test(row.caseId))
      invalid("test_bench_case_id_invalid");
    const caseId=row.caseId,canonical=caseId.toLowerCase();
    if(seen.has(canonical))invalid("test_bench_case_duplicate");
    seen.add(canonical);
    if(!kinds.has(row.kind as TestBenchCaseKind))invalid("test_bench_case_kind_invalid");
    const context=row.context===undefined||row.context===null||row.context===""
      ? null : bounded(row.context,1500,"test_bench_context_invalid");
    return {
      caseId,kind:row.kind as TestBenchCaseKind,
      prompt:bounded(row.prompt,2000,"test_bench_prompt_invalid"),
      context,expectedBehavior:bounded(row.expectedBehavior,1000,"test_bench_expected_invalid"),
    };
  });
  if(new TextEncoder().encode(JSON.stringify(cases)).length>MAX_TEST_BENCH_BYTES)
    invalid("test_bench_case_bytes_exceeded");
  return cases;
}
export function parseTestBenchDraft(value:unknown):TestBenchDraft{
  const body=obj(value,["name","cases","requestId"],"test_bench_definition_invalid");
  return {name:bounded(body.name,100,"test_bench_name_invalid"),cases:parseTestBenchCases(body.cases)};
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseTestBenchCreate(value:unknown):TestBenchDraft&{requestId:string}{
  const draft=parseTestBenchDraft(value);
  const requestId=(value as Record<string,unknown>).requestId;
  if(typeof requestId!=="string"||!UUID.test(requestId))
    invalid("test_bench_request_id_invalid");
  return {...draft,requestId:requestId.toLowerCase()};
}
export function parseTestBenchMutation(value:unknown):TestBenchDraft&{expectedRevision:number}{
  const body=obj(value,["name","cases","expectedRevision"],"test_bench_mutation_invalid");
  if(!Number.isSafeInteger(body.expectedRevision)||
    (body.expectedRevision as number)<1||(body.expectedRevision as number)>2_147_483_645)
    throw new TestBenchError("test_bench_revision_required",428);
  return {...parseTestBenchDraft({name:body.name,cases:body.cases}),
    expectedRevision:body.expectedRevision as number};
}
export function parseTestBenchArchive(value:unknown):{expectedRevision:number}{
  const body=obj(value,["expectedRevision"],"test_bench_archive_invalid");
  if(!Number.isSafeInteger(body.expectedRevision)||
    (body.expectedRevision as number)<1||(body.expectedRevision as number)>2_147_483_645)
    throw new TestBenchError("test_bench_revision_required",428);
  return {expectedRevision:body.expectedRevision as number};
}
