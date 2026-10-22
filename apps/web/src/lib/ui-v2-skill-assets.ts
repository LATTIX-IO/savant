/**
 * PER-1610: bounded, deterministic projection of *observed* Git tree entries.
 * No inferred files or runtime connections. The caller must authorize and pin
 * repository + skill before invoking this pure layer.
 */
export type SkillAssetKind="instructions"|"reference"|"script"|"evaluation"|"metadata";
export type SkillAsset={path:string;relativePath:string;kind:SkillAssetKind;bytes:number|null};
export type SkillAssetProjection={
  source:"pinned-git-tree";
  root:string;
  commitSha:string;
  items:SkillAsset[];
  omitted:number;
  complete:boolean;
};
const PATH=/^[a-zA-Z0-9][a-zA-Z0-9_.@+/-]{0,511}$/;
const SHA=/^[a-fA-F0-9]{40,64}$/;
const MAX_ITEMS=200;
function safeSegments(value:string):boolean{
  if(!PATH.test(value)||value.includes("\\")||value.includes("%")||value.startsWith("/")||value.includes("//"))return false;
  return value.split("/").every(part=>part!==""&&part!=="."&&part!==".."&&!part.startsWith(".git"));
}
export function skillAssetRoot(sourcePath:string):string{
  if(!safeSegments(sourcePath))throw new Error("invalid_skill_source_path");
  const root=sourcePath.endsWith("/SKILL.md")?sourcePath.slice(0,-9):sourcePath;
  if(!root||!safeSegments(root))throw new Error("invalid_skill_source_path");
  return root;
}
function classify(relative:string):SkillAssetKind|null{
  if(relative==="SKILL.md")return "instructions";
  if(relative==="metadata.yaml"||relative==="metadata.yml")return "metadata";
  if(relative.startsWith("references/"))return "reference";
  if(relative.startsWith("scripts/"))return "script";
  if(relative.startsWith("eval/")||relative.startsWith("evals/"))return "evaluation";
  return null;
}
/** Actual provider tree only. Symlink detection must occur at adapter boundary;
 * an unresolved provider kind must NEVER be coerced into a regular file. */
export function projectSkillAssets(input:{
  sourcePath:string;
  commitSha:string;
  entries:readonly {path:string;kind:"file"|"dir";size?:number|undefined}[];
}):SkillAssetProjection{
  if(!SHA.test(input.commitSha))throw new Error("source_revision_unverified");
  const root=skillAssetRoot(input.sourcePath);
  const seen=new Set<string>();
  const candidates:SkillAsset[]=[];
  for(const entry of input.entries){
    if(entry.kind!=="file"||!safeSegments(entry.path)||!entry.path.startsWith(root+"/"))continue;
    const relative=entry.path.slice(root.length+1);
    const kind=classify(relative);
    if(!kind||seen.has(entry.path))continue;
    seen.add(entry.path);
    const bytes=Number.isSafeInteger(entry.size)&&entry.size!>=0?entry.size!:null;
    candidates.push({path:entry.path,relativePath:relative,kind,bytes});
  }
  // Truncation is deterministic and never hides the canonical SKILL.md.
  candidates.sort((a,b)=>a.kind==="instructions"?-1:b.kind==="instructions"?1:
    a.relativePath.localeCompare(b.relativePath));
  const omitted=Math.max(0,candidates.length-MAX_ITEMS);
  const assets=candidates.slice(0,MAX_ITEMS).sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
  return {source:"pinned-git-tree",root,commitSha:input.commitSha,items:assets,
    omitted,complete:omitted===0};
}
/** Actual relative markdown links are suggestions until resolved within
 * an authenticated, pinned Git tree. No invented dependency edges. */
export type SkillAssetLink={raw:string;resolvedPath:string|null;line:number;status:"verified"|"missing"|"external"|"unsafe"};
export function resolveObservedSkillLinks(input:{
  content:string;sourcePath:string;assets:SkillAssetProjection;
}):SkillAssetLink[]{
  const results:SkillAssetLink[]=[];
  const known=new Set(input.assets.items.map(a=>a.path));
  const root=input.assets.root;
  for(const [index,line] of input.content.split(/\r?\n/).entries()){
    const pattern=/\[[^\]]{0,160}\]\(([^\s)]+)\)/g;
    for(const match of line.matchAll(pattern)){
      if(results.length>=100)return results;
      const raw=match[1]||"";
      if(/^(https?:|mailto:)/i.test(raw)){
        results.push({raw,resolvedPath:null,line:index+1,status:"external"});continue;
      }
      const rawPath=raw.split("#")[0]||"";
      const path=rawPath.startsWith("./")?rawPath.slice(2):rawPath;
      if(!path||!safeSegments(path)){
        results.push({raw,resolvedPath:null,line:index+1,status:"unsafe"});continue;
      }
      const resolved=root+"/"+path;
      results.push({raw,resolvedPath:known.has(resolved)?resolved:null,
        line:index+1,status:known.has(resolved)?"verified":"missing"});
    }
  }
  return results;
}

/** Shared wire contract for the authenticated Git asset inventory. */
export type SkillAssetResponseData={
  sourceOfTruth:"git";
  commitSha:string;
  root:string;
  files:SkillAsset[];
  links:SkillAssetLink[];
  complete:boolean;
  omitted:number;
  selection:{path:string;kind:SkillAssetKind;content:string;bytes:number}|null;
};
export type SkillAssetApiResponse={data:SkillAssetResponseData;meta:{sourceOfTruth:string;generatedAt:string;schemaVersion:number}};
