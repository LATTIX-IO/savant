import test from "node:test";
import assert from "node:assert/strict";
import type {SkillAssetResponseData} from "./ui-v2-skill-assets.ts";
import {projectObservedSkillSourceGraph} from "./ui-v2-workbench-source-graph.ts";

const SHA="a".repeat(40);
function fixture(input:Partial<SkillAssetResponseData>={}):SkillAssetResponseData{
 return {sourceOfTruth:"git",commitSha:SHA,root:"tier2/security/example",complete:true,omitted:0,
  files:[
   {path:"tier2/security/example/SKILL.md",relativePath:"SKILL.md",kind:"instructions",bytes:1234},
   {path:"tier2/security/example/references/policy.md",relativePath:"references/policy.md",kind:"reference",bytes:200},
   {path:"tier2/security/example/scripts/check.sh",relativePath:"scripts/check.sh",kind:"script",bytes:100},
   {path:"tier2/security/example/eval/rubric.yaml",relativePath:"eval/rubric.yaml",kind:"evaluation",bytes:300},
  ],links:[
   {raw:"references/policy.md",resolvedPath:"tier2/security/example/references/policy.md",line:9,status:"verified"},
   {raw:"references/missing.md",resolvedPath:null,line:13,status:"missing"},
   {raw:"https://example.org/reference",resolvedPath:null,line:14,status:"external"},
   {raw:"../.git/secret",resolvedPath:null,line:15,status:"unsafe"},
  ],selection:null,...input};
}
test("PER-1615 context graph includes all Git-observed categories even without Markdown links",()=>{
 const result=projectObservedSkillSourceGraph(fixture());
 assert.deepEqual(result.files.map(n=>n.relativePath),[
  "eval/rubric.yaml","references/policy.md","scripts/check.sh",
 ]);
 assert.equal(result.totalObserved,3);
 assert.equal(result.files.find(n=>n.relativePath==="references/policy.md")?.relation,"declared-in-skill-md");
 assert.deepEqual(result.files.find(n=>n.relativePath==="references/policy.md")?.authoredLines,[9]);
 assert.equal(result.files.find(n=>n.relativePath==="scripts/check.sh")?.relation,"observed-git-file");
 assert.equal(result.files.find(n=>n.relativePath==="eval/rubric.yaml")?.relation,"observed-git-file");
 assert.equal(result.files.some(n=>n.relativePath==="SKILL.md"),false);
 assert.deepEqual(result.unresolved.map(e=>e.status),["missing","external","unsafe"]);
});
test("PER-1615 a bounded incomplete Git tree does not assert a missing dependency",()=>{
 const result=projectObservedSkillSourceGraph(fixture({complete:false,omitted:31}));
 assert.equal(result.notShown,31);
 assert.equal(result.complete,false);
 assert.equal(result.unresolved[0]?.status,"unverified");
});
test("PER-1615 graph is capped and sorted with precise undisplayed count, without fabricated nodes",()=>{
 const files=Array.from({length:80},(_,n)=>({
  path:`tier2/security/example/references/ref-${n}.md`,relativePath:`references/ref-${n}.md`,
  kind:"reference" as const,bytes:20,
 }));
 const result=projectObservedSkillSourceGraph(fixture({files,links:[],omitted:3,complete:false}));
 assert.equal(result.totalObserved,80);
 assert.equal(result.files.length,24);
 assert.equal(result.notShown,59);
 assert.equal(result.files.every(n=>n.relation==="observed-git-file"),true);
 assert.deepEqual(result.unresolved,[]);
});
test("PER-1615 link declarations remain distinct from observed runtime telemetry",()=>{
 const result=projectObservedSkillSourceGraph(fixture({links:[]}));
 assert.equal(result.files.length,3);
 assert.equal(result.files.every(x=>x.relation==="observed-git-file"),true);
 assert.equal(result.unresolved.length,0);
 assert.equal(Object.prototype.hasOwnProperty.call(result,"telemetry"),false);
});
