import {auditGovernance} from "./release-controls-audit.mjs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {REQUIRED_RELEASE_CHECKS,makeAdminAdapter} from "./release-governance-bootstrap.mjs";

const REPOSITORY="LATTIX-IO/savant";
const BASE="/repos/"+REPOSITORY;
const APP_ID=15368;
const SHA=/^[a-f0-9]{40}$/;
const NUM=/^[1-9][0-9]{0,14}$/;
const RULE_NAME="savant-protected-main-v1";
const REQUIRED_AUDIT="Blocking production dependency audit (high/critical)";
const CONFIRM="ENFORCE-SAVANT-DEPENDENCY-AUDIT";
const REQUIRED=[...REQUIRED_RELEASE_CHECKS,REQUIRED_AUDIT];
const RULES=BASE+"/rulesets?includes_parents=true&per_page=100";
export const REQUIRED_POST_UPGRADE_CHECKS=Object.freeze(REQUIRED);
export const REQUIRED_DEPENDENCY_AUDIT_CONTEXT=REQUIRED_AUDIT;

export class GovernanceUpgradeError extends Error{
  constructor(code){super(code);this.name="GovernanceUpgradeError";this.code=code;}
}
function fail(code){throw new GovernanceUpgradeError(code);}
const safeId=x=>typeof x==="number"&&Number.isSafeInteger(x)&&x>0;
const isId=x=>typeof x==="string"&&NUM.test(x)&&Number.isSafeInteger(Number(x));
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function inspectRule(rule){
  if(!rule||rule.name!==RULE_NAME||rule.target!=="branch"||
    rule.enforcement!=="active"||!Array.isArray(rule.bypass_actors)||
    rule.bypass_actors.length!==0||
    !eq(rule.conditions?.ref_name,{include:["refs/heads/main"],exclude:[]})||
    !Array.isArray(rule.rules)||rule.rules.length!==3)
    fail("unexpected_existing_governance");
  const byType=new Map(rule.rules.map(x=>[x?.type,x]));
  if(byType.size!==3||!["non_fast_forward","pull_request","required_status_checks"].every(k=>byType.has(k)))
    fail("unexpected_existing_governance");
  const pr=byType.get("pull_request")?.parameters;
  if(!eq(pr?.allowed_merge_methods,["squash"])||
    pr?.required_approving_review_count!==1||
    pr?.dismiss_stale_reviews_on_push!==true||
    pr?.require_last_push_approval!==true||
    pr?.required_review_thread_resolution!==true)
    fail("unexpected_existing_governance");
  const checks=byType.get("required_status_checks")?.parameters;
  if(checks?.strict_required_status_checks_policy!==true||
    !Array.isArray(checks?.required_status_checks))fail("unexpected_existing_governance");
  const entries=checks.required_status_checks;
  const match=list=>entries.length===list.length &&
    entries.every(x=>x&&typeof x.context==="string"&&x.integration_id===APP_ID) &&
    new Set(entries.map(x=>x.context)).size===entries.length &&
    list.every(name=>entries.some(x=>x.context===name));
  if(match(REQUIRED))return {alreadyApplied:true,original:rule};
  if(!match(REQUIRED_RELEASE_CHECKS))fail("unexpected_existing_governance");
  return {alreadyApplied:false,original:rule};
}
function upgradedRule(rule){
  const rules=rule.rules.map(x=>x.type==="required_status_checks"?{
    ...x,parameters:{...x.parameters,required_status_checks:[
      ...x.parameters.required_status_checks,
      {context:REQUIRED_AUDIT,integration_id:APP_ID}
    ]}
  }:x);
  return {
    name:rule.name,target:rule.target,enforcement:rule.enforcement,
    bypass_actors:rule.bypass_actors,conditions:rule.conditions,rules
  };
}
function requireActor(operatorId){
  if(!isId(operatorId))fail("invalid_operator_identity");
  return Number(operatorId);
}
/** Enforced two-phase upgrade after approved #95 is already in main.
 * No write path exists until baseline branch/tag/reviewer controls and
 * the new commit's GitHub Actions App evidence have been verified.
 */
