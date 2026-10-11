import { auditGovernance } from "./release-controls-audit.mjs";

// This operator tool is deliberately restricted to Savant and cannot publish.
// Live repository modification requires --apply plus exact confirmation.
const REPOSITORY = "LATTIX-IO/savant";
const SHA = /^[a-f0-9]{40}$/;
const INT = /^[1-9][0-9]{0,14}$/;
const MAX_RESPONSE = 1024 * 1024;
const ACTIONS_APP_ID = 15368; // GitHub Actions App; required status checks must be source-bound.
const API = "https://api.github.com";
const REQUIRED = Object.freeze([
  "Savant unit, type, lint, build and secrets",
  "Workflow schema migration and tenant integrity",
  "Security checks",
  "Code quality and tests",
  "validate-submodule-pointers",
  "Build installer linux-amd64",
  "Build installer windows-amd64",
  "Build installer macos-amd64",
  "Build installer macos-arm64",
]);
export const REQUIRED_RELEASE_CHECKS = REQUIRED;
export class BootstrapError extends Error {
  constructor(code, status=0) { super(code); this.name="BootstrapError"; this.code=code; this.status=status; }
}
function fail(code) { throw new BootstrapError(code); }
function reviewer(input) {
  if (typeof input!=="string" || !INT.test(input) || !Number.isSafeInteger(Number(input))) fail("invalid_actor_id");
  return Number(input);
}
export function compileGovernancePlan({repository=REPOSITORY,reviewerId,operatorId,reviewerType="User"}={}) {
  if(repository!==REPOSITORY)fail("repository_out_of_scope");
  const admin=reviewer(operatorId), approver=reviewer(reviewerId);
  if(approver===admin)fail("independent_reviewer_required");
  if(!["User","Team"].includes(reviewerType))fail("invalid_reviewer_type");
  const base="/repos/"+REPOSITORY;
  const main={
    name:"savant-protected-main-v1",target:"branch",enforcement:"active",bypass_actors:[],
    conditions:{ref_name:{include:["refs/heads/main"],exclude:[]}},
    rules:[
      {type:"non_fast_forward"},
      {type:"pull_request",parameters:{
        allowed_merge_methods:["squash"],dismiss_stale_reviews_on_push:true,
        require_code_owner_review:false,require_last_push_approval:true,
        required_approving_review_count:1,required_review_thread_resolution:true
      }},
      {type:"required_status_checks",parameters:{
        required_status_checks:REQUIRED.map(context=>({context,integration_id:ACTIONS_APP_ID})),
        strict_required_status_checks_policy:true
      }}
    ]
  };
  const tags={
    name:"savant-immutable-release-tags-v1",target:"tag",enforcement:"active",bypass_actors:[],
    conditions:{ref_name:{include:["refs/tags/v*"],exclude:[]}},
    rules:[{type:"deletion"},{type:"update",parameters:{update_allows_fetch_and_merge:false}}]
  };
  const environment={
    wait_timer:0,prevent_self_review:true,
    reviewers:[{type:reviewerType,id:approver}],
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}
  };
  return {
    schema:"savant.github-governance-bootstrap.v1",
    repository:REPOSITORY, publicationEnabled:false, operatorId:admin, reviewerType,
    // Deliberately do not log reviewer IDs when applying; plan output is administrator-only.
    reviewerId:approver,
    operations:[
      {method:"POST",path:base+"/actions/variables",body:{name:"SAVANT_RELEASE_PUBLISH_ENABLED",value:"false"},onMissingOnly:true},
      {method:"POST",path:base+"/rulesets",body:main,expected:201},
      {method:"POST",path:base+"/rulesets",body:tags,expected:201},
      {method:"PUT",path:base+"/environments/savant-release",body:environment,expected:200},
      {method:"POST",path:base+"/environments/savant-release/deployment-branch-policies",
        body:{name:"main",type:"branch"},expected:200}
    ]
  };
}
export function assertCanonicalPlan(plan) {
  if (!plan || typeof plan !== "object" || plan.schema !== "savant.github-governance-bootstrap.v1") fail("invalid_bootstrap_plan");
  const canonical=compileGovernancePlan({
    repository:plan.repository,
    reviewerId:String(plan.reviewerId),
    operatorId:String(plan.operatorId),
    reviewerType:plan.reviewerType
  });
  if(JSON.stringify(plan.operations)!==JSON.stringify(canonical.operations) ||
     plan.publicationEnabled!==false || plan.repository!==REPOSITORY)fail("modified_bootstrap_plan");
  return canonical;
}

