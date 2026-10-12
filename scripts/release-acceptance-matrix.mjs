import { parseEvidenceRequest, verifySourceReleaseEvidence } from "./release-uat-evidence.mjs";
import { parseNegativeEvidenceRequest, verifyNegativeReleaseEvidence } from "./release-negative-uat.mjs";
import { runGovernanceAudit } from "./release-controls-audit.mjs";

const REPOSITORY="LATTIX-IO/savant";
const POSITIVE_CHECKS=[
  "tagCommit","remoteTag","releaseAssets","checksums","provenance",
  "remoteDigests","workflowRun","independentEnvironmentApproval","signedAttestation"
];
const NEGATIVE_CHECKS=[
  "runIdentity","unsuccessfulRun","publicationNotSuccessful",
  "scenarioEvidence","targetReleaseAbsent"
];
const GOVERNANCE_CHECKS=[
  "main_default_branch","main_protected","main_review_rules",
  "version_tag_immutable","environment_reviewers","self_review_prevented",
  "environment_main_only","publication_state_matches_expected"
];
const HEX=/^[0-9a-f]{64}$/;
const RUN=/^[1-9][0-9]{0,18}$/;

export class AcceptanceMatrixError extends Error {
  constructor(code){super(code);this.name="AcceptanceMatrixError";this.code=code;}
}
function fail(code){throw new AcceptanceMatrixError(code);}
function safeToken(value){
  return typeof value==="string"&&value.trim().length>=10&&!/[\r\n]/.test(value);
}
function evidenceEnv(env,prefix){
  return {
    GITHUB_REPOSITORY:env.GITHUB_REPOSITORY,
    SAVANT_EVIDENCE_VERSION:env[prefix+"_VERSION"],
    SAVANT_EVIDENCE_COMMIT:env[prefix+"_COMMIT"],
    SAVANT_EVIDENCE_RUN_ID:env[prefix+"_RUN_ID"]
  };
}
/**
 * No default version/run selection: operators must identify exact,
 * independently authorized UAT attempts in the current repository.
 */
export function parseAcceptanceMatrixRequest(env=process.env) {
  if(env.GITHUB_REPOSITORY!==REPOSITORY)fail("matrix_repository_not_allowed");
  let positive,preflight,approval;
  try{
    positive=parseEvidenceRequest(evidenceEnv(env,"SAVANT_ACCEPT_SUCCESS"));
    preflight=parseNegativeEvidenceRequest({
      ...evidenceEnv(env,"SAVANT_ACCEPT_PREFLIGHT"),
      SAVANT_NEGATIVE_SCENARIO:"preflight_denied"
    });
    approval=parseNegativeEvidenceRequest({
      ...evidenceEnv(env,"SAVANT_ACCEPT_DENIAL"),
      SAVANT_NEGATIVE_SCENARIO:"approval_denied"
    });
  }catch{fail("matrix_request_invalid");}
  const refs=[positive,preflight,approval];
  if(refs.some(x=>x.repository!==REPOSITORY||!RUN.test(x.runId)) ||
      new Set(refs.map(x=>x.runId)).size!==3 ||
      new Set(refs.map(x=>x.version)).size!==3)fail("matrix_evidence_reused");
  return {repository:REPOSITORY,positive,preflight,approval};
}
function strictChecks(report,names){
  const found=report?.checks;
  if(!found||typeof found!=="object"||Array.isArray(found)||
     Object.keys(found).length!==names.length ||
     !names.every(name=>Object.hasOwn(found,name)&&found[name]===true))
    fail("matrix_incomplete_checks");
}
function identity(report,ref,schema){
  if(!report||report.schema!==schema||report.ready!==true||
     report.repository!==REPOSITORY||report.version!==ref.version||
     report.commit!==ref.commit||report.workflowRunId!==ref.runId)
    fail("matrix_evidence_identity_mismatch");
}
export function validateMatrixEvidence(request,{governance,successful,preflight,approval}={}){
  if(request?.repository!==REPOSITORY)fail("matrix_request_invalid");
  const refs=[request.positive,request.preflight,request.approval];
  if(refs.some(x=>x?.repository!==REPOSITORY||!RUN.test(String(x?.runId||""))) ||
     new Set(refs.map(x=>x.runId)).size!==3 ||
     new Set(refs.map(x=>x.version)).size!==3)fail("matrix_evidence_reused");
  if(governance?.schema!=="savant.release-controls.audit.v2" ||
     governance.repository!==REPOSITORY || governance.mode!=="audit" ||
     governance.ready!==true || !Array.isArray(governance.problems) ||
     governance.problems.length!==0)fail("matrix_governance_unverified");
  strictChecks(governance,GOVERNANCE_CHECKS);
  identity(successful,request.positive,"savant.release-uat-evidence.v2");
  strictChecks(successful,POSITIVE_CHECKS);
  if(successful.verifiedSignerWorkflow!==
      "github.com/LATTIX-IO/savant/.github/workflows/publish-source-release.yml")
    fail("matrix_signer_unverified");
  if(typeof successful.sha256!=="string" || !HEX.test(successful.sha256) ||
     !Array.isArray(successful.assets) || successful.assets.length!==3 ||
     successful.assets.some(a=>typeof a?.name!=="string" || !HEX.test(a.sha256||"") ||
        !Number.isSafeInteger(a.bytes)||a.bytes<1) ||
     new Set(successful.assets.map(a=>a.name)).size!==3)
    fail("matrix_release_artifacts_unverified");
  const expected=new Set([
    "savant-"+request.positive.version+".tar.gz","SHA256SUMS","release-provenance.json"
  ]);
  if(successful.assets.some(a=>!expected.has(a.name)) ||
     successful.assets.find(a=>a.name==="savant-"+request.positive.version+".tar.gz")?.sha256!==successful.sha256)
    fail("matrix_release_artifacts_unverified");
  identity(preflight,request.preflight,"savant.release-negative-uat.v1");
  if(preflight.scenario!=="preflight_denied")fail("matrix_negative_scenario_mismatch");
  strictChecks(preflight,NEGATIVE_CHECKS);
  identity(approval,request.approval,"savant.release-negative-uat.v1");
  if(approval.scenario!=="approval_denied")fail("matrix_negative_scenario_mismatch");
  strictChecks(approval,NEGATIVE_CHECKS);
  return {
    schema:"savant.release-acceptance-matrix.v1",ready:true,repository:REPOSITORY,
    currentGovernanceMode:"audit",publicationEnabled:false,
    successful:{version:request.positive.version,commit:request.positive.commit,
      runId:request.positive.runId,sha256:successful.sha256},
    negative:[
      {scenario:"preflight_denied",version:request.preflight.version,runId:request.preflight.runId},
      {scenario:"approval_denied",version:request.approval.version,runId:request.approval.runId}
    ],
    checks:{currentGovernanceDisabled:true,sourceReleaseVerified:true,
      independentApprovalVerified:true,preflightRefusalVerified:true,
      protectedEnvironmentDenialVerified:true,nonpublicationVerified:true}
  };
}
/**
 * Live path always invokes actual source verifiers and the governance API.
 * Dependencies may be injected only for hermetic unit/integration tests.
 * The resulting report is an observation, not an authorization to publish.
 */
