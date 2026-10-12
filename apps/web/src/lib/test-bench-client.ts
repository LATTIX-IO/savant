import {
  parseTestBenchCases,type TestBenchCase,type TestBenchDefinition,
} from "../server/test-bench/definition-contract.ts";
import {withWorkspaceSlugQuery} from "./tenant-paths.ts";

/** Transport for persisted, encrypted Test Bench *draft definitions*. No run endpoint. */
export class TestBenchClientError extends Error{
  constructor(message:string){super(message);this.name="TestBenchClientError";}
}
export type TestBenchClientOptions={
  workspaceSlug:string;signal?:AbortSignal;fetcher?:typeof fetch;
};
const SHA=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new TestBenchClientError("Invalid persisted Test Bench response.");
  return value as Record<string,unknown>;
}
function definition(value:unknown,skillId:string):TestBenchDefinition{
  const row=record(value);
  if(typeof row.id!=="string"||!UUID.test(row.id)||
    row.skillId!==skillId||typeof row.sourceCommitSha!=="string"||
    !SHA.test(row.sourceCommitSha)||!Number.isSafeInteger(row.revision)||
    (row.revision as number)<1||typeof row.name!=="string"||
    row.name.length<1||row.name.length>100||
    typeof row.createdAt!=="string"||typeof row.updatedAt!=="string")
    throw new TestBenchClientError("Invalid persisted Test Bench provenance.");
  try{
    return {
      id:row.id,skillId,sourceCommitSha:row.sourceCommitSha,
      revision:row.revision as number,name:row.name,
      cases:parseTestBenchCases(row.cases),createdAt:row.createdAt,updatedAt:row.updatedAt,
    };
  }catch{throw new TestBenchClientError("Invalid persisted Test Bench case data.");}
}
function url(skillId:string,options:TestBenchClientOptions,definitionId?:string):string{
  if(!skillId||skillId.length>300||skillId.trim()!==skillId||
    typeof options.workspaceSlug!=="string"||options.workspaceSlug.length>80||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(options.workspaceSlug))
    throw new TestBenchClientError("Workspace and skill context are required.");
  if(definitionId!==undefined&&!UUID.test(definitionId))
    throw new TestBenchClientError("Invalid Test Bench identifier.");
  return withWorkspaceSlugQuery(
    `/api/skills/${encodeURIComponent(skillId)}/test-bench${definitionId?"/"+encodeURIComponent(definitionId):""}`,
    options.workspaceSlug,
  );
}
async function request(
  skillId:string,options:TestBenchClientOptions,method:"GET"|"POST"|"PATCH"|"DELETE",
  body?:unknown,definitionId?:string,
):Promise<{value:unknown;status:number}>{
  const endpoint=url(skillId,options,definitionId);
  const response=await (options.fetcher??fetch)(endpoint,{
    method,mode:"same-origin",credentials:"same-origin",cache:"no-store",
    headers:{"Accept":"application/json",...(body===undefined?{}:{"Content-Type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:options.signal??null,
  });
  if(!response.ok)throw new TestBenchClientError(`Test Bench service rejected the request (HTTP ${response.status}).`);
  let json:unknown;
  try{json=await response.json();}
  catch{throw new TestBenchClientError("Invalid Test Bench JSON response.");}
  return {value:record(json).data,status:response.status};
}
export async function listPersistedTestBenches(
  skillId:string,options:TestBenchClientOptions,
):Promise<TestBenchDefinition[]>{
  const {value}=await request(skillId,options,"GET");
  if(!Array.isArray(value)||value.length>50)
    throw new TestBenchClientError("Invalid Test Bench list response.");
  return value.map(v=>definition(v,skillId));
}
export async function createPersistedTestBench(
  skillId:string,body:{name:string;cases:TestBenchCase[];requestId:string},
  options:TestBenchClientOptions,
):Promise<TestBenchDefinition>{
  const {value,status}=await request(skillId,options,"POST",body);
  if(status!==200&&status!==201)throw new TestBenchClientError("Test Bench creation was not acknowledged.");
  return definition(value,skillId);
}
export async function updatePersistedTestBench(
  skillId:string,id:string,
  body:{name:string;cases:TestBenchCase[];expectedRevision:number},
  options:TestBenchClientOptions,
):Promise<TestBenchDefinition>{
  const {value}=await request(skillId,options,"PATCH",body,id);
  return definition(value,skillId);
}
export async function archivePersistedTestBench(
  skillId:string,id:string,expectedRevision:number,
  options:TestBenchClientOptions,
):Promise<void>{
  const {value}=await request(skillId,options,"DELETE",{expectedRevision},id);
  const row=record(value);
  if(row.id!==id||row.archived!==true||row.revision!==expectedRevision+1)
    throw new TestBenchClientError("Test Bench archive was not acknowledged.");
}