export function validateApproval(argv=[]) {
  if(argv.length===0)return "plan";
  if(argv.length===2 && argv[0]==="--apply" && argv[1]==="--confirm=PROTECT-LATTIX-IO-savant")return "apply";
  fail("explicit_operator_approval_required");
}
export async function preflight(plan,read) {
  assertCanonicalPlan(plan);
  if(typeof read!=="function" || plan?.repository!==REPOSITORY)fail("invalid_preflight");
  const base="/repos/"+REPOSITORY;
  if(plan.reviewerType==="Team")fail("team_reviewer_membership_unverified");
  const caller=await read("/user");
  if(caller?.id!==plan.operatorId || typeof caller?.login!=="string" || !caller.login)
    fail("operator_identity_mismatch");
  const rep=await read(base);
  if(rep?.default_branch!=="main" || rep?.full_name!==REPOSITORY)fail("wrong_repository_baseline");
  const branch=await read(base+"/branches/main");
  const sha=branch?.commit?.sha;
  if(branch?.name!=="main" || branch?.protected===true || !SHA.test(sha||""))fail("existing_branch_policy_or_invalid_sha");
  const existing=await read(base+"/rulesets?includes_parents=true&per_page=100");
  if(!Array.isArray(existing) || existing.length!==0)fail("existing_ruleset_requires_manual_reconciliation");
  const runs=await read(base+"/commits/"+sha+"/check-runs?per_page=100");
  if(!Array.isArray(runs?.check_runs) || !Number.isSafeInteger(runs.total_count) ||
    runs.total_count!==runs.check_runs.length)fail("incomplete_ci_evidence");
  for(const context of REQUIRED){
    if(!runs.check_runs.some(c=>c.name===context && c.status==="completed" &&
      c.conclusion==="success" && c.app?.id===ACTIONS_APP_ID && c.app?.slug==="github-actions"))
      fail("required_ci_context_unverified");
  }
  let flag=null, environment=null;
  try{flag=await read(base+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED");}
  catch(e){if(e?.status!==404)throw e;}
  if(flag && (flag.name!=="SAVANT_RELEASE_PUBLISH_ENABLED" || flag.value!=="false"))
    fail("publication_flag_not_disabled");
  try{environment=await read(base+"/environments/savant-release");}
  catch(e){if(e?.status!==404)throw e;}
  if(environment!==null)fail("existing_environment_requires_manual_reconciliation");
  return {mainSha:sha,createVariable:flag===null};
}
export async function verifyBootstrappedControls(plan, read) {
  const desired=assertCanonicalPlan(plan);
  const base="/repos/"+REPOSITORY;
  const summaries=await read(base+"/rulesets?includes_parents=true&per_page=100");
  if(!Array.isArray(summaries))fail("post_apply_control_drift");
  const details=[];
  for(const summary of summaries){
    if(!Number.isSafeInteger(summary?.id)||summary.id<1)fail("post_apply_control_drift");
    details.push(await read(base+"/rulesets/"+summary.id));
  }
  for(const operation of desired.operations.filter(o=>o.path.endsWith("/rulesets"))){
    const expected=operation.body;
    const matches=details.filter(d=>d.name===expected.name && d.target===expected.target);
    if(matches.length!==1)fail("post_apply_control_drift");
    const actual=matches[0];
    if(actual.enforcement!=="active" || !Array.isArray(actual.bypass_actors) || actual.bypass_actors.length ||
       JSON.stringify(actual.conditions?.ref_name)!==JSON.stringify(expected.conditions.ref_name))
      fail("post_apply_control_drift");
    const actualRules=new Map(actual.rules?.map(r=>[r.type,r])||[]);
    for(const rule of expected.rules){
      const live=actualRules.get(rule.type);
      if(!live)fail("post_apply_control_drift");
      if(rule.type==="required_status_checks"){
        const required=live.parameters?.required_status_checks;
        if(live.parameters?.strict_required_status_checks_policy!==true ||
           !Array.isArray(required) || !REQUIRED.every(context=>required.some(entry=>
             entry.context===context && entry.integration_id===ACTIONS_APP_ID)))
          fail("post_apply_control_drift");
      }else if(rule.type==="pull_request"){
        if(live.parameters?.required_approving_review_count<1 ||
           live.parameters?.dismiss_stale_reviews_on_push!==true ||
           live.parameters?.require_last_push_approval!==true ||
           live.parameters?.required_review_thread_resolution!==true)
          fail("post_apply_control_drift");
      }
    }
  }
  const environment=await read(base+"/environments/savant-release");
  const reviews=environment?.protection_rules?.find(r=>r.type==="required_reviewers");
  if(reviews?.prevent_self_review!==true ||
     !Array.isArray(reviews.reviewers) ||
     !reviews.reviewers.some(r=>r.type===desired.reviewerType && r.reviewer?.id===desired.reviewerId))
    fail("post_apply_control_drift");
  return true;
}

export async function applyGovernancePlan(plan, {read,write,confirmation}={}) {
  if(confirmation!=="PROTECT-LATTIX-IO-savant")fail("explicit_operator_approval_required");
  if(typeof write!=="function")fail("missing_write_adapter");
  const canonical=assertCanonicalPlan(plan);
  const prior=await preflight(canonical,read); // zero writes before all checks
  let created=0;
  try {
    for(const operation of canonical.operations){
      if(operation.onMissingOnly && !prior.createVariable)continue;
      const result=await write(operation.method,operation.path,operation.body,operation.expected??201);
      if(!result || result.status!==(operation.expected??201))fail("administrative_write_not_confirmed");
      created++;
    }
  } catch {
    // Fail closed: never delete active security rules or claim automatic rollback.
    throw new BootstrapError("partial_apply_requires_manual_reconciliation");
  }
  const outcome=await auditGovernance(REPOSITORY,read,{mode:"audit"});
  if(outcome.ready!==true)fail("post_apply_security_audit_failed");
  await verifyBootstrappedControls(canonical,read);
  return {state:"controls_verified_publication_disabled",created,mainSha:prior.mainSha};
}
export function makeAdminAdapter({token,fetcher=fetch}={}) {
  if(typeof token!=="string" || token.trim().length<10 || /[\r\n]/.test(token))fail("missing_admin_token");
  return async(method,path,body,expected)=>{
    if(!["GET","POST","PUT"].includes(method)||typeof path!=="string"||
      (!(method==="GET"&&path==="/user") && !/^\/repos\/LATTIX-IO\/savant(?:\/[A-Za-z0-9_./?=&-]+)?$/.test(path))||
      path.split("?")[0].split("/").some(s=>s==="."||s===".."))fail("invalid_admin_request");
    const mutations={
      "POST /repos/LATTIX-IO/savant/actions/variables":201,
      "POST /repos/LATTIX-IO/savant/rulesets":201,
      "PUT /repos/LATTIX-IO/savant/environments/savant-release":200,
      "POST /repos/LATTIX-IO/savant/environments/savant-release/deployment-branch-policies":200
    };
    if(method!=="GET" && (!body||typeof body!=="object"||
        mutations[method+" "+path]!==expected))fail("invalid_admin_mutation");
    let response;
    try{response=await fetcher(API+path,{
      method,redirect:"error",cache:"no-store",
      headers:{"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json",
        "X-GitHub-Api-Version":"2026-03-10",...(method==="GET"?{}:{"Content-Type":"application/json"})},
      ...(method==="GET"?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(15000)
    });}catch{fail("github_admin_api_unavailable");}
    if(response.status===404 && method==="GET")throw new BootstrapError("not_found",404);
    if(response.status!==(expected??200))fail("github_admin_api_rejected");
    if(/rel="next"/.test(response.headers?.get("link")||""))fail("paginated_admin_evidence");
    if(method!=="GET")return {status:response.status};
    let raw;
    try{raw=await response.text();}catch{fail("github_admin_api_unavailable");}
    if(raw.length>MAX_RESPONSE)fail("oversized_admin_response");
    try{return JSON.parse(raw);}catch{fail("malformed_admin_response");}
  };
}
export async function executeBootstrap({env=process.env,argv=process.argv.slice(2),fetcher=fetch}={}) {
  const mode=validateApproval(argv);
  const plan=compileGovernancePlan({
    repository:env.GITHUB_REPOSITORY,reviewerId:env.SAVANT_RELEASE_REVIEWER_ID,
    operatorId:env.SAVANT_RELEASE_OPERATOR_ID,reviewerType:env.SAVANT_RELEASE_REVIEWER_TYPE||"User"
  });
  if(mode==="plan")return {mode,plan,performedWrites:0};
  const request=makeAdminAdapter({token:env.GH_TOKEN,fetcher});
  const result=await applyGovernancePlan(plan,{
    read:path=>request("GET",path),
    write:(method,path,body,expected)=>request(method,path,body,expected),
    confirmation:"PROTECT-LATTIX-IO-savant"
  });
  return {mode,performedWrites:result.created,result};
}
if(process.argv[1]?.endsWith("/release-governance-bootstrap.mjs")){
  try{
    const result=await executeBootstrap();
    // Never serialize reviewer IDs, tokens, policy bodies, or full API responses in apply logs.
    if(result.mode==="plan")console.log(JSON.stringify(result.plan,null,2));
    else console.log(JSON.stringify({mode:"apply",...result.result}));
  }catch(e){
    console.error(JSON.stringify({ready:false,code:e instanceof BootstrapError?e.code:"governance_bootstrap_failed"}));
    process.exitCode=1;
  }
}
