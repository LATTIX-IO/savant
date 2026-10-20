import {createHash} from "node:crypto";
// Intentionally dependency-free from bootstrap/upgrade: those CLIs await this
// module at top level, so importing them back here would create an async ESM cycle.
const REQUIRED_POST_UPGRADE_CHECKS=Object.freeze([
  "Savant unit, type, lint, build and secrets",
  "Workflow schema migration and tenant integrity",
  "Security checks",
  "Code quality and tests",
  "validate-submodule-pointers",
  "Build installer linux-amd64",
  "Build installer windows-amd64",
  "Build installer macos-amd64",
  "Build installer macos-arm64",
  "Blocking production dependency audit (high/critical)"
]);

const REPOSITORY="LATTIX-IO/savant";
const REPOSITORY_ID=1245790195; // Exact verified GitHub repo ID, not merely a reusable name.
const BASE="/repos/"+REPOSITORY;
const APP_ID=15368;
const SHA=/^[a-f0-9]{40}$/;
const ID=/^[1-9][0-9]{0,14}$/;
const PROFILE="owner_operated";
const SCHEMA="savant.github-owner-governance.v1";
const MAIN_RULE="savant-owner-operated-main-v1";
const TAG_RULE="savant-immutable-release-tags-v1";
const ACK="SOLE-OWNER-CI-ENFORCED";
const CONFIRM="PROTECT-LATTIX-IO-savant-SOLO";
const RULES=BASE+"/rulesets?includes_parents=true&per_page=100";
const REQUIRED=Object.freeze([...REQUIRED_POST_UPGRADE_CHECKS]);
export const OWNER_REQUIRED_CHECKS=REQUIRED;
export const OWNER_PROFILE=PROFILE;
export const OWNER_CONFIRMATION=CONFIRM;
export class OwnerGovernanceError extends Error {
  constructor(code,status=0){super(code);this.name="OwnerGovernanceError";this.code=code;this.status=status;}
}
function deny(code){throw new OwnerGovernanceError(code);}
function validOwnerId(value){
  if(typeof value!=="string"||!ID.test(value)||!Number.isSafeInteger(Number(value)))
    deny("invalid_owner_id");
  return Number(value);
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const contextEntries=()=>REQUIRED.map(context=>({context,integration_id:APP_ID}));
export function compileOwnerGovernancePlan({
  repository=REPOSITORY,operatorId,mainSha,acknowledgement
}={}){
  if(repository!==REPOSITORY)deny("repository_out_of_scope");
  const ownerId=validOwnerId(operatorId);
  if(typeof mainSha!=="string"||!SHA.test(mainSha))deny("expected_main_sha_required");
  if(acknowledgement!==ACK)deny("explicit_owner_acknowledgement_required");
  const main={
    name:MAIN_RULE,target:"branch",enforcement:"active",bypass_actors:[],
    conditions:{ref_name:{include:["refs/heads/main"],exclude:[]}},
    rules:[
      {type:"deletion"},{type:"non_fast_forward"},
      {type:"pull_request",parameters:{
        allowed_merge_methods:["squash"],dismiss_stale_reviews_on_push:false,
        require_code_owner_review:false,require_last_push_approval:false,
        required_approving_review_count:0,required_review_thread_resolution:true
      }},
      {type:"required_status_checks",parameters:{
        required_status_checks:contextEntries(),
        strict_required_status_checks_policy:true
      }}
    ]
  };
  const tags={
    name:TAG_RULE,target:"tag",enforcement:"active",bypass_actors:[],
    conditions:{ref_name:{include:["refs/tags/v*"],exclude:[]}},
    rules:[{type:"deletion"},{type:"update",parameters:{update_allows_fetch_and_merge:false}}]
  };
  const environment={
    wait_timer:0,prevent_self_review:false,reviewers:[],
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}
  };
  const operations=[
    {method:"POST",path:BASE+"/actions/variables",
      body:{name:"SAVANT_RELEASE_PUBLISH_ENABLED",value:"false"},expected:201,onMissingOnly:"publication"},
    {method:"POST",path:BASE+"/actions/variables",
      body:{name:"SAVANT_RELEASE_GOVERNANCE_PROFILE",value:PROFILE},expected:201},
    {method:"POST",path:BASE+"/rulesets",body:main,expected:201},
    {method:"POST",path:BASE+"/rulesets",body:tags,expected:201},
    {method:"PUT",path:BASE+"/environments/savant-release",body:environment,expected:200},
    {method:"POST",path:BASE+"/environments/savant-release/deployment-branch-policies",
      body:{name:"main",type:"branch"},expected:200}
  ];
  const core={schema:SCHEMA,profile:PROFILE,repository:REPOSITORY,repositoryId:REPOSITORY_ID,
    operatorId:ownerId,expectedMainSha:mainSha,acknowledgement:ACK,
    requiredCheckCount:REQUIRED.length,publicationEnabled:false,operations};
  return {...core,planSha256:createHash("sha256").update(JSON.stringify(core)).digest("hex")};
}
export function assertOwnerGovernancePlan(input){
  if(!input||input.schema!==SCHEMA||input.profile!==PROFILE||
    !Number.isSafeInteger(input.operatorId))deny("invalid_owner_governance_plan");
  const expected=compileOwnerGovernancePlan({
    repository:input.repository,operatorId:String(input.operatorId),
    mainSha:input.expectedMainSha,acknowledgement:input.acknowledgement
  });
  if(!same(input,expected))deny("modified_owner_governance_plan");
  return expected;
}
function completeRuns(runs){
  if(!runs||!Number.isSafeInteger(runs.total_count)||
    !Array.isArray(runs.check_runs)||runs.total_count!==runs.check_runs.length||
    runs.total_count>100)deny("incomplete_ci_evidence");
  for(const name of REQUIRED){
    const found=runs.check_runs.filter(x=>x?.name===name&&
      x.status==="completed"&&x.conclusion==="success"&&
      x.app?.id===APP_ID&&x.app?.slug==="github-actions");
    if(found.length!==1)deny("required_ci_context_unverified");
  }
}
async function optional(read,path){
  try{return await read(path);}catch(e){if(e?.status===404)return null;throw e;}
}
export async function preflightOwnerGovernance(plan,read){
  const canonical=assertOwnerGovernancePlan(plan);
  if(typeof read!=="function")deny("missing_read_adapter");
  const user=await read("/user");
  if(user?.id!==canonical.operatorId||typeof user?.login!=="string"||!user.login)
    deny("owner_identity_mismatch");
  const repo=await read(BASE);
  if(repo?.default_branch!=="main"||repo?.full_name!==REPOSITORY||repo?.id!==REPOSITORY_ID)
    deny("repository_identity_mismatch");
  const branch=await read(BASE+"/branches/main");
  if(branch?.name!=="main"||branch.protected!==false||
     branch?.commit?.sha!==canonical.expectedMainSha)
    deny("stale_main_or_existing_protection");
  const existing=await read(RULES);
  if(!Array.isArray(existing)||existing.length!==0)
    deny("existing_rulesets_require_manual_reconciliation");
  completeRuns(await read(BASE+"/commits/"+canonical.expectedMainSha+"/check-runs?per_page=100"));
  const flag=await optional(read,BASE+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED");
  if(flag!==null&&(flag?.name!=="SAVANT_RELEASE_PUBLISH_ENABLED"||flag?.value!=="false"))
    deny("publication_not_disabled");
  // If a previous bootstrap partially wrote this marker, manual recovery is mandatory.
  if(await optional(read,BASE+"/actions/variables/SAVANT_RELEASE_GOVERNANCE_PROFILE"))
    deny("existing_profile_requires_manual_reconciliation");
  if(await optional(read,BASE+"/environments/savant-release"))
    deny("existing_environment_requires_manual_reconciliation");
  return {expectedMainSha:canonical.expectedMainSha,createPublication:flag===null};
}
function exactRule(actual,expected){
  if(!actual||actual.name!==expected.name||actual.target!==expected.target||
    actual.enforcement!=="active"||!same(actual.bypass_actors,[])||
    !same(actual.conditions?.ref_name,expected.conditions.ref_name)||
    !Array.isArray(actual.rules)||actual.rules.length!==expected.rules.length)
    return false;
  const expectedTypes=expected.rules.map(x=>x.type);
  if(new Set(actual.rules.map(x=>x.type)).size!==actual.rules.length||
     !expectedTypes.every(x=>actual.rules.some(y=>y.type===x)))return false;
  const value=type=>actual.rules.find(x=>x.type===type);
  if(actual.target==="branch"){
    const p=value("pull_request")?.parameters;
    if(!p||!same(p.allowed_merge_methods,["squash"])||
      p.required_approving_review_count!==0||
      p.require_last_push_approval!==false||
      p.require_code_owner_review!==false||
      p.required_review_thread_resolution!==true||
      p.dismiss_stale_reviews_on_push!==false)return false;
    const c=value("required_status_checks")?.parameters;
    if(!c||c.strict_required_status_checks_policy!==true||
      !Array.isArray(c.required_status_checks)||c.required_status_checks.length!==REQUIRED.length||
      !same(c.required_status_checks,contextEntries()))return false;
  }else if(value("update")?.parameters?.update_allows_fetch_and_merge!==false)return false;
  return true;
}
export async function auditOwnerGovernance(repository,read,{mode="audit",expectedMainSha}={}){
  if(repository!==REPOSITORY||typeof read!=="function"||!["audit","publish"].includes(mode))
    deny("invalid_owner_audit_request");
  if(expectedMainSha!==undefined&&(!SHA.test(expectedMainSha)))deny("expected_main_sha_required");
  const checks={
    repository_and_main:false,active_no_bypass_main:false,ten_app_bound_checks:false,
    immutable_tags:false,solo_environment_main_only:false,
    publication_state_matches_expected:false,owner_profile_explicit:false
  };
  try{
    const rep=await read(BASE),branch=await read(BASE+"/branches/main");
    checks.repository_and_main=rep?.full_name===REPOSITORY&&rep?.id===REPOSITORY_ID&&rep.default_branch==="main"&&
      branch?.name==="main"&&branch.protected===true&&
      SHA.test(branch?.commit?.sha||"")&&
      (expectedMainSha===undefined||branch.commit.sha===expectedMainSha);
    const summary=await read(RULES);
    if(!Array.isArray(summary)||summary.length!==2||
       summary.some(x=>!Number.isSafeInteger(x?.id)||x.id<1))deny("ruleset_inventory_unverified");
    const details=[];
    for(const x of summary)details.push(await read(BASE+"/rulesets/"+x.id));
    const target=compileOwnerGovernancePlan({
      operatorId:"1",mainSha:expectedMainSha||branch.commit.sha,acknowledgement:ACK
    });
    const expectedMain=target.operations[2].body,expectedTag=target.operations[3].body;
    const gotMain=details.filter(x=>x.name===MAIN_RULE&&x.target==="branch");
    const gotTag=details.filter(x=>x.name===TAG_RULE&&x.target==="tag");
    checks.active_no_bypass_main=gotMain.length===1&&exactRule(gotMain[0],expectedMain);
    checks.ten_app_bound_checks=checks.active_no_bypass_main &&
      gotMain[0].rules.find(x=>x.type==="required_status_checks").parameters.required_status_checks.length===10;
    checks.immutable_tags=gotTag.length===1&&exactRule(gotTag[0],expectedTag);
    const env=await read(BASE+"/environments/savant-release");
    const branches=await read(BASE+"/environments/savant-release/deployment-branch-policies");
    const noReviewers=Array.isArray(env?.protection_rules)&&
      !env.protection_rules.some(x=>x.type==="required_reviewers");
    checks.solo_environment_main_only=env?.name==="savant-release"&&noReviewers&&
      env.deployment_branch_policy?.custom_branch_policies===true&&
      env.deployment_branch_policy?.protected_branches===false&&
      branches?.total_count===1&&Array.isArray(branches.branch_policies)&&
      branches.branch_policies.length===1&&branches.branch_policies[0]?.name==="main";
    const flag=await read(BASE+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED");
    checks.publication_state_matches_expected=flag?.name==="SAVANT_RELEASE_PUBLISH_ENABLED"&&
      flag.value===(mode==="publish"?"true":"false");
    const profile=await read(BASE+"/actions/variables/SAVANT_RELEASE_GOVERNANCE_PROFILE");
    checks.owner_profile_explicit=profile?.name==="SAVANT_RELEASE_GOVERNANCE_PROFILE"&&
      profile.value===PROFILE;
  }catch {
    // A failed, missing or paginated read cannot be interpreted as a passing policy.
  }
  const problems=Object.entries(checks).filter(([,valid])=>valid!==true).map(([name])=>name);
  return {schema:"savant.owner-governance.audit.v1",profile:PROFILE,
    repository,mode,ready:problems.length===0,checks,problems};
}
export async function applyOwnerGovernancePlan(plan,{read,write,confirmation}={}){
  if(confirmation!==CONFIRM)deny("explicit_owner_confirmation_required");
  if(typeof write!=="function")deny("missing_write_adapter");
  const canonical=assertOwnerGovernancePlan(plan);
  const state=await preflightOwnerGovernance(canonical,read); // All required checks before first write
  let writes=0;
  try{
    for(const operation of canonical.operations){
      if(operation.onMissingOnly==="publication"&&!state.createPublication)continue;
      if(operation.method==="PUT"){
        // GitHub PUT is not create-only; refuse overwriting a concurrently created environment.
        if(await optional(read,operation.path))deny("environment_created_during_apply");
      }
      const out=await write(operation.method,operation.path,operation.body,operation.expected);
      if(out?.status!==operation.expected)deny("administrative_write_not_confirmed");
      writes++;
    }
  }catch{
    // GitHub multi-object ruleset writes are not atomic: never delete/undo protection.
    deny("partial_apply_requires_manual_reconciliation");
  }
  const report=await auditOwnerGovernance(REPOSITORY,read,{
    mode:"audit",expectedMainSha:canonical.expectedMainSha
  });
  if(!report.ready)deny("post_apply_controls_unverified");
  return {state:"owner_controls_verified_publication_disabled",
    mainSha:canonical.expectedMainSha,profile:PROFILE,performedWrites:writes,
    planSha256:canonical.planSha256,ownerAcknowledgementRecorded:true,
    cryptographicOwnerSignatureVerified:false};
}
export function parseOwnerArguments(argv=[]){
  if(!Array.isArray(argv)||![4,6].includes(argv.length)||
    argv[0]!=="--profile=owner_operated"||
    !argv[1]?.startsWith("--owner-id=")||
    !argv[2]?.startsWith("--main-sha=")||
    argv[3]!=="--acknowledge="+ACK||
    (argv.length===6&&(argv[4]!=="--apply"||argv[5]!=="--confirm="+CONFIRM)))
    deny("explicit_solo_owner_selection_required");
  const operatorId=argv[1].slice("--owner-id=".length);
  const mainSha=argv[2].slice("--main-sha=".length);
  return {mode:argv.length===6?"apply":"plan",operatorId,mainSha,acknowledgement:ACK};
}
export async function executeOwnerBootstrap({
  env=process.env,argv=process.argv.slice(2),fetcher=fetch,adminAdapterFactory
}={}){
  const parsed=parseOwnerArguments(argv);
  const plan=compileOwnerGovernancePlan({
    repository:env.GITHUB_REPOSITORY,operatorId:parsed.operatorId,
    mainSha:parsed.mainSha,acknowledgement:parsed.acknowledgement
  });
  if(parsed.mode==="plan")return {mode:"plan",plan,performedWrites:0};
  // Owner identity is bound to the live authenticated /user response, never an env flag.
  if(typeof adminAdapterFactory!=="function")deny("missing_admin_adapter_factory");
  const request=adminAdapterFactory({token:env.GH_TOKEN,fetcher});
  const result=await applyOwnerGovernancePlan(plan,{
    read:path=>request("GET",path),
    write:(method,path,body,expected)=>request(method,path,body,expected),
    confirmation:CONFIRM
  });
  return {mode:"apply",result,performedWrites:result.performedWrites};
}
