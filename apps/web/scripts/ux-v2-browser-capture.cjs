/* eslint-disable @typescript-eslint/no-require-imports -- offline authenticated browser evidence packaging */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

/** Local-only capture validation; not a source of Auth0, Vercel or provider authority. */
const CAPTURE_SCREENS=Object.freeze(["overview","library","workbench","evaluations",
  "runs","insights","integrations","settings"]);
const WIDTHS=[390,768,1280,1440];
const THEMES=["light","dark"];
const ACCEPTED=new Set(WIDTHS.flatMap(width=>THEMES.map(theme=>theme+"-"+width)));
const SIGNATURE=Buffer.from("89504e470d0a1a0a","hex");
const MAX_PNG_BYTES=20*1024*1024;
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function screenshotDimensions(buffer){
  if(buffer.length<33||!buffer.subarray(0,8).equals(SIGNATURE)||
     buffer.readUInt32BE(8)!==13||buffer.toString("ascii",12,16)!=="IHDR"){
    throw new Error("Invalid PNG screenshot header.");
  }
  return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
}

function writePrivateBrowserCapture({output,config,cases}){
  assert.ok(config&&typeof config==="object","Validated authenticated configuration required.");
  assert.ok(typeof output==="string"&&path.isAbsolute(output),"Private absolute screenshot directory required.");
  const realDir=fs.realpathSync(output);
  assert.ok(fs.statSync(realDir).isDirectory(),"Screenshot output must be a directory.");
  const repo=path.resolve(__dirname,"../../..");
  assert.ok(realDir!==repo&&!realDir.startsWith(repo+path.sep),
    "Browser evidence cannot be saved in the repository.");
  const origin=new URL(config.origin);
  assert.equal(origin.protocol,"https:","HTTPS origin required.");
  assert.equal(origin.origin,config.origin,"Only normalized origin without path or credentials accepted.");
  assert.ok([config.workspaceA,config.workspaceB,config.workspaceDenied].every(
    value=>typeof value==="string"&&SLUG.test(value)),"Canonical tenant identifiers required.");
  assert.equal(new Set([config.workspaceA,config.workspaceB,config.workspaceDenied]).size,3,
    "Authorized A/B and denied C workspaces must be distinct.");
  assert.ok(Array.isArray(cases)&&cases.length===ACCEPTED.size,
    "All authenticated viewport/theme journeys must complete.");
  const variants=cases.map(v=>v?.theme+"-"+v?.width);
  assert.equal(new Set(variants).size,ACCEPTED.size,"Duplicate viewport/theme journey.");
  assert.ok(variants.every(label=>ACCEPTED.has(label)),
    "Invalid or absent viewport/theme journey.");

  const screenshots=[], hashes=new Set(), realPaths=new Set();
  for(const variant of cases){
    for(const screen of CAPTURE_SCREENS){
      const file=path.join(realDir,variant.theme+"-"+variant.width+"-"+screen+".png");
      const entry=fs.lstatSync(file);
      assert.ok(entry.isFile()&&!entry.isSymbolicLink(),
        "Screenshot must be a regular private file.");
      assert.ok(entry.size>32&&entry.size<=MAX_PNG_BYTES,
        "Screenshot size is missing or excessive.");
      const realFile=fs.realpathSync(file);
      assert.ok(realFile.startsWith(realDir+path.sep)&&!realPaths.has(realFile),
        "Screenshot reused or outside the private evidence directory.");
      const bytes=fs.readFileSync(realFile);
      assert.equal(bytes.length,entry.size,"Screenshot changed while being verified.");
      const dimensions=screenshotDimensions(bytes);
      assert.equal(dimensions.width,variant.width,
        "Screenshot width does not match the browser viewport.");
      assert.equal(dimensions.height,900,
        "Screenshot height does not match the acceptance context.");
      const hash=crypto.createHash("sha256").update(bytes).digest("hex");
      assert.ok(!hashes.has(hash),"Duplicate screenshot content cannot satisfy separate evidence slots.");
      realPaths.add(realFile);hashes.add(hash);
      screenshots.push({screen,width:variant.width,theme:variant.theme,
        path:realFile,sha256:hash});
    }
  }
  assert.equal(screenshots.length,64,"Exactly 64 live browser screenshots required.");
  const receipt={
    schemaVersion:1,evidenceKind:"authenticated-browser-capture-only",
    capturedAtUtc:new Date().toISOString(),
    origin:config.origin,productionReadOnly:Boolean(config.productionReadOnly),
    workspaces:{a:config.workspaceA,b:config.workspaceB,denied:config.workspaceDenied},
    completedJourneys:cases.length,
    screens:[...CAPTURE_SCREENS],viewportThemes:[...ACCEPTED],
    screenshots,
    limitations:[
      "Source-control review only; no Git proposal submitted",
      "Not a verified WCAG 2.2 AA audit or all negative HTTP status proof",
      "Not a verified production database/key restore, provider cost receipt or rollback",
      "Not owner release signoff or authorization to change production rollout settings",
    ],
  };
  const file=path.join(realDir,"ux-v2-browser-capture.json");
  fs.writeFileSync(file,JSON.stringify(receipt,null,2)+"\n",
    {encoding:"utf8",flag:"wx",mode:0o600});
  return {path:file,count:screenshots.length};
}
module.exports={writePrivateBrowserCapture,CAPTURE_SCREENS,screenshotDimensions};
