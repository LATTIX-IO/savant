import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REQUIRED_RELEASE_CHECKS, BootstrapError, compileGovernancePlan, validateApproval,
  preflight, applyGovernancePlan, makeAdminAdapter, executeBootstrap, assertCanonicalPlan
} from "./release-governance-bootstrap.mjs";
import { auditGovernance } from "./release-controls-audit.mjs";

const REPO="LATTIX-IO/savant",BASE="/repos/"+REPO,SHA="a".repeat(40);
const inputs={repository:REPO,reviewerId:"301",operatorId:"300",reviewerType:"User"};
const plan=()=>compileGovernancePlan(inputs);
function fixture() {
  const state={
    mainProtected:false,flag:null,environment:null,policies:[],rulesets:[],writes:[],
    checkRuns:REQUIRED_RELEASE_CHECKS.map(name=>({name,status:"completed",conclusion:"success"}))
  };
  const read=async path=>{
    if(path===BASE)return {full_name:REPO,default_branch:"main"};
    if(path===BASE+"/branches/main")return {name:"main",protected:state.mainProtected,commit:{sha:SHA}};
    if(path===BASE+"/commits/"+SHA+"/check-runs?per_page=100")
      return {total_count:state.checkRuns.length,check_runs:state.checkRuns};
    if(path===BASE+"/rulesets?includes_parents=true&per_page=100")
      return state.rulesets.map(rule=>({id:rule.id,target:rule.target,enforcement:rule.enforcement}));
    const detail=path.match(new RegExp("^"+BASE+"/rulesets/(\\d+)$"));
    if(detail){
      const rule=state.rulesets.find(r=>r.id===Number(detail[1]));
      if(!rule)throw new BootstrapError("not_found",404);
      return rule;
    }
    if(path===BASE+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED"){
      if(state.flag===null)throw new BootstrapError("not_found",404);
      return {name:"SAVANT_RELEASE_PUBLISH_ENABLED",value:state.flag};
    }
    if(path===BASE+"/environments/savant-release"){
      if(state.environment===null)throw new BootstrapError("not_found",404);
      return state.environment;
    }
    if(path===BASE+"/environments/savant-release/deployment-branch-policies")
      return {total_count:state.policies.length,branch_policies:state.policies};
    throw Error("unexpected read "+path);
  };
  const write=async(method,path,body,expected)=>{
    state.writes.push({method,path,body});
    if(method==="POST" && path===BASE+"/actions/variables"){
      if(state.flag!==null)throw Error("variable exists");
      state.flag=body.value;
      return {status:201};
    }
    if(method==="POST"&&path===BASE+"/rulesets"){
      const id=state.rulesets.length+10;
      state.rulesets.push({id,...structuredClone(body)});
      if(body.target==="branch")state.mainProtected=true;
      return {status:201};
    }
    if(method==="PUT"&&path===BASE+"/environments/savant-release"){
      const reviewers=body.reviewers.map(r=>({type:r.type,reviewer:{id:r.id}}));
      state.environment={name:"savant-release",
        protection_rules:[{type:"required_reviewers",prevent_self_review:body.prevent_self_review,reviewers}],
        deployment_branch_policy:body.deployment_branch_policy};
      return {status:200};
    }
    if(method==="POST"&&path===BASE+"/environments/savant-release/deployment-branch-policies"){
      state.policies.push({name:body.name});
      return {status:200};
    }
    throw Error("unexpected write");
  };
  return {state,read,write};
}
test("PER-1221 declarative plan contains active no-bypass branch/tag rules and main-only independent release review",()=>{
  const p=plan();
  assert.equal(p.repository,REPO);
  assert.equal(p.publicationEnabled,false);
  assert.equal(p.operations.length,5);
  assert.deepEqual(p.operations.map(x=>x.method),["POST","POST","POST","PUT","POST"]);
  assert.ok(p.operations.every(x=>x.path.startsWith(BASE+"/")));
  const body=p.operations[1].body;
  assert.equal(body.enforcement,"active");
  assert.deepEqual(body.bypass_actors,[]);
  assert.deepEqual(body.conditions.ref_name.include,["refs/heads/main"]);
  assert.ok(body.rules.some(x=>x.type==="non_fast_forward"));
  const pull=body.rules.find(x=>x.type==="pull_request");
  assert.equal(pull.parameters.required_approving_review_count,1);
  assert.equal(pull.parameters.require_last_push_approval,true);
  assert.equal(pull.parameters.required_review_thread_resolution,true);
  const required=body.rules.find(x=>x.type==="required_status_checks");
  assert.equal(required.parameters.strict_required_status_checks_policy,true);
  assert.deepEqual(required.parameters.required_status_checks.map(x=>x.context),REQUIRED_RELEASE_CHECKS);
  assert.ok(REQUIRED_RELEASE_CHECKS.length>=9);
  const tags=p.operations[2].body;
  assert.equal(tags.target,"tag");
  assert.deepEqual(tags.bypass_actors,[]);
  assert.deepEqual(tags.conditions.ref_name.include,["refs/tags/v*"]);
  assert.deepEqual(tags.rules.map(x=>x.type),["deletion","update"]);
  const env=p.operations[3].body;
  assert.equal(env.prevent_self_review,true);
  assert.deepEqual(env.reviewers,[{type:"User",id:301}]);
  assert.deepEqual(env.deployment_branch_policy,{protected_branches:false,custom_branch_policies:true});
  assert.deepEqual(p.operations[4].body,{name:"main",type:"branch"});
  assert.equal(p.operations[0].body.value,"false");
  assert.ok(!JSON.stringify(p.operations).includes("release/create"));
});
test("PER-1221 administrator and independent reviewer are required and cross-repo writes forbidden",()=>{
  for(const settings of [
    {...inputs,reviewerId:"300"}, {...inputs,reviewerId:"0"},
    {...inputs,reviewerId:"-1"}, {...inputs,reviewerId:"3; echo attack"},
    {...inputs,reviewerId:"99999999999999999999"},
    {...inputs,operatorId:""}, {...inputs,reviewerType:"Integration"},
    {...inputs,repository:"ATTACKER/evil"}, {...inputs,repository:"LATTIX-IO/other"}
  ])assert.throws(()=>compileGovernancePlan(settings));
  assert.equal(compileGovernancePlan({...inputs,reviewerType:"Team"}).operations[3].body.reviewers[0].type,"Team");
});
test("PER-1221 zero-write dry-run and exact operator confirmation",async()=>{
  let calls=0;
  const result=await executeBootstrap({
    env:{GITHUB_REPOSITORY:REPO,SAVANT_RELEASE_REVIEWER_ID:"301",SAVANT_RELEASE_OPERATOR_ID:"300"},
    fetcher:async()=>{calls++;throw Error("network not permitted");},
    argv:[]
  });
  assert.equal(result.mode,"plan");
  assert.equal(result.performedWrites,0);
  assert.equal(calls,0);
  for(const argv of [["--apply"],["--force"],["--apply","--confirm=other"],["--apply","--confirm=PROTECT-LATTIX-IO-savant","--force"]]){
    assert.throws(()=>validateApproval(argv),/explicit_operator_approval_required/);
  }
  assert.equal(validateApproval(["--apply","--confirm=PROTECT-LATTIX-IO-savant"]),"apply");
  await assert.rejects(executeBootstrap({
    env:{GITHUB_REPOSITORY:REPO,SAVANT_RELEASE_REVIEWER_ID:"301",SAVANT_RELEASE_OPERATOR_ID:"300"},
    argv:["--apply","--confirm=PROTECT-LATTIX-IO-savant"],
    fetcher:async()=>{calls++;throw Error("unexpected network");}
  }),/missing_admin_token/);
  assert.equal(calls,0);
});
test("PER-1221 preflight validates existing CI evidence and publication-disabled baseline without mutation",async()=>{
  const f=fixture();
  const inspected=await preflight(plan(),f.read);
  assert.equal(inspected.mainSha,SHA);
  assert.equal(inspected.createVariable,true);
  assert.deepEqual(f.state.writes,[]);
  f.state.flag="false";
  assert.equal((await preflight(plan(),f.read)).createVariable,false);
});
test("PER-1221 preflight rejects protected/drifted config, unverified CI and enabled publication",async()=>{
  const changes=[
    s=>s.flag="true",
    s=>s.flag="something-else",
    s=>s.mainProtected=true,
    s=>s.rulesets=[{id:10,target:"branch",enforcement:"active"}],
    s=>s.environment={name:"savant-release"},
    s=>s.checkRuns.pop(),
    s=>s.checkRuns[0].conclusion="failure",
    s=>s.checkRuns[0].status="queued",
    s=>s.checkRuns[0].name="attacker-forged-ci"
  ];
  for(const update of changes){
    const f=fixture();update(f.state);
    await assert.rejects(preflight(plan(),f.read));
    assert.equal(f.state.writes.length,0);
  }
  const f=fixture();
  await assert.rejects(preflight(plan(),async path=>{
    if(path.includes("/actions/variables/"))throw new BootstrapError("forbidden",403);
    return f.read(path);
  }),e=>e.status===403);
  assert.equal(f.state.writes.length,0);
});
test("PER-1221 guarded apply provisions only disabled variable/protections and verifies a live readback",async()=>{
  const f=fixture();
  const result=await applyGovernancePlan(plan(),{read:f.read,write:f.write,
    confirmation:"PROTECT-LATTIX-IO-savant"});
  assert.equal(result.state,"controls_verified_publication_disabled");
  assert.equal(result.created,5);
  assert.equal(f.state.flag,"false");
  assert.equal(f.state.rulesets.length,2);
  assert.equal(f.state.mainProtected,true);
  assert.equal(f.state.environment.name,"savant-release");
  assert.deepEqual(f.state.policies,[{name:"main"}]);
  assert.equal((await auditGovernance(REPO,f.read)).ready,true);
  assert.ok(f.state.writes.every(x=>!JSON.stringify(x.body).includes('"value":"true"')));
});
test("PER-1221 existing disabled variable is preserved and not rewritten",async()=>{
  const f=fixture();f.state.flag="false";
  const r=await applyGovernancePlan(plan(),{read:f.read,write:f.write,confirmation:"PROTECT-LATTIX-IO-savant"});
  assert.equal(r.created,4);
  assert.equal(f.state.writes.filter(x=>x.path.includes("/actions/variables")).length,0);
});
test("PER-1221 partial write, wrong response and post-apply missing evidence never claim success or rollback",async()=>{
  const f=fixture();
  let count=0;
  await assert.rejects(applyGovernancePlan(plan(),{
    read:f.read,
    write:async(...args)=>{
      if(++count===3)throw Error("token and confidential response MUST NOT LEAK");
      return f.write(...args);
    },confirmation:"PROTECT-LATTIX-IO-savant"
  }),error=>error instanceof BootstrapError && error.code==="partial_apply_requires_manual_reconciliation" &&
    !error.message.includes("confidential"));
  assert.ok(count===3);
  assert.equal(f.state.flag,"false");
  assert.equal(f.state.rulesets.length,1);
  const g=fixture();
  await assert.rejects(applyGovernancePlan(plan(),{
    read:g.read,write:async()=>({status:202}),confirmation:"PROTECT-LATTIX-IO-savant"
  }),/partial_apply_requires_manual_reconciliation/);
  const x=fixture();
  await assert.rejects(applyGovernancePlan(plan(),{
    read:x.read,write:async(...args)=>{
      const response=await x.write(...args);
      if(args[1].endsWith("/deployment-branch-policies"))x.state.policies=[{name:"*"}];
      return response;
    },confirmation:"PROTECT-LATTIX-IO-savant"
  }),/post_apply_security_audit_failed/);
});
test("PER-1221 API adapter is endpoint-scoped, GET-only in preflight and redacts transport failures",async()=>{
  const token="test-token-not-for-output";
  const observed=[];
  const adapter=makeAdminAdapter({token,fetcher:async(url,options)=>{
    observed.push({url,method:options.method,auth:options.headers.Authorization});
    return new Response(JSON.stringify({full_name:REPO}),{status:200});
  }});
  assert.deepEqual(await adapter("GET",BASE),{full_name:REPO});
  assert.equal(observed[0].url,"https://api.github.com"+BASE);
  assert.equal(observed[0].method,"GET");
  assert.equal(observed[0].auth,"Bearer "+token);
  await assert.rejects(adapter("POST","/repos/attacker/x/rulesets",{}),/invalid_admin_request/);
  await assert.rejects(adapter("GET",BASE+"/../users"),/invalid_admin_request/);
  await assert.rejects(adapter("DELETE",BASE),/invalid_admin_request/);
  await assert.rejects(adapter("PUT",BASE+"/rulesets",null,200),/invalid_admin_mutation/);
  const bad=makeAdminAdapter({token,fetcher:async()=>{throw Error("secret="+token);}});
  await assert.rejects(bad("GET",BASE),e=>!e.message.includes(token));
  const forbidden=makeAdminAdapter({token,fetcher:async()=>new Response("token="+token,{status:403})});
  await assert.rejects(forbidden("GET",BASE),e=>!e.message.includes(token));
  const partial=makeAdminAdapter({token,fetcher:async()=>new Response("[]",{
    status:200,headers:{link:'<https://api.github.com/page=2>; rel="next"'}
  })});
  await assert.rejects(partial("GET",BASE),/paginated_admin_evidence/);
  assert.throws(()=>makeAdminAdapter({token:""}),/missing_admin_token/);
});
test("PER-1221 bootstrap script cannot silently enable source release, publish or delete GitHub controls",()=>{
  const src=readFileSync("scripts/release-governance-bootstrap.mjs","utf8");
  assert.doesNotMatch(src,/release\s+create|workflow_dispatch|method:\s*["']DELETE["']/);
  assert.match(src,/SAVANT_RELEASE_PUBLISH_ENABLED/);
  assert.match(src,/post_apply_security_audit_failed/);
  const flow=readFileSync(".github/workflows/publish-source-release.yml","utf8");
  assert.doesNotMatch(flow,/^\s*(push|pull_request|workflow_run|schedule):\s*$/m);
});

test("PER-1221 forged external plan cannot enable release, overwrite flags or escape exact write allowlist",async()=>{
  const f=fixture();
  const injected=plan();
  injected.operations[0].body.value="true";
  await assert.rejects(applyGovernancePlan(injected,{read:f.read,write:f.write,
    confirmation:"PROTECT-LATTIX-IO-savant"}),/modified_bootstrap_plan/);
  assert.equal(f.state.writes.length,0);
  const rewritten=plan();
  rewritten.operations[1].path=BASE+"/releases";
  await assert.rejects(preflight(rewritten,f.read),/modified_bootstrap_plan/);
  const token="test-token-not-for-output";
  const api=makeAdminAdapter({token,fetcher:async()=>{throw Error("network must not be invoked");}});
  await assert.rejects(api("POST",BASE+"/releases",{tag_name:"v0.1.0"},201),/invalid_admin_mutation/);
  await assert.rejects(api("PUT",BASE+"/branches/main/protection",{},200),/invalid_admin_mutation/);
  await assert.rejects(api("POST",BASE+"/actions/variables",{name:"SAVANT_RELEASE_PUBLISH_ENABLED",value:"true"},204),/invalid_admin_mutation/);
  assert.equal(assertCanonicalPlan(plan()).publicationEnabled,false);
});

test("PER-1221 verified post-apply checks detect silent reviewer or required-context drift",async()=>{
  const wrongReviewer=fixture();
  await assert.rejects(applyGovernancePlan(plan(),{
    read:wrongReviewer.read,confirmation:"PROTECT-LATTIX-IO-savant",
    write:async(...args)=>{
      const response=await wrongReviewer.write(...args);
      if(args[0]==="PUT")wrongReviewer.state.environment.protection_rules[0].reviewers[0].reviewer.id=999;
      return response;
    }
  }),/post_apply_control_drift/);
  const lostCheck=fixture();
  await assert.rejects(applyGovernancePlan(plan(),{
    read:lostCheck.read,confirmation:"PROTECT-LATTIX-IO-savant",
    write:async(...args)=>{
      const response=await lostCheck.write(...args);
      if(args[1].endsWith("/rulesets") && args[2].target==="branch")
        lostCheck.state.rulesets[0].rules.find(r=>r.type==="required_status_checks").parameters.required_status_checks.pop();
      return response;
    }
  }),/post_apply_control_drift/);
  assert.equal(lostCheck.state.flag,"false");
});
