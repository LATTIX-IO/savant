import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
 OWNER_REQUIRED_CHECKS,OWNER_PROFILE,OWNER_CONFIRMATION,
 OwnerGovernanceError,compileOwnerGovernancePlan,assertOwnerGovernancePlan,
 preflightOwnerGovernance,auditOwnerGovernance,applyOwnerGovernancePlan,
 parseOwnerArguments,executeOwnerBootstrap
} from "./owner-operated-governance.mjs";
import {executeBootstrap} from "./release-governance-bootstrap.mjs";
import {auditGovernance,runGovernanceAudit} from "./release-controls-audit.mjs";
import {runAuditUpgrade} from "./release-governance-upgrade.mjs";

const REPO="LATTIX-IO/savant",BASE="/repos/"+REPO,SHA="a".repeat(40);
const ownerId="300",ACK="SOLE-OWNER-CI-ENFORCED";
const input={repository:REPO,operatorId:ownerId,mainSha:SHA,acknowledgement:ACK};
const build=()=>compileOwnerGovernancePlan(input);
const cli=[
 "--profile=owner_operated","--owner-id="+ownerId,
 "--main-sha="+SHA,"--acknowledge="+ACK
];
function fixture(){
 const state={
  owner:300,sha:SHA,protected:false,publication:null,profile:null,
  environment:null,branchPolicies:null,rulesets:[],writes:[],
  checkRuns:OWNER_REQUIRED_CHECKS.map(name=>({
   name,status:"completed",conclusion:"success",app:{id:15368,slug:"github-actions"}
  }))
 };
 async function read(path){
  if(path==="/user")return {id:state.owner,login:"sole-maintainer"};
  if(path===BASE)return {full_name:REPO,default_branch:"main"};
  if(path===BASE+"/branches/main")
    return {name:"main",protected:state.protected,commit:{sha:state.sha}};
  if(path===BASE+"/commits/"+SHA+"/check-runs?per_page=100")
    return {total_count:state.checkRuns.length,check_runs:state.checkRuns};
  if(path===BASE+"/rulesets?includes_parents=true&per_page=100")
    return state.rulesets.map(({id,target,enforcement})=>({id,target,enforcement}));
  const rule=path.match(new RegExp("^"+BASE+"/rulesets/(\\d+)$"));
  if(rule){
    const match=state.rulesets.find(x=>x.id===Number(rule[1]));
    if(!match)throw new OwnerGovernanceError("not_found",404);
    return structuredClone(match);
  }
  if(path===BASE+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED"){
    if(state.publication===null)throw new OwnerGovernanceError("not_found",404);
    return {name:"SAVANT_RELEASE_PUBLISH_ENABLED",value:state.publication};
  }
  if(path===BASE+"/actions/variables/SAVANT_RELEASE_GOVERNANCE_PROFILE"){
    if(state.profile===null)throw new OwnerGovernanceError("not_found",404);
    return {name:"SAVANT_RELEASE_GOVERNANCE_PROFILE",value:state.profile};
  }
  if(path===BASE+"/environments/savant-release"){
    if(state.environment===null)throw new OwnerGovernanceError("not_found",404);
    return structuredClone(state.environment);
  }
  if(path===BASE+"/environments/savant-release/deployment-branch-policies"){
    if(!state.branchPolicies)throw new OwnerGovernanceError("not_found",404);
    return structuredClone(state.branchPolicies);
  }
  throw new Error("unrecognized_test_endpoint");
 }
 async function write(method,path,body,expected){
  state.writes.push({method,path,body:structuredClone(body),expected});
  if(method==="POST"&&path===BASE+"/actions/variables"){
    if(body.name==="SAVANT_RELEASE_PUBLISH_ENABLED")state.publication=body.value;
    else if(body.name==="SAVANT_RELEASE_GOVERNANCE_PROFILE")state.profile=body.value;
    else throw new Error("unknown_variable");
    return {status:201};
  }
  if(method==="POST"&&path===BASE+"/rulesets"){
    state.rulesets.push({id:10+state.rulesets.length,...structuredClone(body)});
    if(body.target==="branch")state.protected=true;
    return {status:201};
  }
  if(method==="PUT"&&path===BASE+"/environments/savant-release"){
    state.environment={
      name:"savant-release",protection_rules:[],
      deployment_branch_policy:structuredClone(body.deployment_branch_policy)
    };
    return {status:200};
  }
  if(method==="POST"&&path===BASE+"/environments/savant-release/deployment-branch-policies"){
    state.branchPolicies={total_count:1,branch_policies:[{name:body.name}]};
    return {status:200};
  }
  throw new Error("unexpected_test_write");
 }
 return {state,read,write};
}
const denied=code=>e=>e instanceof OwnerGovernanceError&&e.code===code;

