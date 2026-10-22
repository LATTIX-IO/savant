import test from "node:test";
import assert from "node:assert/strict";
import {projectSkillAssets,skillAssetRoot,resolveObservedSkillLinks} from "./ui-v2-skill-assets.ts";
const SHA="a".repeat(40);
const prefix="tier2/methodology/legal/contract-review-assistant";
const entries=[
 {path:prefix+"/SKILL.md",kind:"file" as const,size:300},
 {path:prefix+"/references/policy.md",kind:"file" as const,size:125},
 {path:prefix+"/scripts/verify.py",kind:"file" as const,size:250},
 {path:prefix+"/eval/rubric.yaml",kind:"file" as const,size:120},
 {path:prefix+"/private.env",kind:"file" as const,size:12},
 {path:prefix+"/references",kind:"dir" as const},
 {path:"tier2/methodology/legal/other/SKILL.md",kind:"file" as const},
];
test("PER-1610 tree contains only observed within-root allowlisted files, not invented data",()=>{
 const p=projectSkillAssets({sourcePath:prefix,commitSha:SHA,entries});
 assert.equal(p.source,"pinned-git-tree");
 assert.equal(p.root,prefix);
 assert.equal(p.complete,true);
 assert.deepEqual(p.items.map(a=>a.relativePath),
 ["eval/rubric.yaml","references/policy.md","scripts/verify.py","SKILL.md"]);
 assert.equal(p.items.some(a=>a.path.includes("private.env")),false);
});
test("same index source may be a file or package path; unsafe paths and missing revision fail closed",()=>{
 assert.equal(skillAssetRoot(prefix+"/SKILL.md"),prefix);
 for(const path of ["../secrets","/etc/passwd",prefix+"/../other",prefix+"/%2e%2e",prefix+"/.git/config",prefix+"//SKILL.md"]){
  assert.throws(()=>skillAssetRoot(path));
 }
 assert.throws(()=>projectSkillAssets({sourcePath:prefix,commitSha:"unverified",entries}));
});
test("Git observations never invent references and never allow traversal as a resolved target",()=>{
 const p=projectSkillAssets({sourcePath:prefix+"/SKILL.md",commitSha:SHA,entries});
 const links=resolveObservedSkillLinks({sourcePath:prefix+"/SKILL.md",assets:p,
 content:"[Read](references/policy.md)\n[Missing](references/unseen.md)\n[Host](https://docs.example.com)\n[Escape](../secrets)\n[Encoded](%2e%2e/other)"});
 assert.deepEqual(links.map(x=>x.status),["verified","missing","external","unsafe","unsafe"]);
 assert.equal(links[0]?.resolvedPath,prefix+"/references/policy.md");
 assert.equal(links[1]?.resolvedPath,null);
 assert.equal(links[0]?.line,1);
});
test("list is bounded and honestly reports truncation",()=>{
 const abundant=Array.from({length:225},(_,i)=>({path:prefix+"/references/file"+i+".md",kind:"file" as const}));
 const p=projectSkillAssets({sourcePath:prefix,commitSha:SHA,entries:abundant});
 assert.equal(p.items.length,200);
 assert.equal(p.omitted,25);
 assert.equal(p.complete,false);
});

test("the canonical SKILL.md remains inspectable when an index is truncated",()=>{
 const many=Array.from({length:250},(_,i)=>({path:prefix+"/references/a"+i+".md",kind:"file" as const}));
 const p=projectSkillAssets({sourcePath:prefix,commitSha:SHA,entries:[...many,entries[0]!]});
 assert.equal(p.items.length,200);
 assert.equal(p.omitted,51);
 assert.ok(p.items.some(file=>file.relativePath==="SKILL.md"));
});
test("simple dotted relative file paths remain verifiable without permitting traversal",()=>{
 const p=projectSkillAssets({sourcePath:prefix,commitSha:SHA,entries});
 const r=resolveObservedSkillLinks({sourcePath:prefix+"/SKILL.md",assets:p,
   content:"[Valid](./references/policy.md#overview)\n[Bad](./../private.env)"});
 assert.deepEqual(r.map(link=>link.status),["verified","unsafe"]);
 assert.equal(r[0]?.resolvedPath,prefix+"/references/policy.md");
});
