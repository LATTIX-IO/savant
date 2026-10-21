/* eslint-disable @typescript-eslint/no-require-imports -- operator-only read-only release guard */
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

const SHA=/^[0-9a-f]{40}$/i;
const HASH=/^[0-9a-f]{64}$/i;
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const REQUIRED_SCREENS=["overview","library","workbench","evaluations","runs",
  "insights","integrations","settings"];
const WIDTHS=[390,768,1280,1440];
const THEMES=["light","dark"];
const STATUS_CODES=["401","403","404","409","429","503"];
const HOSTS=new Set(["https://savantskills.app","https://www.savantskills.app",
  "https://savantrepo.com","https://www.savantrepo.com"]);
function evaluateCutoverEvidence(receipt,expectedSha,now=Date.now()){
  const problems=[];
  const fail=(condition,code)=>{if(!condition)problems.push(code);};
  const r=receipt&&typeof receipt==="object"&&!Array.isArray(receipt)?receipt:{};
  const o=r.owner??{},dep=r.deployment??{},tenants=r.tenants??{},
    ux=r.ux??{},sec=r.security??{},provider=r.provider??{},rollback=r.rollback??{},
    rollout=r.rollout??{};
  fail(SHA.test(expectedSha??""),"exact_main_sha_required");
  fail(r.evidenceKind==="owner-authenticated-v2","untrusted_evidence_kind");
  const timestamp=Date.parse(r.executedAtUtc??"");
  fail(Number.isFinite(timestamp)&&timestamp<=now&&now-timestamp<=72*3600000,
    "evidence_missing_or_stale");
  fail(HOSTS.has(r.origin),"noncanonical_production_origin");
  fail(dep.environment==="production"&&dep.state==="READY"&&
      typeof dep.id==="string"&&/^dpl_[A-Za-z0-9]+$/.test(dep.id)&&
      SHA.test(dep.gitSha??"")&&dep.gitSha===expectedSha,"deployment_revision_not_qualified");
  fail(o.authenticated===true&&o.syntheticFixtures===true&&o.networkMocksUsed===false,
    "real_owner_Auth0_required");
  const ids=[tenants.a,tenants.b,tenants.denied];
  fail(ids.every(v=>typeof v==="string"&&SLUG.test(v))&&
    new Set(ids).size===3&&tenants.separateData===true,
    "three_isolated_tenant_fixtures_required");
  // Explicit *two-workspace* canary must precede a canonical default-on decision.
  // Treat the saved environment readback as an operator attestation, not proof
  // that this script queried production Vercel configuration.
  const pilotWorkspaces=typeof rollout.workspaces==="string"
    ?rollout.workspaces.split(",").map(s=>s.trim()).filter(Boolean):[];
  fail(rollout.enabled===true && rollout.deployConfigReadbackVerified===true &&
    pilotWorkspaces.length===2 && new Set(pilotWorkspaces).size===2 &&
    pilotWorkspaces.every(s=>s===tenants.a||s===tenants.b) &&
    pilotWorkspaces.includes(tenants.a) && pilotWorkspaces.includes(tenants.b),
    "explicit_synthetic_workspace_canary_required");
  const screens=Array.isArray(ux.screens)?ux.screens:[];
  fail(REQUIRED_SCREENS.every(s=>screens.includes(s)),"missing_required_workspaces");
  const variants=Array.isArray(ux.viewportThemes)?ux.viewportThemes:[];
  fail(WIDTHS.every(width=>THEMES.every(theme=>variants.includes(width+"-"+theme))),
    "responsive_theme_evidence_incomplete");
  for(const [field,code] of [
    ["keyboardAndFocus","keyboard_focus_missing"],
    ["screenReaderReviewed","screen_reader_review_missing"],
    ["wcag22AAReviewed","accessibility_review_missing"],
    ["routeHistory","history_deep_links_missing"],
    ["screenshotsPrivate","screenshots_not_protected"],
  ])fail(ux[field]===true,code);
  fail(sec.crossTenantSkillDenied===true&&sec.deniedWorkspaceDenied===true&&
    sec.invalidResourceIdsDenied===true&&sec.noCredentialsExposed===true,
    "tenant_and_security_boundary_missing");
  fail(STATUS_CODES.every(code=>sec.httpNegative?.[code]===true),
    "negative_http_evidence_incomplete");
  fail(provider.recoverableNeonRestore===true&&provider.productionSchemaApplied===true&&
    provider.runtimeEncryptionKeysRecoverable===true&&
    provider.realProviderObservedRun===true&&provider.usageAndCostReconciled===true,
    "production_test_bench_and_provider_evidence_missing");
  fail(rollback.killSwitchTested===true&&rollback.previousReadyDeployRestored===true&&
    typeof rollback.previousReadyDeploymentId==="string"&&
    /^dpl_[A-Za-z0-9]+$/.test(rollback.previousReadyDeploymentId)&&
    rollback.previousReadyDeploymentId!==dep.id,"reversible_release_not_witnessed");
  fail(r.ownerSignOff==="approved"&&r.independentEvidenceReviewed===true,
    "owner_release_signoff_missing");
  const images=Array.isArray(r.screenshots)?r.screenshots:[];
  const keyed=new Set();
  const imagePaths=new Set();
  const imageHashes=new Set();
  let imagesWellFormed=true;
  for(const img of images){
    const key=img?.screen+"-"+img?.width+"-"+img?.theme;
    if(!REQUIRED_SCREENS.includes(img?.screen)||!WIDTHS.includes(img?.width)||
       !THEMES.includes(img?.theme)||keyed.has(key)||typeof img?.path!=="string"||
       !path.isAbsolute(img.path)||!HASH.test(img?.sha256??"") ||
       imagePaths.has(path.normalize(img.path)) || imageHashes.has(img.sha256.toLowerCase())){
      imagesWellFormed=false;continue;
    }
    keyed.add(key);
    imagePaths.add(path.normalize(img.path));
    imageHashes.add(img.sha256.toLowerCase());
  }
  fail(imagesWellFormed&&REQUIRED_SCREENS.every(screen=>WIDTHS.every(width=>
    THEMES.every(theme=>keyed.has(screen+"-"+width+"-"+theme)))),
    "screenshot_matrix_incomplete");
  return {eligible:problems.length===0,problems};
}

