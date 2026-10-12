import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,mkdir,writeFile,symlink,unlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createAksProjectedAssertionReader,HarnessProjectedIdentityError}
  from "./aks-projected-assertion.ts";

const now=Date.parse("2026-10-12T12:00:00Z");
const iss="https://issuer.example.com/aks/cluster/";
const sub="system:serviceaccount:savant:harness-status";
const aud="api://AzureADTokenExchange";
function jwt(overrides:Record<string,unknown>={},hdr:Record<string,unknown>={}){
 const head={alg:"RS256",typ:"JWT",...hdr};
 const body={iss,sub,aud:[aud],iat:Math.floor(now/1000)-60,
  nbf:Math.floor(now/1000)-60,exp:Math.floor(now/1000)+3600,...overrides};
 return [head,body,{sig:"test"}].map(v=>Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
}
async function denied(code:string,fn:()=>Promise<unknown>){
 await assert.rejects(fn,(e:unknown)=>e instanceof HarnessProjectedIdentityError&&e.code===code);
}
async function projected(fn:(env:{
  root:string;tokenPath:string;write:(value:string)=>Promise<void>;
  rotate:(value:string)=>Promise<void>;
  read:()=>Promise<string>;
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),"savant-aks-projection-"));
 const release1=join(root,"..release-1"),release2=join(root,"..release-2");
 const data=join(root,"..data"),tokenPath=join(root,"azure-identity-token");
 try{
  await mkdir(release1);
  await writeFile(join(release1,"token"),jwt());
  await symlink("..release-1",data);
  await symlink("..data/token",tokenPath);
  const read=createAksProjectedAssertionReader({
   tokenFilePath:tokenPath,trustedMountRoot:root,
   expectedIssuer:iss,expectedSubject:sub,nowMs:()=>now,
  });
  await fn({root,tokenPath,read,write:async value=>writeFile(join(release1,"token"),value),
   rotate:async value=>{
    await mkdir(release2);
    await writeFile(join(release2,"token"),value);
    await symlink("..release-2",join(root,"..data-next"));
    await unlink(data);
    await symlink("..release-2",data);
   },
  });
 }finally{await rm(root,{recursive:true,force:true});}
}
test("PER-1059 AKS: projected symlinks inside trusted root produce unmodified assertion",async()=>{
 await projected(async x=>assert.equal(await x.read(),jwt()));
});
test("PER-1059 AKS: reread projected volume after Kubernetes atomic rotation",async()=>{
 await projected(async x=>{
  assert.equal(await x.read(),jwt());
  const updated=jwt({exp:Math.floor(now/1000)+1800});
  await x.rotate(updated);
  assert.equal(await x.read(),updated);
 });
});
test("PER-1059 AKS: wrong issuer, FIC subject, audience or expiration fail closed",async()=>{
 const cases=[
  {iss:"https://attacker.example.org/aks/"},
  {sub:"system:serviceaccount:foreign:token"},
  {aud:["api://AKSIdentityBinding"]},
  {aud:["api://AzureADTokenExchange","api://wrong"]},
  {exp:Math.floor(now/1000)-1},
  {exp:Math.floor(now/1000)+10},
  {exp:Math.floor(now/1000)+999999},
  {nbf:Math.floor(now/1000)+500},
  {iat:Math.floor(now/1000)+500},
 ];
 for(const fields of cases){
  await projected(async x=>{
   await x.write(jwt(fields));
   await denied("invalid_assertion",x.read);
  });
 }
});
test("PER-1059 AKS: reject unsigned algorithms, malformed JWT and noncanonical base64",async()=>{
 await projected(async x=>{
  for(const value of [
   jwt({}, {alg:"none"}), jwt({}, {alg:"HS256"}),
   "not.a.jwt",jwt().split(".").slice(0,2).join("."),
   jwt().replace(/\./g,"!"),
  ]){
   await x.write(value);
   await denied("invalid_assertion",x.read);
  }
 });
});
test("PER-1059 AKS: oversized projection is unreadable and never parsed",async()=>{
 await projected(async x=>{
  await x.write("x".repeat(16500));
  await denied("assertion_unavailable",x.read);
 });
});
test("PER-1059 AKS: projected token symlink escaping trusted mount denied",async()=>{
 await projected(async x=>{
  const external=await mkdtemp(join(tmpdir(),"savant-aks-untrusted-"));
  try{
   await writeFile(join(external,"token"),jwt());
   await unlink(x.tokenPath);
   await symlink(join(external,"token"),x.tokenPath);
   await denied("assertion_unavailable",x.read);
  }finally{await rm(external,{recursive:true,force:true});}
 });
});
test("PER-1059 AKS: absent token, directory instead of file, and invalid configuration denied",async()=>{
 await projected(async x=>{
  await unlink(x.tokenPath);
  await denied("assertion_unavailable",x.read);
 });
 const cfg={tokenFilePath:"relative",trustedMountRoot:"/tmp",
  expectedIssuer:iss,expectedSubject:sub,nowMs:()=>now};
 assert.throws(()=>createAksProjectedAssertionReader(cfg),
  (e:unknown)=>e instanceof HarnessProjectedIdentityError&&e.code==="invalid_configuration");
 assert.throws(()=>createAksProjectedAssertionReader({...cfg,
   tokenFilePath:"/tmp/../etc/passwd"}),
  (e:unknown)=>e instanceof HarnessProjectedIdentityError&&e.code==="invalid_configuration");
 assert.throws(()=>createAksProjectedAssertionReader({...cfg,
   tokenFilePath:"/tmp/token",expectedAudience:"api://AKSIdentityBinding"}),
  (e:unknown)=>e instanceof HarnessProjectedIdentityError&&e.code==="invalid_configuration");
});
test("PER-1059 AKS: untrusted I/O failures expose code, never raw assertion or path",async()=>{
 await projected(async x=>{
  await x.write("");
  await denied("assertion_unavailable",x.read);
  await x.write("not-a-jwt");
  await denied("invalid_assertion",x.read);
 });
});
