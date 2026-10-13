import type {ChatClient,ChatMessage,ChatResult,FetchLike} from "../ai/clients.ts";
import {decryptAIConnectionSecret,AIConnectionSecretStoreError} from "../control-plane/ai-connection-secrets.ts";
import {ObservedEvaluationError} from "./observed-evaluator.ts";

type Sql=import("postgres").Sql;
export const TENANT_OPENAI_CHAT_ENDPOINT="https://api.openai.com/v1/chat/completions";
const MAX_RESPONSE_BYTES=32_768;
const MAX_REQUEST_MS=15_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const err=(code:string):never=>{throw new ObservedEvaluationError(code);};

export type PinnedWorkspaceOpenAi={
  organizationId:string;connectionId:string;model:string;fingerprint:string;
};
type CandidateConnection={
  id:string;organization_id:string;provider_type:string;default_model:string;
  supports_execution:boolean;is_default_execution:boolean;status:string;
  allowed_models:unknown;secret_fingerprint:string|null;
};
export function assertValidTenantOpenAiConnection(
  row:CandidateConnection|undefined,organizationId:string,
):PinnedWorkspaceOpenAi{
  if(!row||row.organization_id!==organizationId||!UUID.test(row.id)||
    row.provider_type!=="openai"||row.status!=="active"||
    !row.supports_execution||!row.is_default_execution||
    !HEX.test(row.secret_fingerprint??"")||
    typeof row.default_model!=="string"||!row.default_model.trim()||
    row.default_model.length>160||!Array.isArray(row.allowed_models)||
    row.allowed_models.some(v=>typeof v!=="string"||v.length>160)||
    (row.allowed_models.length>0&&!row.allowed_models.includes(row.default_model)))
    return err("test_bench_workspace_openai_unavailable");
  return {
    organizationId,connectionId:row.id,model:row.default_model,
    fingerprint:row.secret_fingerprint!,
  };
}
export type PinnedWorkspaceRun={
  organization_id:string;execution_connection_id:string|null;
  execution_secret_fingerprint:string|null;execution_model_pinned:string|null;
  execution_source:"platform-nim"|"workspace-openai";
};
/** Pure fail-closed freshness gate. Model/key/connection cannot drift after admission. */
export function assertPinnedTenantOpenAiConnection(
  run:PinnedWorkspaceRun,candidate:CandidateConnection|undefined,
):void{
  if(run.execution_source!=="workspace-openai"||
    !run.execution_connection_id||!run.execution_model_pinned||
    !run.execution_secret_fingerprint)return err("test_bench_workspace_openai_unavailable");
  const available=assertValidTenantOpenAiConnection(candidate,run.organization_id);
  if(available.connectionId!==run.execution_connection_id||
    available.model!==run.execution_model_pinned||
    available.fingerprint!==run.execution_secret_fingerprint)
    err("test_bench_workspace_openai_changed");
}
type StoredConnection=CandidateConnection&{encrypted_secret:string};
async function fetchTenantConnection(
  sql:Sql,organizationId:string,id:string,
):Promise<StoredConnection|undefined>{
  if(!UUID.test(organizationId)||!UUID.test(id))return;
  const [row]=await sql<StoredConnection[]>`
    select c.id,c.organization_id,c.provider_type,c.default_model,c.status,
      c.supports_execution,c.is_default_execution,c.allowed_models,
      s.secret_fingerprint,s.encrypted_secret
    from ai_connections c
      join ai_connection_secrets s on s.ai_connection_id=c.id
    where c.organization_id=${organizationId} and c.id=${id}
      and c.provider_type='openai'
    limit 1
  `;
  return row;
}
/** Verify the credential before every paid/provider network boundary.
 * Revocation, rotation, default change, model change or cross-tenant
 * substitution all stop execution, without a platform-NIM fallback.
 */
