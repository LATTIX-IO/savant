import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createCapabilityResolver, CapabilityResolveError } from "./capability-resolver.ts";

const A="a".repeat(40), B="b".repeat(64), actor={organizationId:"tenant-a",subject:"subject-a"};
const workflow=()=>({
  schemaVersion:1,kind:"workflow_spec",organizationId:"tenant-a",artifactId:"triage",version:"1.0.0",
  contentHash:"sha256:"+B,locator:{source:"git",repositoryId:"repo-a",path:"workflows/triage.json",commitSha:A},
});
const skillContent="# Review\nUse a bounded test harness.\n";
const skillDigest=createHash("sha256").update(skillContent,"utf8").digest("hex");
const skill=()=>({
  schemaVersion:1,kind:"skill",organizationId:"tenant-a",artifactId:"review",version:"1.2.3",
  contentHash:"sha256:"+skillDigest,
  locator:{source:"git",repositoryId:"repo-a",path:"tier3/workflow/review/SKILL.md",commitSha:A},
});
const fails=(code:string)=>(e:unknown)=>e instanceof CapabilityResolveError && e.code===code;
function harness() {
  const calls:string[]=[];
  let authorized=true, failed=false;
  const resolver=createCapabilityResolver({
    async authorize(a,ref){
      calls.push("authorize");
      if(!authorized||a.subject!=="subject-a"||a.organizationId!=="tenant-a"||ref.locator.source!=="git") throw new CapabilityResolveError("not_found",404);
    },
    async workflow(_a,_ref){
      calls.push("workflow");
      if(failed) throw Error("provider secret should not leak");
      return {specification:{schemaVersion:1,workflowId:"triage",version:"1.0.0",source:{runtime:"external"},nodes:[],edges:[]},digest:B,commitSha:A};
    },
    async skill(_a,_ref){
      calls.push("skill");
      if(failed) throw Error("credential=secret");
      return {content:skillContent,commitSha:A};
    },
  });
  return {resolver,calls,deny(){authorized=false},fail(){failed=true}};
}
test("PER-1173: pinned workflow resolution preserves verified immutable identity",async()=>{
  const h=harness();
  const result=await h.resolver.resolve(actor,workflow());
  assert.equal(result.kind,"workflow_spec");
  assert.equal(result.verifiedDigest,"sha256:"+B);
  assert.deepEqual(h.calls,["authorize","workflow"]);
});
test("PER-1173: pinned skill content digest checked against actual UTF8",async()=>{
  const h=harness();
  const result=await h.resolver.resolve(actor,skill());
  assert.equal(result.kind,"skill");
  if(result.kind==="skill")assert.equal(result.content,skillContent);
  assert.deepEqual(h.calls,["authorize","skill"]);
});
test("PER-1173: forged tenant and missing identity deny before any provider access",async()=>{
  const h=harness();
  await assert.rejects(h.resolver.resolve({...actor,organizationId:"tenant-b"},workflow()),fails("not_found"));
  await assert.rejects(h.resolver.resolve({...actor,subject:""},workflow()),fails("auth_required"));
  h.deny();
  await assert.rejects(h.resolver.resolve(actor,skill()),fails("not_found"));
  assert.equal(h.calls.filter(x=>x!=="authorize").length,0);
});
test("PER-1173: invalid refs, paths and unsupported types never trigger Git",async()=>{
  const h=harness();
  await assert.rejects(h.resolver.resolve(actor,{...workflow(),schemaVersion:99}),fails("invalid_reference"));
  await assert.rejects(h.resolver.resolve(actor,{...workflow(),locator:{...workflow().locator,path:"../passwords"}}),fails("invalid_reference"));
  await assert.rejects(h.resolver.resolve(actor,{...workflow(),locator:{...workflow().locator,path:"workflows/another.json"}}),fails("locator_mismatch"));
  await assert.rejects(h.resolver.resolve(actor,{...workflow(),kind:"plugin"}),fails("unsupported_kind"));
  await assert.rejects(h.resolver.resolve(actor,{...workflow(),contentHash:undefined}),fails("provenance_incomplete"));
  assert.equal(h.calls.filter(x=>x==="workflow"||x==="skill").length,0);
});
test("PER-1173: mismatched workflow ID, version, commit or digest fails closed",async()=>{
  const h=harness();
  for(const changes of [
    {artifactId:"other",locator:{...workflow().locator,path:"workflows/other.json"}},
    {version:"1.2.3"},{contentHash:"sha256:"+"c".repeat(64)},
    {locator:{...workflow().locator,commitSha:"d".repeat(40)}}
  ]) await assert.rejects(h.resolver.resolve(actor,{...workflow(),...changes}),fails("integrity_mismatch"));
});
test("PER-1173: skill wrong digest/commit and incomplete provenance never returns content",async()=>{
  const h=harness();
  await assert.rejects(h.resolver.resolve(actor,{...skill(),contentHash:"sha256:"+B}),fails("integrity_mismatch"));
  await assert.rejects(h.resolver.resolve(actor,{...skill(),locator:{...skill().locator,commitSha:"c".repeat(40)}}),fails("integrity_mismatch"));
  await assert.rejects(h.resolver.resolve(actor,{...skill(),contentHash:undefined}),fails("provenance_incomplete"));
});
test("PER-1173: provider exception redacted into typed unavailable error",async()=>{
  const h=harness();h.fail();
  await assert.rejects(h.resolver.resolve(actor,workflow()),e=>fails("provider_unavailable")(e)&&!String(e).includes("secret"));
  await assert.rejects(h.resolver.resolve(actor,skill()),e=>fails("provider_unavailable")(e)&&!String(e).includes("credential"));
});
test("PER-1173: strict v1 reference snapshot rejects hostile getters without execution",async()=>{
  const h=harness();const evil=workflow();Object.defineProperty(evil,"injected",{enumerable:true,get(){throw Error("executed getter");}});
  await assert.rejects(h.resolver.resolve(actor,evil),fails("invalid_reference"));
  assert.deepEqual(h.calls,[]);
});
