/* eslint-disable @typescript-eslint/no-require-imports -- operator-run CommonJS */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const process=require("node:process");
const {createInterface}=require("node:readline/promises");

const HOSTS=new Set(["savantskills.app","www.savantskills.app",
  "savantrepo.com","www.savantrepo.com"]);
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PRODUCTION_ACK="OWNER-READONLY-PRODUCTION-SYNTHETIC-UX";

/** No secret values from this configuration are ever logged. */
function captureConfig(env=process.env){
  const raw=env.SAVANT_UAT_BASE_URL;
  let origin;
  try{origin=new URL(raw);}catch{throw new Error("Invalid authorized HTTPS origin.");}
  if(origin.protocol!=="https:"||!HOSTS.has(origin.hostname.toLowerCase())||
     origin.username||origin.password||origin.search||origin.hash||
     origin.pathname!=="/"||origin.port){
    throw new Error("Only an exact configured Savant production HTTPS origin is allowed.");
  }
  if(env.SAVANT_UAT_OWNER_PRODUCTION_ACK!==PRODUCTION_ACK||
     env.SAVANT_UAT_SYNTHETIC_TENANTS!=="true"){
    throw new Error("Explicit read-only synthetic owner acknowledgment is mandatory.");
  }
  const slug=env.SAVANT_UAT_WORKSPACE_A;
  if(typeof slug!=="string"||!SLUG.test(slug))throw new Error("Exact, known owner workspace slug required.");
  const dest=env.SAVANT_UAT_STORAGE_STATE;
  if(typeof dest!=="string"||!path.isAbsolute(dest)||
     path.basename(dest)==="."||path.extname(dest).toLowerCase()!==".json"){
    throw new Error("Private absolute .json output path is required.");
  }
  const repo=fs.realpathSync(path.resolve(__dirname,"../../.."));
  const parent=fs.realpathSync(path.dirname(dest));
  const normalized=(value)=>process.platform==="win32"?value.toLowerCase():value;
  if(normalized(parent)===normalized(repo)||normalized(parent).startsWith(
    normalized(repo)+path.sep)){
    throw new Error("Browser session state cannot be written inside the Git repository.");
  }
  if(fs.existsSync(dest))throw new Error("Session state file already exists; refusing overwrite.");
  return Object.freeze({origin:origin.origin,hostname:origin.hostname.toLowerCase(),
    slug,output:path.join(parent,path.basename(dest))});
}

/** Restrict captured state to current app cookies; discard Auth0 IdP origins and localStorage. */
function minimalAppStorageState(state,hostname){
  if(!state||typeof state!=="object"||!Array.isArray(state.cookies))
    throw new Error("Browser state unavailable.");
  const cookies=state.cookies.filter(cookie=>{
    if(!cookie||typeof cookie!=="object")return false;
    const domain=String(cookie.domain??"").replace(/^\./,"").toLowerCase();
    return (hostname===domain||hostname.endsWith("."+domain))&&
      cookie.secure===true&&typeof cookie.name==="string"&&
      typeof cookie.value==="string"&&cookie.value.length>0;
  }).map(cookie=>({...cookie}));
  if(!cookies.some(cookie=>cookie.httpOnly===true))
    throw new Error("No authenticated secure HttpOnly app session cookie was observed.");
  return {cookies,origins:[]};
}
function writePrivateBrowserState(dest,state){
  const content=JSON.stringify(state);
  assert.ok(content.length>0&&content.length<=65536,"Invalid browser state size.");
  const fd=fs.openSync(dest,"wx",0o600);
  try{fs.writeFileSync(fd,content,{encoding:"utf8"});}
  catch(error){try{fs.unlinkSync(dest);}catch{}throw error;}
  finally{fs.closeSync(fd);}
  return dest;
}
async function main(env=process.env){
  if(!process.stdin.isTTY)throw new Error("Interactive owner terminal required.");
  const config=captureConfig(env);
  const driver=require(env.PLAYWRIGHT_MODULE||"playwright");
  const browser=await driver.chromium.launch({headless:false});
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{
    const context=await browser.newContext();
    const page=await context.newPage();
    const route=config.origin+"/o/"+encodeURIComponent(config.slug)+"/dashboard";
    await page.goto(route,{waitUntil:"domcontentloaded"});
    await terminal.question("Authenticate manually in the visible browser, then press Enter here. ");
    await page.goto(route,{waitUntil:"domcontentloaded"});
    await page.locator('[data-savant-ui="v2"]').waitFor({state:"visible",timeout:20000});
    await page.getByRole("heading",{name:"Overview",exact:true})
      .waitFor({state:"visible",timeout:20000});
    const current=new URL(page.url());
    if(current.origin!==config.origin||
       current.pathname!=="/o/"+encodeURIComponent(config.slug)+"/dashboard"){
      throw new Error("Authenticated workspace Overview route not confirmed.");
    }
    const privateState=minimalAppStorageState(await context.storageState(),config.hostname);
    writePrivateBrowserState(config.output,privateState);
    process.stdout.write("Verified owner-accessible v2 Overview. Session captured at "+
      config.output+". Keep private and exclude from Git.\n");
  }finally{terminal.close();await browser.close();}
}
if(require.main===module){
  main().catch(()=>{
    process.stderr.write("Owner authentication capture blocked. Verify an actual session, "+
      "selected workspace, private destination and explicit production opt-in.\n");
    process.exitCode=1;
  });
}
module.exports={captureConfig,minimalAppStorageState,writePrivateBrowserState};
