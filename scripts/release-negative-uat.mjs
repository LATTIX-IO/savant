import { parseEvidenceRequest } from "./release-uat-evidence.mjs";

const REPO = "LATTIX-IO/savant";
const API = "https://api.github.com/repos/" + REPO;
const WORKFLOW = ".github/workflows/publish-source-release.yml";
const PREPARE = "Verify, test and attest tagged source";
const PUBLISH = "Publish only after protected environment approval";
const SCENARIOS = new Set(["preflight_denied", "approval_denied"]);
const RUN_ID = /^[1-9][0-9]{0,18}$/;
const POSITIVE_ID = value => Number.isSafeInteger(value) && value > 0;

export class NegativeEvidenceError extends Error {
  constructor(code) { super(code); this.name = "NegativeEvidenceError"; this.code = code; }
}
function fail(code) { throw new NegativeEvidenceError(code); }

export function parseNegativeEvidenceRequest(env = process.env) {
  if (!SCENARIOS.has(env.SAVANT_NEGATIVE_SCENARIO)) fail("invalid_negative_scenario");
  let base;
  try {
    base = parseEvidenceRequest({
      GITHUB_REPOSITORY: env.GITHUB_REPOSITORY,
      SAVANT_EVIDENCE_VERSION: env.SAVANT_EVIDENCE_VERSION,
      SAVANT_EVIDENCE_COMMIT: env.SAVANT_EVIDENCE_COMMIT,
      SAVANT_EVIDENCE_RUN_ID: env.SAVANT_EVIDENCE_RUN_ID
    });
  } catch { fail("invalid_negative_request"); }
  if (!RUN_ID.test(base.runId)) fail("invalid_negative_request");
  return { ...base, scenario: env.SAVANT_NEGATIVE_SCENARIO };
}

/** Bound REST client; every request is GET to a fixed repository path. */
export function makeReadOnlyEvidenceClient({ token, fetcher = fetch } = {}) {
  if (typeof token !== "string" || token.trim().length < 10 || /[\r\n]/.test(token))
    fail("missing_read_token");
  return async (path, { allowMissing = false } = {}) => {
    if (typeof path !== "string" || !/^\/(?:actions\/runs\/[1-9][0-9]*(?:\/(?:jobs\?per_page=100|approvals))?|releases\/tags\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?)$/.test(path))
      fail("invalid_read_path");
    let response;
    try {
      response = await fetcher(API + path, {
        method: "GET", redirect: "error", cache: "no-store",
        headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.timeout(15000)
      });
    } catch { fail("negative_evidence_api_unavailable"); }
    if (allowMissing && response.status === 404) return null;
    if (response.status !== 200) fail("negative_evidence_api_unavailable");
    if (/rel="next"/.test(response.headers?.get("link") || ""))
      fail("negative_evidence_paginated");
    let raw;
    try { raw = await response.text(); } catch { fail("negative_evidence_api_unavailable"); }
    if (raw.length > 512 * 1024) fail("negative_evidence_oversized");
    try { return JSON.parse(raw); } catch { fail("negative_evidence_malformed"); }
  };
}

