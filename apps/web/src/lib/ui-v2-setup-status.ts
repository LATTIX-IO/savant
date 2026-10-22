import type {AIConnectionSummary,RepositoryListItem,SkillListItem} from "@savant/types";
import {getUiV2RepositoryHealth} from "./ui-v2-library-model.ts";
import {inspectUiV2ProviderLanes} from "./ui-v2-provider-lanes.ts";

export type SetupState="observed"|"action-required"|"unknown"|"not-verified";
export type SetupStep={
 id:"repository"|"index"|"executor"|"cases"|"verified-run";
 title:string;detail:string;state:SetupState;
 target:"/repositories"|"/skills"|"/evaluations"|"/settings?section=ai";
};
export type SetupEvidence={
 steps:readonly SetupStep[];
 observed:number;
 required:number;
 completeness:"partial"|"unavailable";
};
const present=(yes:boolean|null):SetupState=>yes===null?"unknown":yes?"observed":"action-required";
export function describeWorkspaceSetup(input:{
 repositories:readonly RepositoryListItem[]|null;
 skills:readonly SkillListItem[]|null;
 models:readonly AIConnectionSummary[]|null;
}):SetupEvidence{
 const repositories=input.repositories;
 const skills=input.skills;
 const indexed=repositories?.some(r=>getUiV2RepositoryHealth(r)==="ready")??null;
 const sourceReady=repositories===null||skills===null?null:Boolean(indexed&&skills.length>0);
 const executor=inspectUiV2ProviderLanes(input.models).workspaceOpenAiExecutor;
 const modelState=input.models===null?null:executor!==null;
 const steps:SetupStep[]=[
  {id:"repository",title:"Connect your source repository",
    detail:"Authorized repository metadata; connection verification does not imply execution readiness.",
    state:present(repositories===null?null:repositories.length>0),target:"/repositories"},
  {id:"index",title:"Index the skills you want to govern",
    detail:"Requires an indexed repository and an actual authorized skill record.",
    state:present(sourceReady),target:"/skills"},
  {id:"executor",title:"Configure a Test Bench model executor",
    detail:"A permitted tenant-owned provider credential is configured; no call or billing receipt is implied.",
    state:present(modelState),target:"/settings?section=ai"},
  {id:"cases",title:"Create and save evaluation cases",
    detail:"Encrypted case-suite availability is checked in Evaluations; setup cannot infer it from the Git index.",
    state:"not-verified",target:"/evaluations"},
  {id:"verified-run",title:"Verify the first provider-backed evaluation",
    detail:"Requires an actual completed case receipt with observed provider usage, not imported baseline scores.",
    state:"not-verified",target:"/evaluations"},
 ];
 const observed=steps.filter(s=>s.state==="observed").length;
 const required=steps.length;
 return {steps,observed,required,completeness:steps.every(s=>s.state==="unknown"||s.state==="not-verified")?"unavailable":"partial"};
}
