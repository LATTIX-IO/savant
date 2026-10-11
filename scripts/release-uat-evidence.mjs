import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { archiveName, classifyExistingRelease, run, validateBundle,
  validatePublishRequest, verifyGitTag } from "./release-publication.mjs";
import { inspectExistingRelease } from "./release-publish.mjs";

const REPOSITORY="LATTIX-IO/savant";
const DIGEST=/^[0-9a-f]{64}$/;
const SIGNER="github.com/LATTIX-IO/savant/.github/workflows/publish-source-release.yml";
const MAX_ATTESTATION_BYTES=1024*1024;
export class ReleaseEvidenceError extends Error{
  constructor(code){super(code);this.name="ReleaseEvidenceError";this.code=code;}
}
function deny(code){throw new ReleaseEvidenceError(code);}
export function parseEvidenceRequest(env=process.env){
  if(env.GITHUB_REPOSITORY!==REPOSITORY)deny("repository_not_allowed");
  const version=env.SAVANT_EVIDENCE_VERSION;
  const commit=env.SAVANT_EVIDENCE_COMMIT;
  const runId=env.SAVANT_EVIDENCE_RUN_ID;
  let request;
  try{
    request=validatePublishRequest({
      version,commit,runId,mainCommit:commit,repository:REPOSITORY,
      ref:"refs/heads/main",enabled:"true",confirmation:"PUBLISH "+version
    });
  }catch{deny("invalid_evidence_request");}
  return request;
}
export async function verifyRemoteTag(request,token,fetcher=fetch){
  const sha=/^[0-9a-f]{40}$/;
  if(request?.repository!==REPOSITORY || typeof request?.version!=="string" ||
     !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(request.version) ||
     !sha.test(request.commit||"") || typeof token!=="string" || token.length<10)
    deny("remote_tag_invalid_request");
  const base="https://api.github.com/repos/"+REPOSITORY;
  async function get(path){
    let response;
    try{
      response=await fetcher(base+path,{
        method:"GET",redirect:"error",cache:"no-store",
        headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
          "X-GitHub-Api-Version":"2022-11-28"},
        signal:AbortSignal.timeout(15000)
      });
      if(response.status!==200)deny("remote_tag_unavailable");
      const raw=await response.text();
      if(raw.length>65536)deny("remote_tag_invalid_response");
      return JSON.parse(raw);
    }catch{deny("remote_tag_unavailable");}
  }
  let target=(await get("/git/ref/tags/"+request.version))?.object;
  const seen=new Set();
  for(let i=0;i<4;i++){
    if(!target || !sha.test(target.sha||""))deny("remote_tag_invalid_response");
    if(target.type==="commit"){
      if(target.sha!==request.commit)deny("remote_tag_commit_mismatch");
      return true;
    }
    if(target.type!=="tag" || seen.has(target.sha))deny("remote_tag_invalid_response");
    seen.add(target.sha);
    target=(await get("/git/tags/"+target.sha))?.object;
  }
  deny("remote_tag_invalid_response");
}

export function validateRemoteRelease(release,request){
  if(!release)deny("release_not_published");
  const names=[archiveName(request.version),"SHA256SUMS","release-provenance.json"].sort();
  if(release.tagName!==request.version || release.isDraft!==false ||
    release.isPrerelease!==request.version.includes("-") || !Array.isArray(release.assets) ||
    release.assets.length!==3 || release.assets.map(a=>a.name).sort().join("|")!==names.join("|"))
    deny("unexpected_release_metadata");
  for(const item of release.assets){
    if(!Number.isSafeInteger(item.size)||item.size<1||
       item.size>(item.name===archiveName(request.version)?150*1024*1024:1024*1024) ||
       typeof item.digest!=="string"|| !DIGEST.test(item.digest.slice(7)) ||
       !item.digest.startsWith("sha256:"))
      deny("unverifiable_remote_asset");
  }
  return true;
}
export function verifySignedAttestation(raw, digest, request){
  let value;
  try{
    if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>MAX_ATTESTATION_BYTES)deny("attestation_result_invalid");
    value=JSON.parse(raw.toString("utf8"));
  }catch{deny("attestation_result_invalid");}
  if(!Array.isArray(value)||value.length===0||value.length>30)deny("attestation_result_invalid");
  if(!request || request.repository!==REPOSITORY ||
    !/^[1-9][0-9]{0,19}$/.test(String(request.runId||"")))deny("attestation_run_unverified");
  const expectedRun="https://github.com/"+REPOSITORY+"/actions/runs/"+request.runId+"/attempts/";

  const valid=value.some(item=>{
    const statement=item?.verificationResult?.statement;
    const uri=item?.verificationResult?.signature?.certificate?.runInvocationURI;
    return typeof uri==="string" && uri.startsWith(expectedRun) &&
      /^[1-9][0-9]*$/.test(uri.slice(expectedRun.length)) &&
      statement?.predicateType==="https://slsa.dev/provenance/v1" &&
      Array.isArray(statement.subject) &&
      statement.subject.some(subject=>subject?.digest?.sha256===digest);
  });
  if(!valid)deny("attestation_subject_mismatch");
  return true;
}
export async function verifySuccessfulPublicationRun(request,token,fetcher=fetch){
  const base="https://api.github.com/repos/"+REPOSITORY+"/actions/runs/"+request.runId;
  async function get(url){
    try{
      const response=await fetcher(url,{
        method:"GET",redirect:"error",cache:"no-store",
        headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
          "X-GitHub-Api-Version":"2022-11-28"},
        signal:AbortSignal.timeout(15000)
      });
      if(response.status!==200)deny("workflow_run_unavailable");
      const raw=await response.text();
      if(raw.length>512*1024)deny("workflow_run_unavailable");
      return JSON.parse(raw);
    }catch{deny("workflow_run_unavailable");}
  }
  const run=await get(base);
  if(String(run?.id)!==request.runId || run?.head_sha!==request.commit ||
     run?.path!==".github/workflows/publish-source-release.yml" ||
     run?.head_branch!=="main" || run?.event!=="workflow_dispatch" ||
     run?.status!=="completed" || run?.conclusion!=="success" ||
     run?.repository?.full_name!==REPOSITORY)
    deny("workflow_run_unverified");
  const jobs=await get(base+"/jobs?per_page=100");
  if(!Array.isArray(jobs?.jobs) || !Number.isSafeInteger(jobs?.total_count) ||
     jobs.total_count!==jobs.jobs.length || jobs.jobs.length<2)
    deny("workflow_jobs_unverified");
  for(const name of ["Verify, test and attest tagged source",
    "Publish only after protected environment approval"]){
    if(jobs.jobs.filter(job=>job.name===name && job.status==="completed" &&
      job.conclusion==="success").length!==1)deny("workflow_jobs_unverified");
  }
  return true;
}

