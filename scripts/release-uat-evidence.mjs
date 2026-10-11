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
export function verifySignedAttestation(raw, digest){
  let value;
  try{
    if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>MAX_ATTESTATION_BYTES)deny("attestation_result_invalid");
    value=JSON.parse(raw.toString("utf8"));
  }catch{deny("attestation_result_invalid");}
  if(!Array.isArray(value)||value.length===0||value.length>30)deny("attestation_result_invalid");
  const valid=value.some(item=>{
    const statement=item?.verificationResult?.statement;
    return statement?.predicateType==="https://slsa.dev/provenance/v1" &&
      Array.isArray(statement.subject) &&
      statement.subject.some(subject=>subject?.digest?.sha256===digest);
  });
  if(!valid)deny("attestation_subject_mismatch");
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
  let published;
  try{published=await inspectExistingRelease(canonical,token,fetcher);}
  catch{deny("remote_release_unavailable");}
  validateRemoteRelease(published,canonical);
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
    verifySignedAttestation(attestation,bundle.digest);
    return {
      schema:"savant.release-uat-evidence.v1",ready:true,
      repository:REPOSITORY,version:canonical.version,commit:canonical.commit,
      workflowRunId:canonical.runId,verifiedSignerWorkflow:SIGNER,
      sha256:bundle.digest,
      assets:Object.keys(bundle.files).sort().map(name=>({
        name,sha256:bundle.files[name].sha256,bytes:bundle.files[name].bytes
      })),
      checks:{tagCommit:true,releaseAssets:true,checksums:true,provenance:true,
        remoteDigests:true,signedAttestation:true}
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