export async function preflightAuditUpgrade({
  read,operatorId,expectedMainSha
}={}){
  const actorId=requireActor(operatorId);
  if(typeof read!=="function")fail("missing_read_adapter");
  if(typeof expectedMainSha!=="string"||!SHA.test(expectedMainSha))
    fail("expected_main_sha_required");
  let account,repo,branch,readiness,environment,checks,summaries;
  try{
    account=await read("/user");
    repo=await read(BASE);
    branch=await read(BASE+"/branches/main");
    readiness=await auditGovernance(REPOSITORY,read,{mode:"audit"});
    environment=await read(BASE+"/environments/savant-release");
    checks=await read(BASE+"/commits/"+expectedMainSha+"/check-runs?per_page=100");
    summaries=await read(RULES);
  }catch{fail("governance_evidence_unavailable");}
  if(account?.id!==actorId||typeof account?.login!=="string"||!account.login)
    fail("operator_identity_mismatch");
  if(repo?.default_branch!=="main"||repo?.full_name!==REPOSITORY||
    branch?.name!=="main"||branch?.protected!==true||
    branch?.commit?.sha!==expectedMainSha)
    fail("reviewed_main_commit_mismatch");
  if(readiness?.ready!==true)fail("existing_governance_incomplete");
  const approvers=environment?.protection_rules?.find(x=>x.type==="required_reviewers")?.reviewers;
  if(!Array.isArray(approvers)||!approvers.length||
    approvers.some(x=>!safeId(x?.reviewer?.id)||x.reviewer.id===actorId))
    fail("independent_release_reviewer_required");
  if(!checks||!Number.isSafeInteger(checks.total_count)||
    !Array.isArray(checks.check_runs)||checks.total_count!==checks.check_runs.length||
    checks.total_count>100)
    fail("incomplete_check_run_evidence");
  for(const name of REQUIRED){
    if(!checks.check_runs.some(x=>x.name===name&&x.status==="completed"&&
      x.conclusion==="success"&&x.app?.id===APP_ID&&x.app?.slug==="github-actions"))
      fail("required_check_not_verified");
  }
  if(!Array.isArray(summaries)||summaries.length>100)fail("invalid_ruleset_inventory");
  const all=[];
  try{
    for(const s of summaries){
      if(!safeId(s?.id))fail("invalid_ruleset_inventory");
      all.push(await read(BASE+"/rulesets/"+s.id));
    }
  }catch{fail("governance_evidence_unavailable");}
  const matches=all.filter(x=>x?.name===RULE_NAME&&x.target==="branch");
  if(matches.length!==1||!safeId(matches[0]?.id))
    fail("expected_main_ruleset_not_unique");
  const original=matches[0],inspection=inspectRule(original);
  return {
    rulesetId:original.id,mainSha:expectedMainSha,
    alreadyApplied:inspection.alreadyApplied,
    snapshot:JSON.stringify(original),
    required:REQUIRED.length,
  };
}
export function validateUpgradeArgs(argv=[]){
  if(!Array.isArray(argv))fail("explicit_confirmation_required");
  if(argv.length===0)return "plan";
  if(argv.length===2&&argv[0]==="--apply"&&argv[1]==="--confirm="+CONFIRM)return "apply";
  fail("explicit_confirmation_required");
}
export async function applyAuditUpgrade({
  read,write,operatorId,expectedMainSha,confirmation
}={}){
  if(confirmation!==CONFIRM)fail("explicit_confirmation_required");
  if(typeof write!=="function")fail("missing_admin_write");
  const before=await preflightAuditUpgrade({read,operatorId,expectedMainSha});
  if(before.alreadyApplied)return {state:"already_verified",writes:0,mainSha:before.mainSha};
  const path=BASE+"/rulesets/"+before.rulesetId;
  // Update APIs lack an atomic compare-and-swap. Require the operator to
  // hold an exclusive governance change window; reject any observed drift.
  let branch,current;
  try{
    branch=await read(BASE+"/branches/main");
    current=await read(path);
  }catch{fail("governance_evidence_unavailable");}
  if(branch?.commit?.sha!==before.mainSha||
    JSON.stringify(current)!==before.snapshot)
    fail("concurrent_governance_change");
  const payload=upgradedRule(current);
  let result;
  try{result=await write(path,payload);}
  catch{fail("administrative_write_failed_reconcile");}
  if(!result||result.status!==200)fail("administrative_write_failed_reconcile");
  // Failure after PUT may mean a partial apply. Never delete protection.
  let after;
  try{after=await read(path);}catch{fail("post_update_verification_required");}
  if(!inspectRule(after).alreadyApplied||after.id!==before.rulesetId)
    fail("post_update_verification_required");
  const post=await auditGovernance(REPOSITORY,read,{mode:"audit"});
  if(post.ready!==true)fail("post_update_verification_required");
  return {state:"dependency_audit_required",writes:1,mainSha:before.mainSha};
}
function createAdapter({token,fetcher=fetch}={}){
  const get=makeAdminAdapter({token,fetcher});
  const put=async(path,body)=>{
    if(!new RegExp("^"+BASE+"/rulesets/[1-9][0-9]*$").test(path)||
       !body||typeof body!=="object"||body.name!==RULE_NAME||
       body.target!=="branch"||body.enforcement!=="active"||
       !eq(body.bypass_actors,[])||!eq(body.conditions?.ref_name,
         {include:["refs/heads/main"],exclude:[]}))
      fail("invalid_admin_mutation");
    let response;
    try{response=await fetcher("https://api.github.com"+path,{
      method:"PUT",redirect:"error",cache:"no-store",
      headers:{
        Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
        "X-GitHub-Api-Version":"2026-03-10","Content-Type":"application/json"
      },
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
    });}catch{fail("admin_api_unavailable");}
    if(response.status!==200)fail("admin_api_rejected");
    return {status:response.status};
  };
  return {read:path=>get("GET",path),write:put};
}
export async function runAuditUpgrade({
  env=process.env,argv=process.argv.slice(2),fetcher=fetch
}={}){
  const mode=validateUpgradeArgs(argv);
  if(env.GITHUB_REPOSITORY!==REPOSITORY)fail("repository_out_of_scope");
  const {read,write}=createAdapter({token:env.GH_TOKEN,fetcher});
  const args={
    read,operatorId:env.SAVANT_RELEASE_OPERATOR_ID,
    expectedMainSha:env.SAVANT_RELEASE_MAIN_SHA
  };
  const result=mode==="plan"?
    await preflightAuditUpgrade(args):
    await applyAuditUpgrade({...args,write,confirmation:CONFIRM});
  return {mode,...(mode==="plan"?{
    state:result.alreadyApplied?"already_verified":"eligible_for_upgrade",
    mainSha:result.mainSha,required:result.required,writes:0
  }:result)};
}
// Compare the actual entry file, not a Unix slash-only suffix: PowerShell
// otherwise silently skips --apply without checking operator identity.
const calledFile=process.argv[1]?resolve(process.argv[1]):null;
const moduleFile=fileURLToPath(import.meta.url);
const entrypoint=calledFile!==null&&
  (process.platform==="win32"?
    calledFile.toLowerCase()===moduleFile.toLowerCase():calledFile===moduleFile);
if(entrypoint){
  try{console.log(JSON.stringify(await runAuditUpgrade()));}
  catch(e){
    console.error(JSON.stringify({ready:false,
      code:e instanceof GovernanceUpgradeError?e.code:"governance_upgrade_failed"}));
    process.exitCode=1;
  }
}