export function assessNegativeReleaseRun(request, run, jobs, approvals, release) {
  if (request?.repository !== REPO || !SCENARIOS.has(request?.scenario) ||
      !RUN_ID.test(String(request?.runId || ""))) fail("invalid_negative_request");
  if (release !== null) fail("target_release_exists");
  if (String(run?.id) !== request.runId || run?.repository?.full_name !== REPO ||
      run?.head_sha !== request.commit || run?.path !== WORKFLOW ||
      run?.head_branch !== "main" || run?.event !== "workflow_dispatch" ||
      run?.status !== "completed" || !["failure", "cancelled"].includes(run?.conclusion) ||
      run?.display_title !== "source-release:" + request.version + ":" + request.commit ||
      run?.run_attempt !== 1 || !POSITIVE_ID(run?.actor?.id) ||
      !POSITIVE_ID(run?.triggering_actor?.id)) fail("negative_run_unverified");
  // For releases created by the version-bound workflow, display_title is
  // always present even if the Actions API omits workflow_dispatch inputs.
  if (run.inputs !== undefined && run.inputs !== null) {
    if (typeof run.inputs !== "object" || run.inputs.version !== request.version ||
        run.inputs.commit_sha !== request.commit) fail("negative_run_inputs_mismatch");
    if (request.scenario === "approval_denied" &&
        run.inputs.confirmation !== "PUBLISH " + request.version)
      fail("negative_run_inputs_mismatch");
  }
  if (!Array.isArray(jobs?.jobs) || !Number.isSafeInteger(jobs?.total_count) ||
      jobs.total_count !== jobs.jobs.length || jobs.jobs.length < 1 ||
      jobs.jobs.length > 100) fail("negative_jobs_unverified");
  const prep = jobs.jobs.filter(j => j?.name === PREPARE);
  const pub = jobs.jobs.filter(j => j?.name === PUBLISH);
  if (prep.length !== 1 || pub.length > 1 || jobs.jobs.some(j =>
      ![PREPARE, PUBLISH].includes(j?.name) || j?.status !== "completed"))
    fail("negative_jobs_unverified");
  if (pub.some(j => j.conclusion === "success")) fail("publication_job_succeeded");
  if (request.scenario === "preflight_denied") {
    if (prep[0].conclusion !== "failure" ||
        pub.some(j => j.conclusion !== "skipped") ||
        !Array.isArray(approvals) || approvals.length !== 0)
      fail("preflight_denial_unverified");
  } else {
    if (prep[0].conclusion !== "success" ||
        pub.some(j => !["failure", "cancelled", "skipped"].includes(j.conclusion)) ||
        !Array.isArray(approvals) || approvals.length !== 1)
      fail("environment_denial_unverified");
    const approval = approvals[0];
    if (approval?.state !== "rejected" || approval?.user?.type !== "User" ||
        !POSITIVE_ID(approval.user.id) ||
        approval.user.id === run.actor.id || approval.user.id === run.triggering_actor.id ||
        !Array.isArray(approval.environments) || approval.environments.length !== 1 ||
        approval.environments[0]?.name !== "savant-release" ||
        !POSITIVE_ID(approval.environments[0]?.id))
      fail("environment_denial_unverified");
  }
  return {
    schema: "savant.release-negative-uat.v1", ready: true,
    repository: REPO, version: request.version, commit: request.commit,
    workflowRunId: request.runId, scenario: request.scenario,
    checks: { runIdentity: true, unsuccessfulRun: true, publicationNotSuccessful: true,
      scenarioEvidence: true, targetReleaseAbsent: true }
  };
}

/** Read-only. No GitHub release, workflow or repository mutation. */
export async function verifyNegativeReleaseEvidence(request, {
  token = process.env.GH_TOKEN, fetcher = fetch
} = {}) {
  if (request?.repository !== REPO || !SCENARIOS.has(request?.scenario) ||
      !RUN_ID.test(String(request?.runId || ""))) fail("invalid_negative_request");
  const canonical = parseNegativeEvidenceRequest({
    GITHUB_REPOSITORY: request.repository,
    SAVANT_EVIDENCE_VERSION: request.version,
    SAVANT_EVIDENCE_COMMIT: request.commit,
    SAVANT_EVIDENCE_RUN_ID: request.runId,
    SAVANT_NEGATIVE_SCENARIO: request.scenario
  });
  const get = makeReadOnlyEvidenceClient({ token, fetcher });
  const runPath = "/actions/runs/" + canonical.runId;
  const run = await get(runPath);
  const jobs = await get(runPath + "/jobs?per_page=100");
  const approvals = await get(runPath + "/approvals");
  const release = await get("/releases/tags/" + canonical.version, { allowMissing: true });
  return assessNegativeReleaseRun(canonical, run, jobs, approvals, release);
}

if (process.argv[1]?.endsWith("/release-negative-uat.mjs")) {
  try {
    console.log(JSON.stringify(await verifyNegativeReleaseEvidence(parseNegativeEvidenceRequest()), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ schema: "savant.release-negative-uat.v1",
      ready: false, code: error instanceof NegativeEvidenceError ? error.code : "negative_uat_failed" }));
    process.exitCode = 1;
  }
}