test("PER-1572: exactly 10 App-bound checks, no bypass, zero human reviews, protected tags",()=>{
 const p=build();
 assert.equal(p.schema,"savant.github-owner-governance.v1");
 assert.equal(p.profile,OWNER_PROFILE);
 assert.equal(p.expectedMainSha,SHA);
 assert.equal(p.requiredCheckCount,10);
 assert.equal(p.operations.length,6);
 const main=p.operations[2].body,tag=p.operations[3].body;
 assert.deepEqual(main.bypass_actors,[]);
 assert.deepEqual(main.rules.map(x=>x.type),[
  "deletion","non_fast_forward","pull_request","required_status_checks"
 ]);
 const pr=main.rules.find(x=>x.type==="pull_request").parameters;
 assert.equal(pr.required_approving_review_count,0);
 assert.equal(pr.require_last_push_approval,false);
 assert.equal(pr.required_review_thread_resolution,true);
 assert.deepEqual(pr.allowed_merge_methods,["squash"]);
 const check=main.rules.find(x=>x.type==="required_status_checks").parameters;
 assert.equal(check.strict_required_status_checks_policy,true);
 assert.deepEqual(check.required_status_checks,OWNER_REQUIRED_CHECKS.map(context=>({
  context,integration_id:15368
 })));
 assert.ok(OWNER_REQUIRED_CHECKS.includes("Blocking production dependency audit (high/critical)"));
 assert.deepEqual(tag.bypass_actors,[]);
 assert.deepEqual(tag.rules.map(x=>x.type),["deletion","update"]);
 assert.deepEqual(p.operations[4].body.reviewers,[]);
 assert.equal(p.operations[4].body.prevent_self_review,false);
 assert.equal(p.operations[4].body.deployment_branch_policy.custom_branch_policies,true);
 assert.equal(p.operations[5].body.name,"main");
 assert.equal(p.operations[0].body.value,"false");
 assert.equal(p.operations[1].body.value,OWNER_PROFILE);
 assert.match(p.planSha256,/^[a-f0-9]{64}$/);
 assert.equal(assertOwnerGovernancePlan(p).planSha256,p.planSha256);
});

test("PER-1572: explicit typed owner mode cannot be selected by environment drift or malformed args",async()=>{
 assert.equal(parseOwnerArguments(cli).mode,"plan");
 assert.equal(parseOwnerArguments([...cli,"--apply","--confirm="+OWNER_CONFIRMATION]).mode,"apply");
 for(const args of [
  [],["--profile=owner_operated"],["--profile=independent_reviewer",...cli.slice(1)],
  cli.slice(0,3),[...cli.slice(0,3),"--acknowledge=YES"],
  [...cli,"--apply"],[...cli,"--confirm="+OWNER_CONFIRMATION],
  [...cli,"--apply","--confirm=skip-reviews"]
 ])assert.throws(()=>parseOwnerArguments(args),denied("explicit_solo_owner_selection_required"));
 for(const args of [
  {...input,operatorId:"0"},{...input,operatorId:"003"},
  {...input,mainSha:"a".repeat(39)}, {...input,repository:"attacker/savant"},
  {...input,acknowledgement:"just disable approvals"}
 ])assert.throws(()=>compileOwnerGovernancePlan(args));
 const env={GITHUB_REPOSITORY:REPO,SAVANT_RELEASE_GOVERNANCE_PROFILE:"owner_operated"};
 const r=await executeBootstrap({env,argv:cli});
 assert.equal(r.mode,"plan");
 assert.equal(r.performedWrites,0);
 assert.equal(r.plan.profile,OWNER_PROFILE);
 await assert.rejects(executeBootstrap({env,argv:[...cli,"--apply","--confirm="+OWNER_CONFIRMATION]}),
  denied("missing_admin_token"));
 await assert.rejects(executeBootstrap({env,argv:[]}),/invalid_actor_id/);
});

