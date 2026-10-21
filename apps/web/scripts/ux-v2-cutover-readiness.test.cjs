/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {evaluateCutoverEvidence,run,REQUIRED_SCREENS,WIDTHS,THEMES}=
  require("./ux-v2-cutover-readiness.cjs");
const sha="a".repeat(40);
const evidence=()=>({
  evidenceKind:"owner-authenticated-v2",executedAtUtc:new Date().toISOString(),
  origin:"https://savantskills.app",
  deployment:{environment:"production",state:"READY",id:"dpl_newReady123",gitSha:sha},
  owner:{authenticated:true,syntheticFixtures:true,networkMocksUsed:false},
  tenants:{a:"tenant-a",b:"tenant-b",denied:"tenant-c",separateData:true},
  rollout:{enabled:true,workspaces:"tenant-a,tenant-b",deployConfigReadbackVerified:true},
  ux:{screens:[...REQUIRED_SCREENS],viewportThemes:WIDTHS.flatMap(w=>THEMES.map(t=>w+"-"+t)),
    keyboardAndFocus:true,screenReaderReviewed:true,wcag22AAReviewed:true,
    routeHistory:true,screenshotsPrivate:true},
  security:{crossTenantSkillDenied:true,deniedWorkspaceDenied:true,
    invalidResourceIdsDenied:true,noCredentialsExposed:true,
    httpNegative:Object.fromEntries(["401","403","404","409","429","503"].map(x=>[x,true]))},
  provider:{recoverableNeonRestore:true,productionSchemaApplied:true,
    runtimeEncryptionKeysRecoverable:true,realProviderObservedRun:true,usageAndCostReconciled:true},
  rollback:{killSwitchTested:true,previousReadyDeployRestored:true,
    previousReadyDeploymentId:"dpl_priorReady456"},
  ownerSignOff:"approved",independentEvidenceReviewed:true,
  screenshots:REQUIRED_SCREENS.flatMap(screen=>WIDTHS.flatMap(width=>
    THEMES.map(theme=>({screen,width,theme,
      path:"/private/"+screen+"-"+width+"-"+theme+".png",
      sha256:crypto.createHash("sha256").update(screen+"-"+width+"-"+theme).digest("hex")}))))
});
test("cutover validator needs explicit complete real-evidence declarations",()=>{
  assert.deepEqual(evaluateCutoverEvidence(evidence(),sha).problems,[]);
  const partial=evidence();partial.owner.authenticated=false;
  assert.ok(evaluateCutoverEvidence(partial,sha).problems.includes("real_owner_Auth0_required"));
  assert.equal(evaluateCutoverEvidence(evidence(),"bad").eligible,false);
  const wrong=evidence();wrong.deployment.gitSha="b".repeat(40);
  assert.ok(evaluateCutoverEvidence(wrong,sha).problems.includes("deployment_revision_not_qualified"));
});
test("denies incomplete width/theme/screens, incompatible tenant fixtures, missing provider and rollback proof",()=>{
  const changes=[
    [e=>{e.ux.screens=[];},"missing_required_workspaces"],
    [e=>{e.ux.viewportThemes=["390-light"];},"responsive_theme_evidence_incomplete"],
    [e=>{e.screenshots.pop();},"screenshot_matrix_incomplete"],
    [e=>{e.tenants.b=e.tenants.a;},"three_isolated_tenant_fixtures_required"],
    [e=>{e.rollout.workspaces="*";},"explicit_synthetic_workspace_canary_required"],
    [e=>{e.rollout.workspaces="tenant-a,tenant-b,tenant-c";},"explicit_synthetic_workspace_canary_required"],
    [e=>{e.rollout.deployConfigReadbackVerified=false;},"explicit_synthetic_workspace_canary_required"],
    [e=>{e.screenshots[1].path=e.screenshots[0].path;},"screenshot_matrix_incomplete"],
    [e=>{e.screenshots[1].sha256=e.screenshots[0].sha256;},"screenshot_matrix_incomplete"],
    [e=>{e.security.httpNegative["503"]=false;},"negative_http_evidence_incomplete"],
    [e=>{e.provider.recoverableNeonRestore=false;},"production_test_bench_and_provider_evidence_missing"],
    [e=>{e.rollback.killSwitchTested=false;},"reversible_release_not_witnessed"],
    [e=>{e.ownerSignOff="draft";},"owner_release_signoff_missing"],
    [e=>{e.owner.networkMocksUsed=true;},"real_owner_Auth0_required"],
    [e=>{e.ux.screenReaderReviewed=false;},"screen_reader_review_missing"],
  ];
  for(const [mutate,code] of changes){
    const e=evidence();mutate(e);
    assert.ok(evaluateCutoverEvidence(e,sha).problems.includes(code),code);
  }
});
test("stale, future, or wrong-origin evidence is denied",()=>{
 const e=evidence();e.executedAtUtc="2020-01-01T00:00:00Z";
 assert.ok(evaluateCutoverEvidence(e,sha).problems.includes("evidence_missing_or_stale"));
 e.executedAtUtc=new Date(Date.now()+86400000).toISOString();
 assert.ok(evaluateCutoverEvidence(e,sha).problems.includes("evidence_missing_or_stale"));
 e.executedAtUtc=new Date().toISOString();e.origin="https://malicious.savantskills.app";
 assert.ok(evaluateCutoverEvidence(e,sha).problems.includes("noncanonical_production_origin"));
});
test("private receipt and screenshot bytes are checked; Git-local and forged screenshots rejected",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ux-cutover-"));
 try{
  const e=evidence();
  e.screenshots=e.screenshots.map((shot,index)=>{
    const image=path.join(dir,shot.screen+"-"+shot.width+"-"+shot.theme+".png");
    const bytes=Buffer.from("private-acceptance-capture-"+index);
    fs.writeFileSync(image,bytes);
    const hash=crypto.createHash("sha256").update(bytes).digest("hex");
    return {...shot,path:image,sha256:hash};
  });
  const manifest=path.join(dir,"receipt.json");fs.writeFileSync(manifest,JSON.stringify(e));
  const options={SAVANT_UX_READINESS_RECEIPT:manifest,SAVANT_UX_EXPECTED_MAIN_SHA:sha};
  assert.equal(run(options).eligible,true);
  fs.writeFileSync(e.screenshots[0].path,"altered");
  assert.deepEqual(run(options),{eligible:false,problems:["screenshot_integrity_failed"]});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("release evaluator is deliberately read-only, never changes Vercel or database credentials",()=>{
 const src=fs.readFileSync(path.join(__dirname,"ux-v2-cutover-readiness.cjs"),"utf8");
 assert.doesNotMatch(src,/vercel api|\.post\(|\.put\(|\.delete\(|fetch\(|execSync\(|spawnSync\(|process\.env\.SAVANT_UI_V2_ENABLED\s*=/);
 assert.match(src,/Operator must independently verify external services/);
});
