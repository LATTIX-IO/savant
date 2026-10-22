import type {SkillAssetKind,SkillAssetResponseData} from "./ui-v2-skill-assets.ts";

export type ObservedSourceNode={
 path:string;relativePath:string;kind:SkillAssetKind;
 relation:"declared-in-skill-md"|"observed-git-file";
 authoredLines:readonly number[];
 bytes:number|null;
};
export type UnresolvedSourceEdge={
 raw:string;line:number;status:"missing"|"unverified"|"external"|"unsafe";
};
export type ObservedSkillSourceGraph={
 commitSha:string;root:string;
 files:readonly ObservedSourceNode[];
 unresolved:readonly UnresolvedSourceEdge[];
 totalObserved:number;notShown:number;
 complete:boolean;
};
const MAX_VISIBLE_GRAPH_NODES=24;

/** An observed Git file only establishes that it exists at the indexed commit.
 * An authored Markdown link adds a declared dependency, NEVER runtime lineage.
 * The bounded asset inventory may be incomplete; absence is then unverified,
 * not proof that a linked file is missing from the underlying repository.
 */
export function projectObservedSkillSourceGraph(
 inventory:SkillAssetResponseData,
):ObservedSkillSourceGraph{
 const authored=new Map<string,number[]>();
 for(const link of inventory.links){
  if(link.status!=="verified"||!link.resolvedPath)continue;
  const current=authored.get(link.resolvedPath)??[];
  if(!current.includes(link.line))current.push(link.line);
  authored.set(link.resolvedPath,current);
 }
 const all=inventory.files
  .filter(file=>file.kind!=="instructions" && file.path!==inventory.root+"/SKILL.md")
  .sort((a,b)=>a.kind.localeCompare(b.kind)||a.relativePath.localeCompare(b.relativePath));
 const files=all.slice(0,MAX_VISIBLE_GRAPH_NODES).map(file=>({
  path:file.path,relativePath:file.relativePath,kind:file.kind,bytes:file.bytes,
  relation:authored.has(file.path)?"declared-in-skill-md" as const:"observed-git-file" as const,
  authoredLines:authored.get(file.path)??[],
 }));
 const unresolved=inventory.links.filter(link=>link.status!=="verified").map(link=>({
  raw:link.raw,line:link.line,
  status:link.status==="missing"&&!inventory.complete?"unverified" as const:link.status,
 }));
 return {commitSha:inventory.commitSha,root:inventory.root,files,unresolved,
  totalObserved:all.length,notShown:(all.length-files.length)+inventory.omitted,
  complete:inventory.complete};
}