test("PER-1572: read-only preflight checks actual owner, exact main SHA and all ten verified GitHub Actions contexts",async()=>{
 const f=fixture();
 assert.deepEqual(await preflightOwnerGovernance(build(),f.read),{
  expectedMainSha:SHA,createPublication:true
 });
 assert.equal(f.state.writes.length,0);
 f.state.publication="false";
 assert.equal((await preflightOwnerGovernance(build(),f.read)).createPublication,false);
 const wrongOwner=fixture();wrongOwner.state.owner=301;
 await assert.rejects(preflightOwnerGovernance(build(),wrongOwner.read),denied("owner_identity_mismatch"));
 const stale=fixture();stale.state.sha="b".repeat(40);
 await assert.rejects(preflightOwnerGovernance(build(),stale.read),denied("stale_main_or_existing_protection"));
 const protectedBranch=fixture();protectedBranch.state.protected=true;
 await assert.rejects(preflightOwnerGovernance(build(),protectedBranch.read),denied("stale_main_or_existing_protection"));
 const priorRules=fixture();priorRules.state.rulesets.push({id:5,name:"existing",target:"branch",enforcement:"active"});
 await assert.rejects(preflightOwnerGovernance(build(),priorRules.read),
  denied("existing_rulesets_require_manual_reconciliation"));
 const released=fixture();released.state.publication="true";
 await assert.rejects(preflightOwnerGovernance(build(),released.read),denied("publication_not_disabled"));
 const adopted=fixture();adopted.state.profile=OWNER_PROFILE;
 await assert.rejects(preflightOwnerGovernance(build(),adopted.read),
  denied("existing_profile_requires_manual_reconciliation"));
 const env=fixture();env.state.environment={name:"savant-release"};
 await assert.rejects(preflightOwnerGovernance(build(),env.read),
  denied("existing_environment_requires_manual_reconciliation"));
});

test("PER-1572: tampered, stale, missing, duplicate or spoofed required GitHub Actions evidence fails before write",async()=>{
 for(const mutate of [
  x=>x.checkRuns.pop(),
  x=>x.checkRuns[0].app.id=99,
  x=>x.checkRuns[0].app.slug="attacker",
  x=>x.checkRuns[0].status="in_progress",
  x=>x.checkRuns[0].conclusion="failure",
  x=>x.checkRuns[0].name="unrelated",
  x=>x.checkRuns.push(structuredClone(x.checkRuns[0]))
 ]){
  const f=fixture();mutate(f.state);
  await assert.rejects(preflightOwnerGovernance(build(),f.read),
   denied("required_ci_context_unverified"));
  assert.equal(f.state.writes.length,0);
 }
 const incomplete=fixture();
 const original=incomplete.read;
 await assert.rejects(preflightOwnerGovernance(build(),async path=>{
  const result=await original(path);
  if(path.includes("check-runs?"))result.total_count++;
  return result;
 }),denied("incomplete_ci_evidence"));
});

test("PER-1572: canonical plan fingerprint and operations cannot be forged to enable release, reviewers or bypasses",()=>{
 const p=build();
 const changes=[
  x=>x.operations[0].body.value="true",
  x=>x.operations[2].body.rules[2].parameters.required_approving_review_count=1,
  x=>x.operations[2].body.bypass_actors.push({actor_id:1,bypass_mode:"always"}),
  x=>x.operations[2].body.rules[3].parameters.required_status_checks.pop(),
  x=>x.operations[3].body.rules.pop(),
  x=>x.operations[4].body.reviewers.push({type:"User",id:300}),
  x=>x.operations[5].body.name="*",
  x=>x.planSha256="0".repeat(64),
  x=>x.expectedMainSha="b".repeat(40),
  x=>x.profile="independent_reviewer",
  x=>x.operations.push({method:"DELETE",path:"/repos/evil",body:{}})
 ];
 for(const change of changes){
  const data=structuredClone(p);change(data);
  assert.throws(()=>assertOwnerGovernancePlan(data),OwnerGovernanceError);
 }
 assert.deepEqual(assertOwnerGovernancePlan(p),p);
});

