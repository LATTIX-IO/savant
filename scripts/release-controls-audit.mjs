import {fileURLToPath} from "node:url";
import {isDirectCliInvocation} from "./direct-cli-invocation.mjs";

const REPOSITORY = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const CHECK_NAMES = [
  "main_default_branch", "main_protected", "main_review_rules",
  "version_tag_immutable", "environment_reviewers", "self_review_prevented",
  "environment_main_only", "publication_state_matches_expected"
];

export class GovernanceAuditError extends Error {
  constructor(code) { super(code); this.name = "GovernanceAuditError"; this.code = code; }
}
function fail(code) { throw new GovernanceAuditError(code); }
export function assertRepository(repository) {
  if (typeof repository !== "string" || repository.length > 140 || !REPOSITORY.test(repository) ||
      repository.split("/").some(value => value === "." || value === ".."))
    fail("invalid_repository");
  return repository;
}
function parseRulesets(value) {
  if (!Array.isArray(value) || value.length > 250 || !value.every(rule =>
    rule && Number.isSafeInteger(rule.id) && rule.id > 0 && rule.target && rule.enforcement)) fail("malformed_rulesets");
  return value;
}
export function evaluateRulesets(branch, rulesets) {
  if (!branch || branch.name !== "main" || branch.protected !== true) fail("main_not_protected");
  const ruleList = parseRulesets(rulesets);
  const matches = (rule, ref) => {
    const include = rule.conditions?.ref_name?.include;
    const exclude = rule.conditions?.ref_name?.exclude;
    if (!Array.isArray(include) || !Array.isArray(exclude)) return false;
    if (exclude.length) return false; // Cannot safely infer precedence of exclusions
    const candidates = ref === "branch" ? ["refs/heads/main","~DEFAULT_BRANCH"] :
      ["refs/tags/v*","refs/tags/v*.*.*"];
    return include.some(pattern => candidates.includes(pattern));
  };
  const active = ruleList.filter(r => r.enforcement === "active" && Array.isArray(r.rules));
  const main = active.filter(r => r.target === "branch" && matches(r,"branch"));
  const tags = active.filter(r => r.target === "tag" && matches(r,"tag"));
  const noBypasses = r => Array.isArray(r.bypass_actors) && r.bypass_actors.length === 0;
  const mainSafe = main.filter(noBypasses);
  const tagSafe = tags.filter(noBypasses);
  const pullRequests = mainSafe.flatMap(r=>r.rules).find(r=>r.type==="pull_request");
  const checks = mainSafe.flatMap(r=>r.rules).find(r=>r.type==="required_status_checks");
  const branchReviewed = Number.isSafeInteger(pullRequests?.parameters?.required_approving_review_count) &&
    pullRequests.parameters.required_approving_review_count >= 1;
  const statusChecks = Array.isArray(checks?.parameters?.required_status_checks) &&
    checks.parameters.required_status_checks.length > 0 &&
    checks.parameters.required_status_checks.every(s=>typeof s?.context==="string" && s.context.length>0);
  const tagTypes = new Set(tagSafe.flatMap(r => r.rules.map(x=>x?.type)));
  return {
    main_review_rules: branchReviewed && statusChecks,
    version_tag_immutable: tagTypes.has("deletion") && tagTypes.has("update"),
  };
}
export function evaluateEnvironment(environment, policies) {
  if (!environment || environment.name !== "savant-release" ||
      !Array.isArray(environment.protection_rules)) fail("invalid_release_environment");
  const review = environment.protection_rules.find(r => r.type === "required_reviewers");
  const reviewers = review?.reviewers;
  const independent = Array.isArray(reviewers) && reviewers.length > 0 &&
    reviewers.every(r => Number.isSafeInteger(r?.reviewer?.id) &&
      (r.type === "User" || r.type === "Team"));
  const policy = environment.deployment_branch_policy;
  const mainOnly = policy?.custom_branch_policies === true &&
    policy?.protected_branches === false &&
    Array.isArray(policies?.branch_policies) && policies.total_count === 1 &&
    policies.branch_policies.length === 1 && policies.branch_policies[0]?.name === "main";
  return {
    environment_reviewers: Boolean(independent),
    self_review_prevented: review?.prevent_self_review === true || environment.prevent_self_review === true,
    environment_main_only: mainOnly,
  };
}
/** Returns only predeclared boolean control results, never raw policy objects or actor details. */
export async function auditGovernance(repository, read, {mode="audit"}={}) {
  if(mode!=="audit" && mode!=="publish")fail("invalid_governance_mode");
  assertRepository(repository);
  if (typeof read !== "function") fail("missing_read_adapter");
  const base="/repos/"+repository;
  const checks=Object.fromEntries(CHECK_NAMES.map(name=>[name,false]));
  const problems=[];
  // Deliberately serial: neither credential scopes nor partial evidence can pass accidentally.
  async function get(path) {
    try { return await read(path); }
    catch { fail("governance_evidence_unavailable"); }
  }
  try {
    const rep=await get(base);
    checks.main_default_branch=rep?.default_branch==="main";
    const b=await get(base+"/branches/main");
    checks.main_protected=b?.name==="main" && b.protected===true;
    const baseRules=parseRulesets(await get(base+"/rulesets?includes_parents=true&per_page=100"));
    const detailed=[];
    for(const rule of baseRules) detailed.push(await get(base+"/rulesets/"+rule.id));
    const ruleResults=evaluateRulesets(b,detailed);
    Object.assign(checks,ruleResults);
    const environment=await get(base+"/environments/savant-release");
    const branches=await get(base+"/environments/savant-release/deployment-branch-policies");
    Object.assign(checks,evaluateEnvironment(environment,branches));
    const flag=await get(base+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED");
    checks.publication_state_matches_expected=flag?.name==="SAVANT_RELEASE_PUBLISH_ENABLED" &&
      flag?.value===(mode==="publish"?"true":"false");
  } catch (e) {
    if (e instanceof GovernanceAuditError) problems.push(e.code);
    else problems.push("malformed_governance_evidence");
  }
  for(const [name,ok] of Object.entries(checks)){if(ok!==true)problems.push(name);}
  return {schema:"savant.release-controls.audit.v2",repository,mode,ready:problems.length===0,checks,problems:[...new Set(problems)]};
}
export function makeGitHubReader({token,fetcher=fetch,timeoutMs=15000}={}){
  if(typeof token!=="string"||token.trim().length<10||token.includes("\n"))fail("missing_read_token");
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)fail("invalid_timeout");
  return async(path)=>{
    if(typeof path!=="string"||!/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.?=&/-]+)?$/.test(path) ||
      path.split("?")[0].split("/").some(segment=>segment==="."||segment===".."))fail("invalid_api_path");
    let response;
    try { response=await fetcher("https://api.github.com"+path,{
      method:"GET",redirect:"error",cache:"no-store",
      headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
        "X-GitHub-Api-Version":"2022-11-28"},
      signal:AbortSignal.timeout(timeoutMs)
    });}catch{fail("github_read_unavailable");}
    if(response.status!==200)fail("github_read_unavailable");
    if(/rel="next"/.test(response.headers?.get("link")||""))fail("paginated_governance_evidence");
    let raw;
    try {raw=await response.text();}catch{fail("github_read_unavailable");}
    if(raw.length>1024*1024)fail("oversized_governance_response");
    try{return JSON.parse(raw);}catch{fail("invalid_governance_response");}
  };
}
export async function runGovernanceAudit(env=process.env,{fetcher=fetch}={}) {
  const repository=assertRepository(env.GITHUB_REPOSITORY);
  const reader=makeGitHubReader({token:env.GH_TOKEN,fetcher});
  const profile=env.SAVANT_RELEASE_GOVERNANCE_PROFILE||"independent_reviewer";
  if(profile==="owner_operated"){
    const {auditOwnerGovernance}=await import("./owner-operated-governance.mjs");
    return auditOwnerGovernance(repository,reader,{mode:env.SAVANT_GOVERNANCE_MODE??"audit"});
  }
  if(profile!=="independent_reviewer")fail("unknown_release_governance_profile");
  return auditGovernance(repository,reader,{mode:env.SAVANT_GOVERNANCE_MODE??"audit"});
}
if (isDirectCliInvocation(process.argv[1],fileURLToPath(import.meta.url))){
  let report;
  try { report=await runGovernanceAudit(); }
  catch(e) {
    report={schema:"savant.release-controls.audit.v2",ready:false,problems:[
      e instanceof GovernanceAuditError?e.code:"audit_failed"
    ],checks:{}};
  }
  const output=JSON.stringify(report,null,2)+"\n";
  console.log(output);
  if(!report.ready)process.exitCode=1;
}
