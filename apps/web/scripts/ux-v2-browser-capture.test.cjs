/* eslint-disable @typescript-eslint/no-require-imports -- offline fixture tests */
"use strict";
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const test=require("node:test");
const {CASES}=require("./ux-v2-authenticated-acceptance.cjs");
const {writePrivateBrowserCapture,CAPTURE_SCREENS}=require("./ux-v2-browser-capture.cjs");
const {evaluateCutoverEvidence}=require("./ux-v2-cutover-readiness.cjs");

const config={origin:"https://savantskills.app",productionReadOnly:true,
  workspaceA:"acceptance-a",workspaceB:"acceptance-b",workspaceDenied:"acceptance-denied",
  statePath:"/private/never-serialize-storage-state.json"};
function syntheticPng(width,unique){
  // Unit-only structured PNG header fixture; never used as an authenticated screenshot.
  const buffer=Buffer.alloc(70);
  Buffer.from("89504e470d0a1a0a","hex").copy(buffer,0);
  buffer.writeUInt32BE(13,8);buffer.write("IHDR",12,4,"ascii");
  buffer.writeUInt32BE(width,16);buffer.writeUInt32BE(900,20);
  buffer.writeUInt32BE(unique,24);return buffer;
}
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"savant-capture-"));
  let i=1;
  for(const c of CASES)for(const screen of CAPTURE_SCREENS){
    const name=c.theme+"-"+c.width+"-"+screen+".png";
    fs.writeFileSync(path.join(dir,name),syntheticPng(c.width,i++));
  }
  return dir;
}
function changeFile(dir,variant,screen,modify){
  const name=variant.theme+"-"+variant.width+"-"+screen+".png";
  const file=path.join(dir,name);
  modify(file);return file;
}
test("successful 8 x 8 run yields SHA256-backed private capture without credentials or release promotion",()=>{
  const dir=setup();
  try{
    const result=writePrivateBrowserCapture({output:dir,config,cases:CASES});
    assert.equal(result.count,64);
    const raw=fs.readFileSync(result.path,"utf8");
    const receipt=JSON.parse(raw);
    assert.equal(receipt.evidenceKind,"authenticated-browser-capture-only");
    assert.equal(receipt.screenshots.length,64);
    assert.deepEqual(receipt.screens,CAPTURE_SCREENS);
    assert.equal(new Set(receipt.screenshots.map(s=>s.sha256)).size,64);
    assert.equal(receipt.completedJourneys,8);
    assert.ok(receipt.screenshots.every(s=>path.isAbsolute(s.path)));
    assert.equal(evaluateCutoverEvidence(receipt,"a".repeat(40)).eligible,false,
      "Browser capture must never be interpreted as provider, rollback or production release evidence.");
    assert.ok(!raw.includes(config.statePath)&&!raw.includes("cookies")&&!raw.includes("apiKey"));
    assert.throws(()=>writePrivateBrowserCapture({output:dir,config,cases:CASES}),/EEXIST/,
      "A receipt may never silently overwrite previous evidence.");
    if(process.platform!=="win32")assert.equal(fs.statSync(result.path).mode&0o777,0o600);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("reject missing screenshots, reused content, corrupt PNG headers and viewport mismatch",()=>{
  for(const kind of ["missing","reused","corrupt","width"]){
    const dir=setup();
    try{
      const first=changeFile(dir,CASES[0],"overview",file=>file);
      const second=changeFile(dir,CASES[0],"library",file=>file);
      if(kind==="missing")fs.rmSync(first);
      if(kind==="reused")fs.copyFileSync(first,second);
      if(kind==="corrupt")fs.writeFileSync(first,Buffer.alloc(90));
      if(kind==="width"){
        const buffer=fs.readFileSync(first);buffer.writeUInt32BE(300,16);fs.writeFileSync(first,buffer);
      }
      assert.throws(()=>writePrivateBrowserCapture({output:dir,config,cases:CASES}),
        /ENOENT|Duplicate screenshot|Invalid PNG|width/);
      assert.equal(fs.existsSync(path.join(dir,"ux-v2-browser-capture.json")),false);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test("reject unsound fixtures, untrusted context or incomplete browser matrix",()=>{
  const dir=setup();
  try{
    for(const cases of [[],CASES.slice(1),[...CASES.slice(0,7),CASES[0]]]){
      assert.throws(()=>writePrivateBrowserCapture({output:dir,config,cases}),
        /journey|Duplicate/);
    }
    assert.throws(()=>writePrivateBrowserCapture({output:dir,
      config:{...config,workspaceB:config.workspaceA},cases:CASES}),/distinct/);
    assert.throws(()=>writePrivateBrowserCapture({output:dir,
      config:{...config,origin:"http://savantskills.app"},cases:CASES}),/HTTPS/);
    assert.throws(()=>writePrivateBrowserCapture({output:".",config,cases:CASES}),
      /Private absolute/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("capture writer is local-only and never extracts authenticated session material",()=>{
 const script=fs.readFileSync(path.join(__dirname,"ux-v2-browser-capture.cjs"),"utf8");
 const runner=fs.readFileSync(path.join(__dirname,"ux-v2-authenticated-acceptance.cjs"),"utf8");
 assert.match(runner,/writePrivateBrowserCapture/);
 assert.match(runner,/assert\.equal\(completed, CASES\.length/);
 assert.doesNotMatch(script,/readFileSync\(config\.statePath|token\.value|document\.cookie|fetch\(|axios|\.post\(/);
 assert.doesNotMatch(script,/process\.env\.SAVANT_UI_V2_ENABLED\s*=/);
});
