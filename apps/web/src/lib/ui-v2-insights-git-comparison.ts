import type {SkillListItem,VersionHistoryItem} from "@savant/types";

/** Recorded skill-level version identities; this is not a confirmed
 * per-file diff, a provider runtime trace, or a quality-score comparison. */
const SHA=/^[a-f0-9]{40}$/i;
const SEGMENT=/^[A-Za-z0-9_.-]{1,100}$/;
function repoParts(skill:Pick<SkillListItem,"repo"|"repoProvider">):[string,string]|null{
 if(skill.repoProvider!=="github")return null;
 const parts=skill.repo.split("/");
 if(parts.length!==2||!parts.every(part=>SEGMENT.test(part)&&part!=="."&&part!==".."&&
   !part.startsWith("-")&&!part.startsWith(".")))return null;
 return [parts[0]!,parts[1]!];
}
export function recordedGitRevisionOptions(
 skill:Pick<SkillListItem,"repo"|"repoProvider">,
 versions:readonly VersionHistoryItem[],
):{commit:string;label:string}[]{
 if(!repoParts(skill))return [];
 const used=new Set<string>();
 return versions.flatMap(v=>{
  if(typeof v.commit!=="string"||!SHA.test(v.commit)||used.has(v.commit.toLowerCase()))return [];
  used.add(v.commit.toLowerCase());
  return [{commit:v.commit.toLowerCase(),
    label:`${v.ref || "Version"} · ${v.channel || "Recorded"} · ${v.commit.slice(0,12)}`}];
 });
}
/** GitHub compare is repository-wide and read-only. Not an inline skill diff. */
export function recordedGitCompareUrl(
 skill:Pick<SkillListItem,"repo"|"repoProvider">,
 versions:readonly VersionHistoryItem[],
 base:string,head:string,
):string|null{
 const parts=repoParts(skill);
 if(!parts||base===head||!SHA.test(base)||!SHA.test(head))return null;
 const allowed=new Set(recordedGitRevisionOptions(skill,versions).map(v=>v.commit));
 if(!allowed.has(base.toLowerCase())||!allowed.has(head.toLowerCase()))return null;
 return `https://github.com/${encodeURIComponent(parts[0]!)}/${encodeURIComponent(parts[1]!)}/compare/${base.toLowerCase()}...${head.toLowerCase()}`;
}
