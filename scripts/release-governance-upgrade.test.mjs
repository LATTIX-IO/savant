import test from "node:test";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileGovernancePlan,REQUIRED_RELEASE_CHECKS}
  from "./release-governance-bootstrap.mjs";
import {auditGovernance} from "./release-controls-audit.mjs";
import {
  REQUIRED_POST_UPGRADE_CHECKS,REQUIRED_DEPENDENCY_AUDIT_CONTEXT,
  GovernanceUpgradeError,preflightAuditUpgrade,applyAuditUpgrade,
  validateUpgradeArgs,runAuditUpgrade
} from "./release-governance-upgrade.mjs";

const repo="LATTIX-IO/savant",base="/repos/"+repo,sha="a".repeat(40);
const actor="300",reviewer="301",rulesets=base+"/rulesets?includes_parents=true&per_page=100";
const rulePath=base+"/rulesets/11";
const identity={operatorId:actor,expectedMainSha:sha};
function fixture(){
  const plan=compileGovernancePlan({repository:repo,operatorId:actor,reviewerId:reviewer});
  const state={
    mainSha:sha,protected:true,
    mainRule:{id:11,...structuredClone(plan.operations[1].body)},
    tagRule:{id:12,...structuredClone(plan.operations[2].body)},
    environment:{
      name:"savant-release",
      protection_rules:[{type:"required_reviewers",prevent_self_review:true,
        reviewers:[{type:"User",reviewer:{id:301}}]}],
      deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}
    },
    publication:"false",
    checkRuns:REQUIRED_POST_UPGRADE_CHECKS.map(name=>({
      name,status:"completed",conclusion:"success",app:{id:15368,slug:"github-actions"}
    })),
    writes:[],reads:[]
  };
  async function read(path){
    state.reads.push(path);
    if(path==="/user")return {id:300,login:"approved-security-operator"};
    if(path===base)return {full_name:repo,default_branch:"main"};
    if(path===base+"/branches/main")
      return {name:"main",protected:state.protected,commit:{sha:state.mainSha}};
    if(path===base+"/commits/"+sha+"/check-runs?per_page=100")
      return {total_count:state.checkRuns.length,check_runs:structuredClone(state.checkRuns)};
    if(path===rulesets)
      return [state.mainRule,state.tagRule].map(x=>({
        id:x.id,target:x.target,enforcement:x.enforcement
      }));
    if(path===rulePath)return structuredClone(state.mainRule);
    if(path===base+"/rulesets/12")return structuredClone(state.tagRule);
    if(path===base+"/environments/savant-release")return structuredClone(state.environment);
    if(path===base+"/environments/savant-release/deployment-branch-policies")
      return {total_count:1,branch_policies:[{name:"main"}]};
    if(path===base+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED")
      return {name:"SAVANT_RELEASE_PUBLISH_ENABLED",value:state.publication};
    throw Error("unexpected read");
  }
  async function write(path,body){
    if(path!==rulePath)throw Error("write escaped exact ruleset");
    state.writes.push({path,body:structuredClone(body)});
    state.mainRule={id:11,...structuredClone(body)};
    return {status:200};
  }
  return {state,read,write};
}
const denied=(code)=>(e)=>e instanceof GovernanceUpgradeError&&e.code===code;
const apply=f=>applyAuditUpgrade({
  ...identity,read:f.read,write:f.write,
  confirmation:"ENFORCE-SAVANT-DEPENDENCY-AUDIT"
});
test("PER-1558: original nine checks remain required with new App-attested dependency audit",()=>{
  assert.equal(REQUIRED_POST_UPGRADE_CHECKS.length,REQUIRED_RELEASE_CHECKS.length+1);
  assert.deepEqual(REQUIRED_POST_UPGRADE_CHECKS.slice(0,-1),REQUIRED_RELEASE_CHECKS);
  assert.equal(REQUIRED_POST_UPGRADE_CHECKS.at(-1),
    "Blocking production dependency audit (high/critical)");
  assert.equal(new Set(REQUIRED_POST_UPGRADE_CHECKS).size,REQUIRED_POST_UPGRADE_CHECKS.length);
});
test("PER-1558: read-only preflight proves reviewed main, independent release reviewer and App checks",async()=>{
  const f=fixture(),out=await preflightAuditUpgrade({...identity,read:f.read});
  assert.equal(out.rulesetId,11);
  assert.equal(out.mainSha,sha);
  assert.equal(out.alreadyApplied,false);
  assert.equal(out.required,10);
  assert.deepEqual(f.state.writes,[]);
  assert.equal((await auditGovernance(repo,f.read)).ready,true);
});
test("PER-1558: exact confirmation and a unique branch ruleset required",async()=>{
  assert.equal(validateUpgradeArgs([]),"plan");
  assert.equal(validateUpgradeArgs([
    "--apply","--confirm=ENFORCE-SAVANT-DEPENDENCY-AUDIT"
  ]),"apply");
  for(const args of [
    ["--apply"],["--force"],["--apply","--confirm=yes"],
    ["--apply","--confirm=ENFORCE-SAVANT-DEPENDENCY-AUDIT","--force"]
  ])assert.throws(()=>validateUpgradeArgs(args),denied("explicit_confirmation_required"));
  const f=fixture();
  await assert.rejects(()=>applyAuditUpgrade({
    ...identity,read:f.read,write:f.write,confirmation:"no"
  }),denied("explicit_confirmation_required"));
  assert.equal(f.state.reads.length,0);
  assert.equal(f.state.writes.length,0);
});
test("PER-1558: one ruleset PUT adds audit without touching tag, release reviewers or publication flag",async()=>{
  const f=fixture(),oldTag=structuredClone(f.state.tagRule),
    oldEnv=structuredClone(f.state.environment);
  const result=await apply(f);
  assert.deepEqual(result,{
    state:"dependency_audit_required",writes:1,mainSha:sha
  });
  assert.equal(f.state.writes.length,1);
  assert.equal(f.state.writes[0].path,rulePath);
  assert.deepEqual(f.state.tagRule,oldTag);
  assert.deepEqual(f.state.environment,oldEnv);
  assert.equal(f.state.publication,"false");
  const main=f.state.mainRule;
  const req=main.rules.find(x=>x.type==="required_status_checks").parameters.required_status_checks;
  assert.equal(req.length,10);
  assert.ok(req.some(x=>x.context===REQUIRED_DEPENDENCY_AUDIT_CONTEXT&&
    x.integration_id===15368));
  assert.ok(main.rules.some(x=>x.type==="non_fast_forward"));
  assert.equal(main.rules.find(x=>x.type==="pull_request").parameters.require_last_push_approval,true);
  assert.equal((await auditGovernance(repo,f.read)).ready,true);
  const again=await apply(f);
  assert.deepEqual(again,{state:"already_verified",writes:0,mainSha:sha});
  assert.equal(f.state.writes.length,1);
});
test("PER-1558: missing, false, spoofed or incomplete GitHub Actions check evidence denies any write",async()=>{
  const mutations=[
    s=>s.checkRuns.pop(),
    s=>s.checkRuns.at(-1).conclusion="failure",
    s=>s.checkRuns.at(-1).status="in_progress",
    s=>s.checkRuns.at(-1).app.id=999,
    s=>s.checkRuns.at(-1).app.slug="attacker-app",
    s=>s.checkRuns.at(-1).name="fake-audit-check",
    s=>s.checkRuns[0].app.id=100,
    s=>s.checkRuns[0].name="renamed historical check",
  ];
  for(const update of mutations){
    const f=fixture();update(f.state);
    await assert.rejects(()=>apply(f),denied("required_check_not_verified"));
    assert.deepEqual(f.state.writes,[]);
  }
});
test("PER-1558: unauthorized operator, unprotected/stale main, missing review and enabled release deny",async()=>{
  const cases=[
    [s=>s.mainSha="b".repeat(40),"reviewed_main_commit_mismatch"],
    [s=>s.protected=false,"reviewed_main_commit_mismatch"],
    [s=>s.environment.protection_rules[0].reviewers=[],"existing_governance_incomplete"],
    [s=>s.environment.protection_rules[0].reviewers[0].reviewer.id=300,
     "independent_release_reviewer_required"],
    [s=>s.publication="true","existing_governance_incomplete"],
    [s=>s.mainRule.bypass_actors=[{actor_id:900,bypass_mode:"always"}],
     "existing_governance_incomplete"],
  ];
  for(const [mutate,code] of cases){
    const f=fixture();mutate(f.state);
    await assert.rejects(()=>apply(f),denied(code));
    assert.equal(f.state.writes.length,0);
  }
  const f=fixture();
  await assert.rejects(()=>applyAuditUpgrade({
    ...identity,operatorId:"not-a-user",read:f.read,write:f.write,
    confirmation:"ENFORCE-SAVANT-DEPENDENCY-AUDIT"
  }),denied("invalid_operator_identity"));
  await assert.rejects(()=>applyAuditUpgrade({
    ...identity,operatorId:"399",read:f.read,write:f.write,
    confirmation:"ENFORCE-SAVANT-DEPENDENCY-AUDIT"
  }),denied("operator_identity_mismatch"));
});
test("PER-1558: restrictive exact baseline rejects drift rather than broadening branch policy",async()=>{
  const mutations=[
    s=>s.mainRule.rules.find(x=>x.type==="pull_request").parameters
      .required_approving_review_count=0,
    s=>s.mainRule.rules.find(x=>x.type==="pull_request").parameters
      .require_last_push_approval=false,
    s=>s.mainRule.rules.find(x=>x.type==="required_status_checks").parameters
      .required_status_checks[0].integration_id=0,
    s=>s.mainRule.rules.push({type:"creation"}),
    s=>s.mainRule.conditions.ref_name.include=["refs/heads/*"],
    s=>s.mainRule.rules.find(x=>x.type==="required_status_checks").parameters
      .required_status_checks.push({context:"unreviewed-check",integration_id:15368}),
  ];
  for(const mutate of mutations){
    const f=fixture();mutate(f.state);
    await assert.rejects(()=>apply(f));
    assert.equal(f.state.writes.length,0);
  }
});
test("PER-1558: concurrent ruleset edit after read-only verification halts before PUT",async()=>{
  const f=fixture();let n=0;
  const read=async(path)=>{
    const value=await f.read(path);
    if(path===rulePath&&++n===3){
      f.state.mainRule.rules.find(x=>x.type==="pull_request").parameters
        .required_approving_review_count=2;
      return structuredClone(f.state.mainRule);
    }
    return value;
  };
  await assert.rejects(()=>applyAuditUpgrade({
    ...identity,read,write:f.write,
    confirmation:"ENFORCE-SAVANT-DEPENDENCY-AUDIT"
  }),denied("concurrent_governance_change"));
  assert.deepEqual(f.state.writes,[]);
});
test("PER-1558: a failed or partial administrative write cannot be described as verified",async()=>{
  const f=fixture();
  await assert.rejects(()=>applyAuditUpgrade({
    ...identity,read:f.read,write:async()=>({status:202}),
    confirmation:"ENFORCE-SAVANT-DEPENDENCY-AUDIT"
  }),denied("administrative_write_failed_reconcile"));
  const g=fixture();
  await assert.rejects(()=>applyAuditUpgrade({
    ...identity,read:g.read,write:async(path,body)=>{
      await g.write(path,body);
      g.state.mainRule.rules.find(x=>x.type==="required_status_checks").parameters
        .required_status_checks.pop();
      return {status:200};
    },confirmation:"ENFORCE-SAVANT-DEPENDENCY-AUDIT"
  }),denied("post_update_verification_required"));
});
test("PER-1558: operator adapter uses scoped read and exact one PUT only; secrets are redacted",async()=>{
  const f=fixture(),secret="not-for-logs-admin-token";
  const calls=[];
  const fetcher=async(url,request)=>{
    const path=url.replace("https://api.github.com","");
    calls.push({path,method:request.method});
    if(request.headers.Authorization!=="Bearer "+secret)throw Error("auth mismatch");
    if(request.method==="GET"){
      let out;
      try{out=await f.read(path);}
      catch{return new Response("not found",{status:404});}
      return new Response(JSON.stringify(out),{status:200});
    }
    if(request.method==="PUT"&&path===rulePath){
      await f.write(path,JSON.parse(request.body));
      return new Response("{}",{status:200});
    }
    throw Error("unexpected mutation path");
  };
  const env={GITHUB_REPOSITORY:repo,GH_TOKEN:secret,
    SAVANT_RELEASE_MAIN_SHA:sha,SAVANT_RELEASE_OPERATOR_ID:actor};
  const plan=await runAuditUpgrade({env,argv:[],fetcher});
  assert.equal(plan.mode,"plan");
  assert.equal(plan.writes,0);
  assert.ok(calls.every(x=>x.method==="GET"));
  const done=await runAuditUpgrade({env,
    argv:["--apply","--confirm=ENFORCE-SAVANT-DEPENDENCY-AUDIT"],fetcher});
  assert.equal(done.writes,1);
  assert.deepEqual(calls.filter(x=>x.method==="PUT"),[{method:"PUT",path:rulePath}]);
  assert.doesNotMatch(JSON.stringify({plan,done}),new RegExp(secret));
  await assert.rejects(runAuditUpgrade({
    env:{...env,GITHUB_REPOSITORY:"attacker/evil"},
    argv:["--apply","--confirm=ENFORCE-SAVANT-DEPENDENCY-AUDIT"],fetcher
  }),denied("repository_out_of_scope"));
});
test("PER-1558: test source never dispatches releases or adjusts main, tags, environments, flags",()=>{
  const src=readFileSync("scripts/release-governance-upgrade.mjs","utf8");
  assert.doesNotMatch(src,/release\s+create|workflow_dispatch|method:\s*["']DELETE["']/);
  assert.match(src,/already_verified/);
  assert.match(src,/required_check_not_verified/);
  assert.match(src,/admin_api_rejected/);
});


for(const argv of [[],["--apply","--confirm=ENFORCE-SAVANT-DEPENDENCY-AUDIT"]]){
  test("PER-1558: phase-2 CLI "+(argv.length?"apply":"plan")+
    " must execute and fail closed without GitHub operator context",()=>{
    const binary=fileURLToPath(new URL("./release-governance-upgrade.mjs",import.meta.url));
    const result=spawnSync(process.execPath,[binary,...argv],{
      env:{PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??""},
      encoding:"utf8",timeout:10000
    });
    assert.equal(result.signal,null);
    assert.equal(result.status,1);
    assert.match(result.stderr,/"ready":false/);
    assert.match(result.stderr,/repository_out_of_scope/);
    assert.doesNotMatch(result.stdout+result.stderr,/Bearer\s+\S+|ghp_/);
  });
}