/**
 * Read-only CLI. External deployment, Auth0, tenant, WCAG, provider and restore
 * claims are operator attestations, NOT independently verified by this script.
 * An eligible receipt is necessary but not sufficient for human promotion.
 */
function run(env=process.env){
  const input=env.SAVANT_UX_READINESS_RECEIPT;
  const expectedSha=env.SAVANT_UX_EXPECTED_MAIN_SHA;
  if(typeof input!=="string"||!path.isAbsolute(input)||
    !SHA.test(expectedSha??""))throw Error("Private absolute receipt and exact main SHA required.");
  const root=path.resolve(__dirname,"../../..");
  const real=fs.realpathSync(input);
  if(real===root||real.startsWith(root+path.sep))throw Error("Receipt cannot be in Git.");
  const stat=fs.statSync(real);
  if(!stat.isFile()||stat.size>65536)throw Error("Invalid private receipt file.");
  const receipt=JSON.parse(fs.readFileSync(real,"utf8"));
  const result=evaluateCutoverEvidence(receipt,expectedSha);
  if(!result.eligible)return result;
  const verifiedPaths=new Set();
  for(const shot of receipt.screenshots){
    const imagePath=fs.realpathSync(shot.path);
    const imageStat=fs.statSync(imagePath);
    if(imagePath===root||imagePath.startsWith(root+path.sep)||
      verifiedPaths.has(imagePath)||
      !imageStat.isFile() || imageStat.size<1 || imageStat.size>20*1024*1024 ||
      crypto.createHash("sha256").update(fs.readFileSync(imagePath)).digest("hex")!==shot.sha256){
      return {eligible:false,problems:["screenshot_integrity_failed"]};
    }
    verifiedPaths.add(imagePath);
  }
  return result;
}
if(require.main===module){
  try{
    const result=run();
    if(!result.eligible){
      process.stderr.write("HOLD Savant v2 canonical cutover: "+result.problems.join(", ")+"\n");
      process.exitCode=1;
    }else{
      process.stdout.write("REVIEW-ELIGIBLE: local receipt shape, freshness and screenshot hashes checked. "+
        "Operator must independently verify external services and approve separately. No settings changed.\n");
    }
  }catch{
    process.stderr.write("HOLD Savant v2 canonical cutover: private or invalid evidence.\n");
    process.exitCode=1;
  }
}
module.exports={evaluateCutoverEvidence,run,REQUIRED_SCREENS,WIDTHS,THEMES};
