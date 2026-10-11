import test from "node:test";
import assert from "node:assert/strict";
import {auditGovernance,assertRepository,makeGitHubReader,runGovernanceAudit,
  evaluateEnvironment,evaluateRulesets,GovernanceAuditError} from "./release-controls-audit.mjs";
const repo="LATTIX-IO/savant",base="/repos/"+repo;
function fixture() {
 const data={
  [base]:{default_branch:"main"},
  [base+"/branches/main"]:{name:"main",protected:true},
  [base+"/rulesets?includes_parents=true"]:[
    {id:11,target:"branch",enforcement:"active"},{id:12,target:"tag",enforcement:"active"}],
  [base+"/rulesets/11"]:{id:11,target:"branch",enforcement:"active",
    conditions:{ref_name:{include:["refs/heads/main"],exclude:[]}},
    rules:[{type:"pull_request"},{type:"required_status_checks"}]},
  [base+"/rulesets/12"]:{id:12,target:"tag",enforcement:"active",
    conditions:{ref_name:{include:["refs/tags/v*"],exclude:[]}},
    rules:[{type:"deletion"},{type:"update"}]},
  [base+"/environments/savant-release"]:{name:"savant-release",
    protection_rules:[{type:"required_reviewers",prevent_self_review:true,
      reviewers:[{type:"User",reviewer:{id:20}}]}],
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}},
  [base+"/environments/savant-release/deployment-branch-policies"]:
    {branch_policies:[{name:"main"}]},
  [base+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED"]:
    {name:"SAVANT_RELEASE_PUBLISH_ENABLED",value:"false"}
 };
 return structuredClone(data);
}
const reader = obj => async path => {
 if(!(path in obj))throw Error("permission denied confidential token=abc");
 return obj[path];
};
test("PER-1212: a complete, independently-reviewed, disabled release configuration passes",async()=>{
 const r=await auditGovernance(repo,reader(fixture()));
 assert.equal(r.ready,true);
 assert.equal(r.problems.length,0);
 assert.equal(Object.values(r.checks).every(Boolean),true);
 assert.equal(Object.keys(r.checks).length,8);
 assert.doesNotMatch(JSON.stringify(r),/reviewer.*20|token=/);
});
test("PER-1212: every missing prerequisite fails closed with a named safe finding",async()=>{
 const changes=[
  x=>x[base].default_branch="dev",
  x=>x[base+"/branches/main"].protected=false,
  x=>x[base+"/rulesets/11"].rules=[],
  x=>x[base+"/rulesets/12"].rules=[{type:"deletion"}],
  x=>x[base+"/environments/savant-release"].protection_rules=[],
  x=>x[base+"/environments/savant-release"].protection_rules[0].prevent_self_review=false,
  x=>x[base+"/environments/savant-release/deployment-branch-policies"].branch_policies=[{name:"main"},{name:"dev"}],
  x=>x[base+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED"].value="true",
  x=>x[base+"/rulesets/11"].enforcement="evaluate",
  x=>x[base+"/rulesets/12"].conditions.ref_name.exclude=["refs/tags/v1"],
  x=>x[base+"/environments/savant-release"].deployment_branch_policy.custom_branch_policies=false,
 ];
 for(const mutate of changes){
  const state=fixture();mutate(state);
  const result=await auditGovernance(repo,reader(state));
  assert.equal(result.ready,false);
  assert.ok(result.problems.length>0);
  assert.equal(Object.values(result.checks).every(Boolean),false);
 }
});
test("PER-1212: inaccessible, malformed, overbroad and incomplete evidence never succeeds",async()=>{
 for(const [k,mutate] of [
  ["missing ruleset details",x=>delete x[base+"/rulesets/11"]],
  ["unknown ruleset response",x=>x[base+"/rulesets?includes_parents=true"]={}],
  ["no environment",x=>delete x[base+"/environments/savant-release"]],
  ["missing branch list",x=>delete x[base+"/environments/savant-release/deployment-branch-policies"]],
  ["secret deployment config missing",x=>x[base+"/environments/savant-release"].protection_rules[0].reviewers=[]],
 ]){
   const input=fixture();mutate(input);
   const outcome=await auditGovernance(repo,reader(input));
   assert.equal(outcome.ready,false,k);
   assert.ok(!JSON.stringify(outcome).includes("confidential token"),k);
 }
 const many=fixture();
 many[base+"/rulesets?includes_parents=true"]=Array.from({length:251},(_,id)=>({id:id+1,target:"branch",enforcement:"active"}));
 assert.equal((await auditGovernance(repo,reader(many))).ready,false);
});
test("PER-1212: reject hostile repository input and ambiguous ref patterns",()=>{
 for(const input of ["","../x","owner/..","./repo","owner/foo/bar","https://example.com/x","owner/%2e%2e","owner/x?y",null])
   assert.throws(()=>assertRepository(input));
 assert.equal(assertRepository(repo),repo);
 const f=fixture();
 f[base+"/rulesets/11"].conditions.ref_name.include=["refs/heads/*"];
 assert.equal(evaluateRulesets(f[base+"/branches/main"],[f[base+"/rulesets/11"],f[base+"/rulesets/12"]]).main_review_rules,false);
 const env=f[base+"/environments/savant-release"];
 assert.equal(evaluateEnvironment(env,[{name:"*"}]).environment_main_only,false);
});
test("PER-1212: network adapter permits GET to GitHub only; never echoes tokens in errors",async()=>{
 const token="token-sensitive-secret-value";
 const urls=[];
 const read=makeGitHubReader({token,fetcher:async(url,options)=>{
   urls.push(url);
   assert.equal(options.method,"GET");
   assert.equal(options.redirect,"error");
   assert.equal(options.cache,"no-store");
   assert.equal(options.headers.Authorization,"Bearer "+token);
   return new Response(JSON.stringify({default_branch:"main"}),{status:200});
 }});
 assert.deepEqual(await read(base),{default_branch:"main"});
 assert.equal(urls[0],"https://api.github.com"+base);
 await assert.rejects(read("https://attacker.example/"),/invalid_api_path/);
 await assert.rejects(read(base+"/../../users"),/invalid_api_path/);
 assert.throws(()=>makeGitHubReader({token:"",fetcher:async()=>{}}),/missing_read_token/);
 const failed=makeGitHubReader({token,fetcher:async()=>new Response("sensitive error token="+token,{status:403})});
 await assert.rejects(failed(base),error=>error instanceof GovernanceAuditError &&
   error.code==="github_read_unavailable" && !error.message.includes(token));
 const thrower=makeGitHubReader({token,fetcher:async()=>{throw Error("token="+token);}});
 await assert.rejects(thrower(base),error=>!error.message.includes(token));
});
test("PER-1212: integration reads explicit fixed paths without modifying settings",async()=>{
 const obj=fixture(),requests=[];
 const report=await runGovernanceAudit({GITHUB_REPOSITORY:repo,GH_TOKEN:"read-only-access-placeholder"},{
  fetcher:async(url,opt)=>{
   requests.push({url,method:opt.method});
   const key=url.replace("https://api.github.com","");
   return new Response(JSON.stringify(obj[key]),{status:key in obj?200:404});
  }
 });
 assert.equal(report.ready,true);
 assert.equal(requests.length,8);
 assert.ok(requests.every(x=>x.method==="GET"));
 assert.equal(requests.some(x=>!x.url.startsWith("https://api.github.com/repos/"+repo)),false);
});