export async function runReleaseAcceptanceMatrix(env=process.env,{
  governance=runGovernanceAudit,
  successful=verifySourceReleaseEvidence,
  negative=verifyNegativeReleaseEvidence,
  fetcher=fetch,
  runner,
  git
}={}){
  const request=parseAcceptanceMatrixRequest(env);
  if(!safeToken(env.GH_TOKEN)||!safeToken(env.SAVANT_GOVERNANCE_EVIDENCE_TOKEN))
    fail("matrix_read_credentials_missing");
  if(env.GH_TOKEN===env.SAVANT_GOVERNANCE_EVIDENCE_TOKEN)
    fail("matrix_credentials_not_separated");
  let governanceResult,successResult,preflightResult,approvalResult;
  try{
    governanceResult=await governance({
      GITHUB_REPOSITORY:REPOSITORY,GH_TOKEN:env.SAVANT_GOVERNANCE_EVIDENCE_TOKEN,
      SAVANT_GOVERNANCE_MODE:"audit"
    },{fetcher});
    if(governanceResult?.ready!==true)fail("matrix_governance_unverified");
    strictChecks(governanceResult,GOVERNANCE_CHECKS);
    successResult=await successful(request.positive,{
      token:env.GH_TOKEN,fetcher,...(runner?{runner}:{}),...(git?{git}:{})
    });
    preflightResult=await negative(request.preflight,{token:env.GH_TOKEN,fetcher});
    approvalResult=await negative(request.approval,{token:env.GH_TOKEN,fetcher});
  }catch(e){if(e instanceof AcceptanceMatrixError)throw e;fail("matrix_live_evidence_unavailable");}
  return validateMatrixEvidence(request,{
    governance:governanceResult,successful:successResult,
    preflight:preflightResult,approval:approvalResult
  });
}
if(process.argv[1]?.endsWith("/release-acceptance-matrix.mjs")){
  try{
    console.log(JSON.stringify(await runReleaseAcceptanceMatrix(),null,2));
  }catch(e){
    console.error(JSON.stringify({schema:"savant.release-acceptance-matrix.v1",
      ready:false,code:e instanceof AcceptanceMatrixError?e.code:"matrix_execution_failed"}));
    process.exitCode=1;
  }
}
