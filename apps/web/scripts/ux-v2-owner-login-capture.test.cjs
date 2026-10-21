/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const test=require("node:test");
const {captureConfig,minimalAppStorageState,writePrivateBrowserState}=
  require("./ux-v2-owner-login-capture.cjs");
const ack="OWNER-READONLY-PRODUCTION-SYNTHETIC-UX";
function inputs(dest){
 return {SAVANT_UAT_BASE_URL:"https://savantskills.app/",
  SAVANT_UAT_OWNER_PRODUCTION_ACK:ack,SAVANT_UAT_SYNTHETIC_TENANTS:"true",
  SAVANT_UAT_WORKSPACE_A:"synthetic-owner-a",SAVANT_UAT_STORAGE_STATE:dest};
}
function state(){
 return {cookies:[
  {domain:"savantskills.app",name:"appSession",value:"SECRET_APP_COOKIE",secure:true,httpOnly:true,path:"/"},
  {domain:".savantskills.app",name:"theme",value:"dark",secure:true,httpOnly:false,path:"/"},
  {domain:"example.auth0.com",name:"idpSession",value:"SECRET_IDP_COOKIE",secure:true,httpOnly:true,path:"/"},
  {domain:"elsewhere.example",name:"untrusted",value:"SECRET_OTHER_COOKIE",secure:true,httpOnly:true,path:"/"},
 ],origins:[
  {origin:"https://savantskills.app",localStorage:[{name:"token",value:"SENSITIVE"}]},
  {origin:"https://example.auth0.com",localStorage:[{name:"token",value:"SENSITIVE_IDP"}]},
 ]};
}
test("capture config requires actual production origin, explicit consent and known workspace",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"savant-state-"));
 try{
  const c=captureConfig(inputs(path.join(dir,"owner-session.json")));
  assert.equal(c.slug,"synthetic-owner-a");
  assert.equal(c.origin,"https://savantskills.app");
  for(const bad of ["http://savantskills.app/","https://evil.example/",
    "https://foo.savantskills.app/","https://savantskills.app/path",
    "https://savantskills.app/?token=x","https://name:secret@savantskills.app/"]){
    assert.throws(()=>captureConfig({...inputs(path.join(dir,"out.json")),SAVANT_UAT_BASE_URL:bad}),
      /origin/i,bad);
  }
  assert.throws(()=>captureConfig({...inputs(path.join(dir,"out.json")),
    SAVANT_UAT_OWNER_PRODUCTION_ACK:""}),/acknowledgment/);
  assert.throws(()=>captureConfig({...inputs(path.join(dir,"out.json")),
    SAVANT_UAT_SYNTHETIC_TENANTS:"false"}),/acknowledgment/);
  assert.throws(()=>captureConfig({...inputs(path.join(dir,"out.json")),
    SAVANT_UAT_WORKSPACE_A:"../evil"}),/workspace slug/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("state includes only current origin's secure cookies, no IdP cookies or localStorage",()=>{
 const minimal=minimalAppStorageState(state(),"savantskills.app");
 assert.equal(minimal.cookies.length,2);
 assert.deepEqual(minimal.origins,[]);
 const text=JSON.stringify(minimal);
 for(const secret of ["SECRET_IDP_COOKIE","SECRET_OTHER_COOKIE","SENSITIVE_IDP","SENSITIVE"])
   assert.equal(text.includes(secret),false,secret);
 assert.ok(text.includes("SECRET_APP_COOKIE"));
});
test("missing signed-in HttpOnly cookie or insecure cookie is rejected",()=>{
 const x=state();
 x.cookies=[{domain:".savantskills.app",name:"theme",value:"dark",secure:true,httpOnly:false}];
 assert.throws(()=>minimalAppStorageState(x,"savantskills.app"),/HttpOnly/);
 x.cookies=[{domain:"savantskills.app",name:"appSession",value:"unsafe",secure:false,httpOnly:true}];
 assert.throws(()=>minimalAppStorageState(x,"savantskills.app"),/HttpOnly/);
 assert.throws(()=>minimalAppStorageState({},"savantskills.app"),/unavailable/);
});
test("private write creates no session data in Git, refuses overwrite, retains protected permissions",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"savant-state-"));
 try{
  const file=path.join(dir,"session.json"),minimal=minimalAppStorageState(state(),"savantskills.app");
  assert.equal(writePrivateBrowserState(file,minimal),file);
  const disk=fs.readFileSync(file,"utf8");
  assert.equal(disk,JSON.stringify(minimal));
  assert.throws(()=>writePrivateBrowserState(file,minimal),/EEXIST/);
  if(process.platform!=="win32")assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.throws(()=>captureConfig(inputs(file)),/already exists/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("operator capture requires actual UI and manual authentication; never prints credentials",()=>{
 const src=fs.readFileSync(path.join(__dirname,"ux-v2-owner-login-capture.cjs"),"utf8");
 assert.match(src,/headless:false/);
 assert.match(src,/Authenticate manually in the visible browser/);
 assert.match(src,/data-savant-ui/);
 assert.match(src,/name:"Overview"/);
 assert.doesNotMatch(src,/\.fill\(.*password|page\.route\(|networkMocksUsed:true|localStorage\(/);
});
