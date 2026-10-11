import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditGovernance, runGovernanceAudit, GovernanceAuditError } from "./release-controls-audit.mjs";

const repo = "LATTIX-IO/savant";
const base = "/repos/" + repo;
function governanceFixture(flag="false") {
  return {
    [base]:{default_branch:"main"},
    [base+"/branches/main"]:{name:"main",protected:true},
    [base+"/rulesets?includes_parents=true&per_page=100"]:[
      {id:11,target:"branch",enforcement:"active"},
      {id:12,target:"tag",enforcement:"active"}],
    [base+"/rulesets/11"]:{id:11,target:"branch",enforcement:"active",bypass_actors:[],
      conditions:{ref_name:{include:["refs/heads/main"],exclude:[]}},
      rules:[{type:"pull_request",parameters:{required_approving_review_count:1}},
        {type:"required_status_checks",parameters:{required_status_checks:[{context:"Savant unit, type, lint, build and secrets"}]}}]},
    [base+"/rulesets/12"]:{id:12,target:"tag",enforcement:"active",bypass_actors:[],
      conditions:{ref_name:{include:["refs/tags/v*"],exclude:[]}},
      rules:[{type:"deletion"},{type:"update"}]},
    [base+"/environments/savant-release"]:{name:"savant-release",
      protection_rules:[{type:"required_reviewers",prevent_self_review:true,
        reviewers:[{type:"User",reviewer:{id:20}}]}],
      deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}},
    [base+"/environments/savant-release/deployment-branch-policies"]:
      {branch_policies:[{name:"main"}],total_count:1},
    [base+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED"]:
      {name:"SAVANT_RELEASE_PUBLISH_ENABLED",value:flag}
  };
}
const adapter = state => async path => {
  if(!(path in state))throw Error("secret auth rejection");
  return state[path];
};
test("PER-1216: disabled-by-default audit and enabled-only publish modes have separate valid states",async()=>{
  const inspect=await auditGovernance(repo,adapter(governanceFixture("false")));
  assert.equal(inspect.ready,true);
  assert.equal(inspect.mode,"audit");
  assert.equal(inspect.checks.publication_state_matches_expected,true);
  const publishing=await auditGovernance(repo,adapter(governanceFixture("true")),{mode:"publish"});
  assert.equal(publishing.ready,true);
  assert.equal(publishing.mode,"publish");
  assert.equal(publishing.checks.publication_state_matches_expected,true);
  assert.equal((await auditGovernance(repo,adapter(governanceFixture("true")))).ready,false);
  assert.equal((await auditGovernance(repo,adapter(governanceFixture("false")),{mode:"publish"})).ready,false);
});
test("PER-1216: forged or unknown gate mode rejected before any API access",async()=>{
  for(const mode of ["", "Publish", "disabled", "publish;echo exploit", null, {}, 0]){
    let calls=0;
    await assert.rejects(async()=>auditGovernance(repo,async()=>{calls++;return {};},{mode}),e=>
      e instanceof GovernanceAuditError && e.code==="invalid_governance_mode");
    assert.equal(calls,0);
  }
});
test("PER-1216: publishing fails closed on revoked reviewers, rule bypass, missing controls and API outage",async()=>{
  const mutations=[
    state=>state[base+"/environments/savant-release"].protection_rules=[],
    state=>state[base+"/rulesets/12"].rules=[{type:"deletion"}],
    state=>state[base+"/rulesets/11"].bypass_actors=[{actor_type:"OrganizationAdmin",actor_id:1,bypass_mode:"always"}],
    state=>state[base+"/actions/variables/SAVANT_RELEASE_PUBLISH_ENABLED"].value="false",
    state=>{delete state[base+"/environments/savant-release/deployment-branch-policies"];}
  ];
  for(const mutate of mutations) {
    const state=governanceFixture("true");
    mutate(state);
    const result=await auditGovernance(repo,adapter(state),{mode:"publish"});
    assert.equal(result.ready,false);
    assert.ok(result.problems.length);
    assert.doesNotMatch(JSON.stringify(result),/secret auth rejection/);
  }
});
test("PER-1216: runtime publish mode uses read-only fixed API calls and redacts credential",async()=>{
  const state=governanceFixture("true");
  const token="read-only-super-secret-token";
  const methods=[];
  const report=await runGovernanceAudit({
    GITHUB_REPOSITORY:repo,GH_TOKEN:token,SAVANT_GOVERNANCE_MODE:"publish"
  },{
    fetcher:async(url,options)=>{
      methods.push(options.method);
      assert.equal(options.headers.Authorization,"Bearer "+token);
      const key=url.replace("https://api.github.com","");
      return new Response(JSON.stringify(state[key]),{status:key in state?200:403});
    }
  });
  assert.equal(report.ready,true);
  assert.ok(methods.length>=8);
  assert.deepEqual([...new Set(methods)],["GET"]);
  assert.doesNotMatch(JSON.stringify(report),/secret|reviewer.*20/);
  await assert.rejects(runGovernanceAudit({
    GITHUB_REPOSITORY:repo,GH_TOKEN:"",SAVANT_GOVERNANCE_MODE:"publish"
  }),/missing_read_token/);
});
test("PER-1216: publishing workflow gates write after protected approval with scoped admin read token",()=>{
  const workflow=readFileSync(".github/workflows/publish-source-release.yml","utf8");
  const protectedJob=workflow.slice(workflow.indexOf("\n  publish:"));
  const auditStep=protectedJob.indexOf("node scripts/release-controls-audit.mjs");
  const writeStep=protectedJob.indexOf("node scripts/release-publish.mjs");
  assert.ok(protectedJob.includes("environment:\n      name: savant-release"));
  assert.ok(auditStep>0 && writeStep>auditStep);
  assert.match(protectedJob,/SAVANT_GOVERNANCE_MODE: publish/);
  assert.match(protectedJob,/GH_TOKEN: \$\{\{ secrets\.SAVANT_GOVERNANCE_READ_TOKEN \}\}/);
  assert.match(protectedJob,/permissions:\n      contents: write/);
  assert.ok(!workflow.slice(0,workflow.indexOf("\n  publish:")).includes("secrets.SAVANT_GOVERNANCE_READ_TOKEN"));
  assert.ok(protectedJob.indexOf("node scripts/release-controls-audit.mjs")<
    protectedJob.indexOf("gh attestation verify"));
  assert.doesNotMatch(workflow,/^\s*(push|pull_request|workflow_run|schedule):\s*$/m);
});