test("PER-1572: apply performs six scoped writes, verifies live readback, publication off",async()=>{
 const f=fixture();
 await assert.rejects(applyOwnerGovernancePlan(build(),{
  read:f.read,write:f.write,confirmation:"anything"
 }),denied("explicit_owner_confirmation_required"));
 assert.equal(f.state.writes.length,0);
 const out=await applyOwnerGovernancePlan(build(),{
  read:f.read,write:f.write,confirmation:OWNER_CONFIRMATION
 });
 assert.equal(out.state,"owner_controls_verified_publication_disabled");
 assert.equal(out.performedWrites,6);
 assert.equal(out.cryptographicOwnerSignatureVerified,false);
 assert.equal(out.planSha256,build().planSha256);
 assert.equal(f.state.writes.length,6);
 assert.equal(f.state.publication,"false");
 assert.equal(f.state.profile,OWNER_PROFILE);
 assert.equal(f.state.environment.protection_rules.length,0);
 assert.equal(f.state.branchPolicies.branch_policies[0].name,"main");
 const report=await auditOwnerGovernance(REPO,f.read,{expectedMainSha:SHA});
 assert.equal(report.ready,true,JSON.stringify(report.problems));
 assert.equal(report.profile,OWNER_PROFILE);
 assert.doesNotMatch(JSON.stringify(report),/sole-maintainer|Bearer|private.key/i);
 const again=await auditOwnerGovernance(REPO,f.read,{mode:"publish"});
 assert.equal(again.ready,false);
 assert.ok(again.problems.includes("publication_state_matches_expected"));
 // A prior, legitimate disabled publication variable does not get overwritten.
 const existing=fixture();existing.state.publication="false";
 const result=await applyOwnerGovernancePlan(build(),{
  read:existing.read,write:existing.write,confirmation:OWNER_CONFIRMATION
 });
 assert.equal(result.performedWrites,5);
});

test("PER-1572: strict live audit rejects policy relaxation, foreign actor, missing release gate and drift",async()=>{
 const f=fixture();
 await applyOwnerGovernancePlan(build(),{read:f.read,write:f.write,confirmation:OWNER_CONFIRMATION});
 for(const mutate of [
  x=>x.rulesets[0].bypass_actors.push({actor_id:5}),
  x=>x.rulesets[0].rules.find(r=>r.type==="pull_request").parameters.required_approving_review_count=1,
  x=>x.rulesets[0].rules.find(r=>r.type==="pull_request").parameters.require_last_push_approval=true,
  x=>x.rulesets[0].rules.find(r=>r.type==="required_status_checks").parameters.strict_required_status_checks_policy=false,
  x=>x.rulesets[0].rules.find(r=>r.type==="required_status_checks").parameters.required_status_checks[0].integration_id=999,
  x=>x.rulesets[0].rules=x.rulesets[0].rules.filter(r=>r.type!=="deletion"),
  x=>x.rulesets[1].rules=x.rulesets[1].rules.filter(r=>r.type!=="update"),
  x=>x.rulesets[1].conditions.ref_name.exclude=["refs/tags/v1"],
  x=>x.branchPolicies.branch_policies.push({name:"dev"}),
  x=>x.environment.protection_rules.push({type:"required_reviewers",reviewers:[{id:301}]}),
  x=>x.profile="independent_reviewer",
  x=>x.publication="true",
  x=>x.protected=false,
  x=>x.sha="b".repeat(40)
 ]){
  const snapshot=structuredClone(f.state);mutate(f.state);
  const report=await auditOwnerGovernance(REPO,f.read,{expectedMainSha:SHA});
  assert.equal(report.ready,false);
  assert.ok(report.problems.length>0);
  Object.assign(f.state,snapshot);
 }
 const old=await auditGovernance(REPO,f.read);
 assert.equal(old.ready,false,"legacy independent-reviewer audit must NOT silently accept owner policy");
});

test("PER-1572: no blind retry after partial write or concurrent environment change",async()=>{
 const f=fixture();
 let i=0;
 await assert.rejects(applyOwnerGovernancePlan(build(),{
  read:f.read,confirmation:OWNER_CONFIRMATION,
  write:async(...args)=>{
    i++;if(i===4)throw new Error("private token");
    return f.write(...args);
  }
 }),denied("partial_apply_requires_manual_reconciliation"));
 assert.equal(f.state.rulesets.length,1);
 await assert.rejects(preflightOwnerGovernance(build(),f.read),
  denied("existing_rulesets_require_manual_reconciliation"));
 const competing=fixture();
 let envWrites=0;
 await assert.rejects(applyOwnerGovernancePlan(build(),{
  read:competing.read,confirmation:OWNER_CONFIRMATION,
  write:async(...args)=>{
    if(args[1].endsWith("/rulesets")&&args[2].target==="tag")
      competing.state.environment={name:"savant-release",protection_rules:[]};
    if(args[0]==="PUT")envWrites++;
    return competing.write(...args);
  }
 }),denied("partial_apply_requires_manual_reconciliation"));
 assert.equal(envWrites,0);
});

