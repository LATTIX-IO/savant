import type { RepositoryTreeEntry } from "../git/types.ts";
import { projectSkillAssets, resolveObservedSkillLinks,
  type SkillAssetProjection, type SkillAssetResponseData } from "../../lib/ui-v2-skill-assets.ts";

export const MAX_TREE_ENTRIES=20_000;
const MAX_SKILL_BYTES=200_000;
const MAX_PREVIEW_BYTES=64_000;
const SHA=/^[a-fA-F0-9]{40}$/;

export class SkillAssetError extends Error {
  readonly code:string;
  readonly status:number;
  constructor(code:string,status:number) {
    super(code);
    this.name="SkillAssetError";this.code=code;this.status=status;
  }
}
export type IndexedAssetLocation={
  organizationId:string;skillId:string;repositoryId:string;
  sourcePath:string;commitSha:string;
};
export type SkillAssetReaderPorts={
  authorizeRepository():Promise<void>;
  authorizeArtifact():Promise<void>;
  openProvider():Promise<{
    listTree(revision:string):Promise<RepositoryTreeEntry[]>;
    readFile(revision:string,path:string,maxBytes:number):Promise<Buffer>;
  }>;
};

function decodeText(bytes:Buffer,maxBytes:number):string{
  if(bytes.byteLength>maxBytes)throw new SkillAssetError("asset_too_large",413);
  let content:string;
  try{content=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch{throw new SkillAssetError("asset_not_utf8",415);}
  if(content.includes("\0"))throw new SkillAssetError("asset_not_text",415);
  return content;
}
/**
 * Explicit authorization precedes opening the provider. No guessed files,
 * reconstructed runtime edges, unpinned branch reads, or cross-tenant fallbacks.
 */
export async function readVerifiedSkillAssetSnapshot(
  index:IndexedAssetLocation,
  requestedPath:string|null,
  ports:SkillAssetReaderPorts,
):Promise<SkillAssetResponseData>{
  if(!index.organizationId||!index.skillId||!index.repositoryId||!SHA.test(index.commitSha))
    throw new SkillAssetError("source_revision_unverified",409);
  await ports.authorizeRepository();
  await ports.authorizeArtifact();
  const provider=await ports.openProvider();
  const tree=await provider.listTree(index.commitSha);
  if(tree.length>MAX_TREE_ENTRIES)throw new SkillAssetError("asset_tree_too_large",413);
  let projection:SkillAssetProjection;
  try{projection=projectSkillAssets({
    sourcePath:index.sourcePath,commitSha:index.commitSha,entries:tree,
  });}catch{throw new SkillAssetError("invalid_indexed_skill_path",409);}
  const skillPath=projection.root+"/SKILL.md";
  if(!projection.items.some(item=>item.path===skillPath))
    throw new SkillAssetError("indexed_skill_source_missing",409);
  const item=requestedPath?projection.items.find(asset=>asset.path===requestedPath):null;
  if(requestedPath&&!item)throw new SkillAssetError("asset_not_found",404);
  if(item?.bytes!=null && item.bytes>(item.kind==="instructions"?MAX_SKILL_BYTES:MAX_PREVIEW_BYTES))
    throw new SkillAssetError("asset_too_large",413);
  const skillBytes=await provider.readFile(index.commitSha,skillPath,MAX_SKILL_BYTES);
  const skillContent=decodeText(skillBytes,MAX_SKILL_BYTES);
  const links=resolveObservedSkillLinks({
    content:skillContent,sourcePath:skillPath,assets:projection,
  });
  let selection:SkillAssetResponseData["selection"]=null;
  if(item){
    const content=item.path===skillPath?skillContent:decodeText(
      await provider.readFile(index.commitSha,item.path,MAX_PREVIEW_BYTES),MAX_PREVIEW_BYTES,
    );
    selection={path:item.path,kind:item.kind,content,
      bytes:Buffer.byteLength(content,"utf8")};
  }
  return {sourceOfTruth:"git",commitSha:index.commitSha,root:projection.root,
    files:projection.items,links,complete:projection.complete,
    omitted:projection.omitted,selection};
}