export async function assertTenantOpenAiCanContinue(sql:Sql,run:PinnedWorkspaceRun):
  Promise<void>{
  if(run.execution_source!=="workspace-openai")return;
  const connection=await fetchTenantConnection(sql,run.organization_id,
    run.execution_connection_id??"");
  assertPinnedTenantOpenAiConnection(run,connection);
}
/** Unwrap the tenant API key only inside the trusted server worker. */
export async function createPinnedTenantOpenAiClient(
  sql:Sql,run:PinnedWorkspaceRun,fetchImpl:FetchLike=fetch,
):Promise<ChatClient>{
  const connection=await fetchTenantConnection(sql,run.organization_id,
    run.execution_connection_id??"");
  assertPinnedTenantOpenAiConnection(run,connection);
  if(!connection)return err("test_bench_workspace_openai_unavailable");
  let apiKey:string;
  try{
    apiKey=decryptAIConnectionSecret(connection.encrypted_secret,{
      organizationId:run.organization_id,aiConnectionId:connection.id,
      provider:connection.provider_type,
    });
  }catch(error){
    if(error instanceof AIConnectionSecretStoreError)
      return err("test_bench_workspace_openai_credential_unavailable");
    return err("test_bench_workspace_openai_credential_unavailable");
  }
  if(!apiKey.trim()||apiKey.length>400)return err("test_bench_workspace_openai_credential_unavailable");
  return createTenantOpenAiChatClient({
    model:connection.default_model,apiKey,fetchImpl,
  });
}
async function readLimitedResponse(response:Response):Promise<string>{
  if(response.headers.get("content-length")&&
    Number(response.headers.get("content-length"))>MAX_RESPONSE_BYTES)
    return err("test_bench_workspace_openai_response_invalid");
  if(!response.body)return err("test_bench_workspace_openai_response_invalid");
  const reader=response.body.getReader();
  const buffers:Uint8Array[]=[];let bytes=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!value)continue;
      bytes+=value.byteLength;
      if(bytes>MAX_RESPONSE_BYTES)return err("test_bench_workspace_openai_response_invalid");
      buffers.push(value);
    }
    const merged=new Uint8Array(bytes);let cursor=0;
    for(const chunk of buffers){merged.set(chunk,cursor);cursor+=chunk.byteLength;}
    return new TextDecoder("utf-8",{fatal:true}).decode(merged);
  }catch{return err("test_bench_workspace_openai_response_invalid");}
  finally{reader.releaseLock();}
}
function validUsage(value:unknown):value is {prompt_tokens:number;completion_tokens:number}{
  if(!value||typeof value!=="object")return false;
  const v=value as Record<string,unknown>;
  return Number.isSafeInteger(v.prompt_tokens)&&Number.isSafeInteger(v.completion_tokens)&&
    (v.prompt_tokens as number)>=0&&(v.completion_tokens as number)>=0&&
    (v.prompt_tokens as number)+(v.completion_tokens as number)>0;
}
/** OpenAI's first-party fixed HTTPS endpoint. No tenant-supplied URL, redirects,
 * provider routing, automatic retry, tool definitions, or credential logging.
 * A provider timeout is a FAILED run; do not repeat billable completions.
 */
export function createTenantOpenAiChatClient(input:{
  model:string;apiKey:string;fetchImpl?:FetchLike;
}):ChatClient{
  const {model,apiKey,fetchImpl=fetch}=input;
  if(!model||model.length>160||!apiKey||apiKey.length>400)
    err("test_bench_workspace_openai_credential_unavailable");
  return {
    model,
    async complete(messages:ChatMessage[],options={}):Promise<ChatResult>{
      const maxTokens=options.maxTokens??400;
      const timeout=options.timeoutMs??MAX_REQUEST_MS;
      if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>400||
        !Number.isSafeInteger(timeout)||timeout<1||timeout>MAX_REQUEST_MS||
        options.extraBody!==undefined||
        messages.length!==2||
        messages[0]?.role!=="system"||messages[1]?.role!=="user"||
        messages.some(m=>!m.content||m.content.length>16_000))
        return err("test_bench_workspace_openai_request_invalid");
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeout);
      const started=Date.now();
      try{
        const response=await fetchImpl(TENANT_OPENAI_CHAT_ENDPOINT,{
          method:"POST",redirect:"error",credentials:"omit",cache:"no-store",
          headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json",
            accept:"application/json"},
          body:JSON.stringify({
            model,messages,max_tokens:maxTokens,temperature:options.temperature??0.2,
            stream:false,
          }),
          signal:controller.signal,
        });
        if(!response.ok)return err("test_bench_workspace_openai_http_failure");
        const data=JSON.parse(await readLimitedResponse(response)) as unknown;
        if(!data||typeof data!=="object"||Array.isArray(data))
          return err("test_bench_workspace_openai_response_invalid");
        const body=data as Record<string,unknown>;
        const choice=Array.isArray(body.choices)?body.choices[0]:null;
        const reply=choice&&typeof choice==="object"?
          (choice as Record<string,unknown>).message:null;
        const content=reply&&typeof reply==="object"?
          (reply as Record<string,unknown>).content:null;
        if(body.model!==model||typeof content!=="string"||
          !content.trim()||content.length>3_000||!validUsage(body.usage))
          return err("test_bench_workspace_openai_response_invalid");
        return {
          content:content.trim(),model,latencyMs:Date.now()-started,
          usage:{promptTokens:body.usage.prompt_tokens,
            completionTokens:body.usage.completion_tokens},
          finishReason:choice&&typeof choice==="object"?
            String((choice as Record<string,unknown>).finish_reason??"unknown"):null,
          reasoningChars:0,
        };
      }catch(error){
        if(error instanceof ObservedEvaluationError)throw error;
        return err("test_bench_workspace_openai_request_failed");
      }finally{clearTimeout(timer);}
    },
  };
}