test("PER-1572: explicit sole-owner dry run makes no network call, tokenless apply fails closed",async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;throw Error("should not access network");};
 const env={GITHUB_REPOSITORY:REPO};
 const r=await executeOwnerBootstrap({env,argv:cli,fetcher});
 assert.equal(r.mode,"plan");
 assert.equal(r.performedWrites,0);
 assert.equal(calls,0);
 await assert.rejects(executeOwnerBootstrap({env,argv:[
  ...cli,"--apply","--confirm="+OWNER_CONFIRMATION
 ],fetcher}),/missing_admin_token/);
 assert.equal(calls,0);
});

test("PER-1572: repo-controlled owner profile routes read-only audit; phase-two refuses privileged PUT",async()=>{
 const f=fixture();
 await applyOwnerGovernancePlan(build(),{read:f.read,write:f.write,confirmation:OWNER_CONFIRMATION});
 const fetcher=async(url,opt)=>{
  const path=url.replace("https://api.github.com","");
  try{return new Response(JSON.stringify(await f.read(path)),{status:200});}
  catch{return new Response("{}",{status:404});}
 };
 const env={GITHUB_REPOSITORY:REPO,GH_TOKEN:"test-admin-auth-token-long",
  SAVANT_RELEASE_GOVERNANCE_PROFILE:OWNER_PROFILE,SAVANT_RELEASE_MAIN_SHA:SHA};
 const audit=await runGovernanceAudit(env,{fetcher});
 assert.equal(audit.ready,true,JSON.stringify(audit.problems));
 assert.equal(audit.profile,OWNER_PROFILE);
 const phase=await runAuditUpgrade({env,argv:[],fetcher});
 assert.equal(phase.state,"already_verified");
 assert.equal(phase.writes,0);
 await assert.rejects(runAuditUpgrade({env,argv:[
  "--apply","--confirm=ENFORCE-SAVANT-DEPENDENCY-AUDIT"
 ],fetcher}),/owner_profile_has_no_phase_two_mutation/);
 await assert.rejects(runGovernanceAudit({...env,SAVANT_RELEASE_GOVERNANCE_PROFILE:"imposter"},
  {fetcher}),/unknown_release_governance_profile/);
});

test("PER-1572: CLI is Windows/Unix path-safe and never treats inherited env flag as owner consent",()=>{
 const script=fileURLToPath(new URL("./release-governance-bootstrap.mjs",import.meta.url));
 const env={PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",
  GITHUB_REPOSITORY:REPO,SAVANT_RELEASE_GOVERNANCE_PROFILE:OWNER_PROFILE};
 const r=spawnSync(process.execPath,[script,...cli],{env,encoding:"utf8",timeout:10000});
 assert.equal(r.status,0,r.stderr);
 assert.equal(JSON.parse(r.stdout).profile,OWNER_PROFILE);
 assert.equal(r.stderr.trim(),"");
 const invalid=spawnSync(process.execPath,[script],{env,encoding:"utf8",timeout:10000});
 assert.equal(invalid.status,1);
 assert.match(invalid.stderr,/invalid_actor_id/);
 const apply=spawnSync(process.execPath,[script,...cli,"--apply","--confirm="+OWNER_CONFIRMATION],{
  env,encoding:"utf8",timeout:10000
 });
 assert.equal(apply.status,1);
 assert.match(apply.stderr,/missing_admin_token/);
 assert.doesNotMatch(apply.stdout+apply.stderr,/Bearer /);
});

test("PER-1572: publication audit uses explicit repo profile and stays fail-closed by default",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/publish-source-release.yml",import.meta.url),"utf8");
 assert.match(workflow,/SAVANT_RELEASE_GOVERNANCE_PROFILE: \$\{\{ vars\.SAVANT_RELEASE_GOVERNANCE_PROFILE \}\}/);
 assert.match(workflow,/SAVANT_GOVERNANCE_MODE: publish/);
 assert.match(workflow,/environment:\s*\n\s*name: savant-release/);
 assert.match(workflow,/node scripts\/release-controls-audit\.mjs/);
 assert.doesNotMatch(workflow,/^\s+on:\s+push:/m);
 const migrate=readFileSync(new URL("../apps/web/scripts/migrate-on-deploy.mjs",import.meta.url),"utf8");
 assert.match(migrate,/Production schema migration is disabled during builds/);
});
