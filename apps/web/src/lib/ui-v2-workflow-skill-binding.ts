import type {SkillListItem} from "@savant/types";

export type AuthoredWorkflowSkillBinding={
  evidence:"indexed-git-metadata-only";
  skillId:string;
  skillUuid:string;
  repository:string;
  sourcePath:string;
  sourceCommitSha:string;
};
const SHA=/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const PATH=/^[A-Za-z0-9][A-Za-z0-9._@+/-]{0,511}$/;
function safePath(path:string):boolean{
  return PATH.test(path)&&!path.includes("//")&&!path.includes("\\")&&
    path.split("/").every(part=>part!=="."&&part!==".."&&part!==".git");
}
export function createAuthoredWorkflowSkillBinding(
 skill:SkillListItem,repositoryName:string,
):AuthoredWorkflowSkillBinding|null{
  const path=skill.projection?.sourcePath??"";
  const commit=skill.projection?.sourceCommitSha??"";
  if(!repositoryName||skill.repo.toLowerCase()!==repositoryName.toLowerCase()||
    !skill.skillUuid||!skill.id||!safePath(path)||!SHA.test(commit))return null;
  return {evidence:"indexed-git-metadata-only",
    skillId:skill.id,skillUuid:skill.skillUuid,repository:skill.repo,
    sourcePath:path,sourceCommitSha:commit.toLowerCase()};
}
export function describeAuthoredWorkflowSkillBinding(
 raw:unknown,skills:readonly SkillListItem[]|null,repositoryName:string,
):"not-bound"|"index-unavailable"|"not-listed"|"index-drift"|"matching-index"{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return "not-bound";
 const x=raw as Partial<AuthoredWorkflowSkillBinding>;
 if(x.evidence!=="indexed-git-metadata-only"||
    typeof x.skillUuid!=="string"||typeof x.sourceCommitSha!=="string")
   return "not-bound";
 if(skills===null)return "index-unavailable";
 const match=skills.find(s=>s.skillUuid===x.skillUuid&&
   s.repo.toLowerCase()===repositoryName.toLowerCase());
 if(!match)return "not-listed";
 const now=createAuthoredWorkflowSkillBinding(match,repositoryName);
 if(!now)return "not-listed";
 return now.skillId===x.skillId&&now.sourceCommitSha===x.sourceCommitSha&&
   now.sourcePath===x.sourcePath?"matching-index":"index-drift";
}