export async function verifySourceReleaseEvidence(request,{
  token=process.env.GH_TOKEN,fetcher=fetch,runner=run,git=run
}={}){
  if(request?.repository!==REPOSITORY)deny("repository_not_allowed");
  if(typeof token!=="string"||token.length<10||/[\r\n]/.test(token))deny("missing_read_token");
  // Revalidate all untrusted inputs before invoking local Git or GitHub CLI.
  const canonical=parseEvidenceRequest({
    GITHUB_REPOSITORY:REPOSITORY,SAVANT_EVIDENCE_VERSION:request.version,
    SAVANT_EVIDENCE_COMMIT:request.commit,SAVANT_EVIDENCE_RUN_ID:request.runId
  });
  try{verifyGitTag(canonical,git);}catch{deny("tag_source_unverified");}
  await verifyRemoteTag(canonical,token,fetcher);
  let published;
  try{published=await inspectExistingRelease(canonical,token,fetcher);}
  catch{deny("remote_release_unavailable");}
  validateRemoteRelease(published,canonical);
  await verifySuccessfulPublicationRun(canonical,token,fetcher);
  const dir=mkdtempSync(join(tmpdir(),"savant-uat-evidence-"));
  try{
    try{
      runner("gh",["release","download",canonical.version,"--repo",REPOSITORY,"--dir",dir],{timeout:120000});
    }catch{deny("release_download_failed");}
    let bundle;
    try{bundle=validateBundle(dir,canonical);}
    catch{deny("download_integrity_failed");}
    try{classifyExistingRelease(published,canonical,bundle);}
    catch{deny("remote_digest_mismatch");}
    let attestation;
    try{
      attestation=runner("gh",[
        "attestation","verify",join(dir,archiveName(canonical.version)),
        "--repo",REPOSITORY,"--source-digest",canonical.commit,
        "--source-ref","refs/heads/main",
        "--signer-workflow",SIGNER,
        "--deny-self-hosted-runners","--format","json"
      ],{timeout:120000});
    }catch{deny("signed_attestation_unverified");}
    verifySignedAttestation(attestation,bundle.digest,canonical);
    return {
      schema:"savant.release-uat-evidence.v1",ready:true,
      repository:REPOSITORY,version:canonical.version,commit:canonical.commit,
      workflowRunId:canonical.runId,verifiedSignerWorkflow:SIGNER,
      sha256:bundle.digest,
      assets:Object.keys(bundle.files).sort().map(name=>({
        name,sha256:bundle.files[name].sha256,bytes:bundle.files[name].bytes
      })),
      checks:{tagCommit:true,remoteTag:true,releaseAssets:true,checksums:true,provenance:true,
        remoteDigests:true,workflowRun:true,signedAttestation:true}
    };
  }finally{rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]?.endsWith("/release-uat-evidence.mjs")){
  try{
    const request=parseEvidenceRequest();
    const evidence=await verifySourceReleaseEvidence(request);
    console.log(JSON.stringify(evidence,null,2));
  }catch(e){
    console.error(JSON.stringify({schema:"savant.release-uat-evidence.v1",ready:false,
      code:e instanceof ReleaseEvidenceError?e.code:"release_evidence_failed"}));
    process.exitCode=1;
  }
}
