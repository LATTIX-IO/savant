import assert from "node:assert/strict";
import test from "node:test";
import {
  AiServiceError,assertNimCatalogUseAuthorized,createNimChatClient,
  DEFAULT_NIM_BASE_URL,
} from "./clients.ts";
const denied=(e:unknown)=>e instanceof AiServiceError&&
  e.service==="nim"&&e.status===403;
test("PER-1554: hosted NVIDIA Developer Program catalog is denied for production",()=>{
  for(const env of [
    {VERCEL_ENV:"production"},
    {SAVANT_DEPLOYMENT_ENV:"production"},
    {VERCEL_ENV:"production",NIM_PRODUCTION_LICENSE_VERIFIED:"true"},
  ]){
    assert.throws(()=>assertNimCatalogUseAuthorized(DEFAULT_NIM_BASE_URL,env),
      denied);
    assert.throws(()=>assertNimCatalogUseAuthorized(
      "https://integrate.api.nvidia.com:443/v1",env),denied);
  }
  assert.doesNotThrow(()=>assertNimCatalogUseAuthorized(DEFAULT_NIM_BASE_URL,
    {VERCEL_ENV:"preview"}));
  assert.doesNotThrow(()=>assertNimCatalogUseAuthorized(DEFAULT_NIM_BASE_URL,
    {VERCEL_ENV:"development"}));
});
test("PER-1554: malformed and insecure NIM origins are never accepted",()=>{
  for(const url of [
    "http://integrate.api.nvidia.com/v1",
    "file:///etc/passwd",
    "/v1/chat/completions",
    "javascript:alert(1)",
  ]) assert.throws(()=>assertNimCatalogUseAuthorized(url,{}),
    e=>e instanceof AiServiceError&&e.status===422);
});
test("PER-1554: provider HTTP is never reached by catalog client in production",{concurrency:false},async()=>{
  const before=process.env.VERCEL_ENV;
  const beforeDeployment=process.env.SAVANT_DEPLOYMENT_ENV;
  let calls=0;
  try{
    process.env.VERCEL_ENV="production";
    delete process.env.SAVANT_DEPLOYMENT_ENV;
    const client=createNimChatClient({
      apiKey:"CI_FIXTURE_DOES_NOT_AUTHENTICATE",
      baseUrl:DEFAULT_NIM_BASE_URL,
      generationModel:"fixture",executionModel:"fixture",extraBody:{},
    },"fixture",async()=>{
      calls++;
      return new Response("Unexpected network",{status:200});
    });
    await assert.rejects(()=>client.complete([
      {role:"user",content:"synthetic smoke"},
    ]),denied);
    assert.equal(calls,0);
  }finally{
    if(before===undefined)delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV=before;
    if(beforeDeployment===undefined)delete process.env.SAVANT_DEPLOYMENT_ENV;
    else process.env.SAVANT_DEPLOYMENT_ENV=beforeDeployment;
  }
});
test("PER-1554: custom enterprise/selfhost origin is NOT certified by this guard",()=>{
  // A different server-configured origin passes this specific developer
  // catalog denial. Finance/vendor contract and real production approval
  // remain independent release gates: this does NOT certify that origin.
  assert.doesNotThrow(()=>assertNimCatalogUseAuthorized(
    "https://licensed-internal-nim.example.org/v1",
    {VERCEL_ENV:"production"}));
});
