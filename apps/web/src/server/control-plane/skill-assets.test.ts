import test from "node:test";
import assert from "node:assert/strict";
import type { RepositoryTreeEntry } from "../git/types.ts";
import { readVerifiedSkillAssetSnapshot, SkillAssetError, type IndexedAssetLocation,
 type SkillAssetReaderPorts } from "./skill-assets.ts";

const commitSha="a".repeat(40);
const root="tier2/methodology/legal/contract-review";
const index:IndexedAssetLocation={organizationId:"tenant-a",repositoryId:"repo-a",
 skillId:"contract-review",sourcePath:root,commitSha};
const skillPath=root+"/SKILL.md";
const referencePath=root+"/references/policy.md";
const tree:RepositoryTreeEntry[]=[
 {path:skillPath,kind:"file",size:84},
 {path:referencePath,kind:"file",size:22},
 {path:root+"/scripts/check.py",kind:"file",size:22},
 {path:root+"/private.env",kind:"file",size:12},
 {path:root+"/references",kind:"dir"},
 {path:"tier2/methodology/legal/other/SKILL.md",kind:"file",size:70},
];

function fixture(config?:{denyRepo?:boolean;denyArtifact?:boolean;bytes?:Buffer;tree?:RepositoryTreeEntry[]}){
 const calls:string[]=[];
 const ports:SkillAssetReaderPorts={
  async authorizeRepository(){
   calls.push("repo");
   if(config?.denyRepo)throw new SkillAssetError("not_found",404);
  },
  async authorizeArtifact(){
   calls.push("artifact");
   if(config?.denyArtifact)throw new SkillAssetError("not_found",404);
  },
  async openProvider(){
   calls.push("open");
   return {
    async listTree(revision){
     calls.push("tree:"+revision);
     return config?.tree??tree;
    },
    async readFile(revision,path,maxBytes){
     calls.push("read:"+revision+":"+path+":"+maxBytes);
     return config?.bytes??Buffer.from(path===skillPath?"# Skill\n[Policy](references/policy.md)\n[Lost](references/missing.md)":
      "# Current internal policy\n");
    },
   };
  },
 };
 return {calls,ports};
}
test("PER-1610 repository authorization denies before credential or provider reads",async()=>{
 const f=fixture({denyRepo:true});
 await assert.rejects(readVerifiedSkillAssetSnapshot(index,null,f.ports),
  (e:unknown)=>e instanceof SkillAssetError&&e.status===404);
 assert.deepEqual(f.calls,["repo"]);
});
test("PER-1610 per-skill deny blocks provider identity and file enumeration",async()=>{
 const f=fixture({denyArtifact:true});
 await assert.rejects(readVerifiedSkillAssetSnapshot(index,null,f.ports),
  (e:unknown)=>e instanceof SkillAssetError&&e.status===404);
 assert.deepEqual(f.calls,["repo","artifact"]);
});
test("PER-1610 missing source SHA fails closed before even querying ACL or Git",async()=>{
 const f=fixture();
 await assert.rejects(readVerifiedSkillAssetSnapshot({...index,commitSha:"main"},null,f.ports),
  (e:unknown)=>e instanceof SkillAssetError&&e.code==="source_revision_unverified");
 assert.deepEqual(f.calls,[]);
});
test("PER-1610 observed assets and declared links are pinned to exact Git revision",async()=>{
 const f=fixture();
 const r=await readVerifiedSkillAssetSnapshot(index,referencePath,f.ports);
 assert.equal(r.commitSha,commitSha);
 assert.equal(r.files.length,3);
 assert.equal(r.files.some(file=>file.path.includes("private.env")),false);
 assert.deepEqual(r.links.map(link=>link.status),["verified","missing"]);
 assert.equal(r.links[0]?.line,2);
 assert.equal(r.links[0]?.resolvedPath,referencePath);
 assert.equal(r.selection?.content,"# Current internal policy\n");
 assert.equal(r.selection?.path,referencePath);
 assert.deepEqual(f.calls.slice(0,4),["repo","artifact","open","tree:"+commitSha]);
 assert.ok(f.calls.slice(4).every(call=>call.startsWith("read:"+commitSha+":")));
});
test("PER-1610 arbitrary unobserved, cross-skill and private paths never reach readFile",async()=>{
 for(const path of [
  root+"/private.env",root+"/references/missing.md",
  root+"/../other/SKILL.md",root+"/%2e%2e/secret",
  "tier2/methodology/legal/other/SKILL.md",
 ]){
  const f=fixture();
  await assert.rejects(readVerifiedSkillAssetSnapshot(index,path,f.ports),
    (e:unknown)=>e instanceof SkillAssetError&&e.status===404,path);
  assert.equal(f.calls.filter(v=>v.startsWith("read:")).length,0,path);
 }
});
test("PER-1610 oversized and binary files do not return UTF-8 substitute characters",async()=>{
 const huge=[...tree.filter(t=>t.path!==referencePath),{
  path:referencePath,kind:"file" as const,size:1_000_000,
 }];
 const f=fixture({tree:huge});
 await assert.rejects(readVerifiedSkillAssetSnapshot(index,referencePath,f.ports),
  (e:unknown)=>e instanceof SkillAssetError&&e.code==="asset_too_large");
 assert.equal(f.calls.filter(c=>c.startsWith("read:")).length,0);
 const b=fixture({bytes:Buffer.from([0xff,0xfe,0x00])});
 await assert.rejects(readVerifiedSkillAssetSnapshot(index,null,b.ports),
  (e:unknown)=>e instanceof SkillAssetError&&e.code==="asset_not_utf8");
 const n=fixture({bytes:Buffer.from("contains\0binary")});
 await assert.rejects(readVerifiedSkillAssetSnapshot(index,null,n.ports),
  (e:unknown)=>e instanceof SkillAssetError&&e.code==="asset_not_text");
});
test("PER-1610 source must actually exist at pinned revision, not only in DB index",async()=>{
 const f=fixture({tree:tree.filter(x=>x.path!==skillPath)});
 await assert.rejects(readVerifiedSkillAssetSnapshot(index,null,f.ports),
  (e:unknown)=>e instanceof SkillAssetError&&e.code==="indexed_skill_source_missing");
 assert.equal(f.calls.filter(c=>c.startsWith("read:")).length,0);
});
