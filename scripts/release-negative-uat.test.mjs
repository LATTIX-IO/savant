import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseNegativeEvidenceRequest, makeReadOnlyEvidenceClient, assessNegativeReleaseRun,
  verifyNegativeReleaseEvidence, NegativeEvidenceError
} from "./release-negative-uat.mjs";

const REPO = "LATTIX-IO/savant";
const SHA = "a".repeat(40);
const RUN = "1904";
const VERSION = "v0.1.0";
const runPath = "/actions/runs/" + RUN;
function request(scenario = "preflight_denied") {
  return { repository: REPO, version: VERSION, commit: SHA, runId: RUN, scenario };
}
function fixture(scenario = "preflight_denied") {
  const run = {
    id: Number(RUN), repository: { full_name: REPO }, head_sha: SHA,
    path: ".github/workflows/publish-source-release.yml",
    head_branch: "main", event: "workflow_dispatch",
    status: "completed", conclusion: "failure", run_attempt: 1,
    actor: { id: 300 }, triggering_actor: { id: 300 },
    inputs: { version: VERSION, commit_sha: SHA, confirmation: "PUBLISH " + VERSION }
  };
  const jobs = { total_count: 2, jobs: [
    { name: "Verify, test and attest tagged source", status: "completed",
      conclusion: scenario === "preflight_denied" ? "failure" : "success" },
    { name: "Publish only after protected environment approval", status: "completed",
      conclusion: scenario === "preflight_denied" ? "skipped" : "cancelled" }
  ]};
  const approvals = scenario === "preflight_denied" ? [] : [
    { state: "rejected", user: { id: 301, type: "User" },
      environments: [{ name: "savant-release", id: 7 }] }
  ];
  return { run, jobs, approvals, release: null };
}
function mockFetch(fixtureData, { responses = {}, calls = [] } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    const path = url.replace("https://api.github.com/repos/" + REPO, "");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.headers.Authorization.startsWith("Bearer "));
    if (responses[path]) return responses[path];
    if (path === runPath) return Response.json(fixtureData.run);
    if (path === runPath + "/jobs?per_page=100") return Response.json(fixtureData.jobs);
    if (path === runPath + "/approvals") return Response.json(fixtureData.approvals);
    if (path === "/releases/tags/" + VERSION)
      return fixtureData.release === null ? new Response(null, { status: 404 }) :
        Response.json(fixtureData.release);
    throw Error("unexpected URL " + path);
  };
}

test("PER-1370 explicit scenarios, release version and run identifier are mandatory", () => {
  const base = { GITHUB_REPOSITORY: REPO, SAVANT_EVIDENCE_VERSION: VERSION,
    SAVANT_EVIDENCE_COMMIT: SHA, SAVANT_EVIDENCE_RUN_ID: RUN,
    SAVANT_NEGATIVE_SCENARIO: "preflight_denied" };
  assert.deepEqual(parseNegativeEvidenceRequest(base), request());
  for (const mutation of [
    { GITHUB_REPOSITORY: "other/repo" },
    { SAVANT_EVIDENCE_VERSION: "v0.1.0; echo attacker" },
    { SAVANT_EVIDENCE_COMMIT: "bad" },
    { SAVANT_EVIDENCE_RUN_ID: "0" },
    { SAVANT_EVIDENCE_RUN_ID: "42\nunsafe" },
    { SAVANT_NEGATIVE_SCENARIO: "approved" },
    { SAVANT_NEGATIVE_SCENARIO: "" }
  ]) assert.throws(() => parseNegativeEvidenceRequest({ ...base, ...mutation }), NegativeEvidenceError);
});

test("PER-1370 read-only preflight refusal evidence verifies and never exposes actor identities", async () => {
  const f = fixture(), calls = [];
  const evidence = await verifyNegativeReleaseEvidence(request(), {
    token: "test-read-only-evidence-token", fetcher: mockFetch(f, { calls })
  });
  assert.equal(evidence.ready, true);
  assert.equal(evidence.schema, "savant.release-negative-uat.v1");
  assert.equal(evidence.scenario, "preflight_denied");
  assert.ok(Object.values(evidence.checks).every(Boolean));
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(x => x.options.method), ["GET", "GET", "GET", "GET"]);
  assert.ok(calls.every(x => x.url.startsWith("https://api.github.com/repos/" + REPO + "/")));
  assert.doesNotMatch(JSON.stringify(evidence), /token|reviewer|actor|approval.*301/i);
});

test("PER-1370 rejected protected release approval confirms no publishing and no release", async () => {
  const f = fixture("approval_denied");
  const out = await verifyNegativeReleaseEvidence(request("approval_denied"), {
    token: "test-read-only-evidence-token", fetcher: mockFetch(f)
  });
  assert.equal(out.ready, true);
  assert.equal(out.scenario, "approval_denied");
  assert.equal(out.checks.scenarioEvidence, true);
});

test("PER-1370 reject forged run identity, successful publication, reruns and unexpected workflow inputs", () => {
  const changes = [
    f => { f.run.id = 1905; },
    f => { f.run.path = ".github/workflows/other.yml"; },
    f => { f.run.event = "push"; },
    f => { f.run.head_sha = "b".repeat(40); },
    f => { f.run.head_branch = "feature"; },
    f => { f.run.repository.full_name = "attacker/repo"; },
    f => { f.run.conclusion = "success"; },
    f => { f.run.status = "in_progress"; },
    f => { f.run.run_attempt = 2; },
    f => { f.run.run_attempt = null; },
    f => { f.run.actor = null; },
    f => { f.run.triggering_actor = null; },
    f => { f.run.inputs.version = "v9.0.0"; },
    f => { f.run.inputs.commit_sha = "c".repeat(40); }
  ];
  for (const mutate of changes) {
    const f = fixture(); mutate(f);
    assert.throws(() => assessNegativeReleaseRun(request(), f.run, f.jobs, f.approvals, f.release),
      NegativeEvidenceError);
  }
  const invalidApproval = fixture("approval_denied");
  invalidApproval.run.inputs.confirmation = "NO";
  assert.throws(() => assessNegativeReleaseRun(request("approval_denied"), ...Object.values(invalidApproval)),
    NegativeEvidenceError);
});

test("PER-1370 fail closed on successful, duplicate, malformed, pending or unrelated jobs", () => {
  const changes = [
    f => { f.jobs.jobs[1].conclusion = "success"; },
    f => { f.jobs.jobs[0].conclusion = "success"; },
    f => { f.jobs.jobs[1].conclusion = "failure"; },
    f => { f.jobs.jobs[1].status = "in_progress"; },
    f => { f.jobs.total_count = 5; },
    f => { f.jobs.jobs.push(f.jobs.jobs[0]); f.jobs.total_count++; },
    f => { f.jobs.jobs[0].name = "attacker"; },
    f => { f.jobs.jobs = []; f.jobs.total_count = 0; }
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.throws(() => assessNegativeReleaseRun(request(), f.run, f.jobs, f.approvals, f.release),
      NegativeEvidenceError);
  }
  const f = fixture();
  f.release = { tag_name: VERSION };
  assert.throws(() => assessNegativeReleaseRun(request(), f.run, f.jobs, f.approvals, f.release),
    /target_release_exists/);
});

test("PER-1370 reject false denial, self-review, unauthorized or ambiguous history", () => {
  const changes = [
    f => { f.approvals = []; },
    f => { f.approvals.push(f.approvals[0]); },
    f => { f.approvals[0].state = "approved"; },
    f => { f.approvals[0].state = "pending"; },
    f => { f.approvals[0].state = "bypassed"; },
    f => { f.approvals[0].user.id = 300; },
    f => { f.approvals[0].user.type = "Bot"; },
    f => { f.approvals[0].user.id = "301"; },
    f => { f.approvals[0].environments = []; },
    f => { f.approvals[0].environments[0].name = "production"; },
    f => { f.approvals[0].environments[0].id = 0; },
    f => { f.run.triggering_actor.id = 301; }
  ];
  for (const change of changes) {
    const f = fixture("approval_denied"); change(f);
    assert.throws(() => assessNegativeReleaseRun(request("approval_denied"),
      f.run, f.jobs, f.approvals, f.release), NegativeEvidenceError);
  }
});

test("PER-1370 missing, paginated, denied, malformed and oversized GitHub evidence never passes", async () => {
  const f = fixture(), token = "test-read-only-evidence-token";
  for (const response of [
    new Response(null, { status: 401 }), new Response(null, { status: 403 }),
    new Response(null, { status: 429 }), new Response(null, { status: 503 }),
    new Response("not json", { status: 200 }),
    new Response("x".repeat(512 * 1024 + 1), { status: 200 }),
    new Response("{}", { status: 200,
      headers: { link: '<https://api.github.com/next>; rel="next"' } })
  ]) {
    const fetcher = mockFetch(f, { responses: { [runPath + "/approvals"]: response } });
    await assert.rejects(verifyNegativeReleaseEvidence(request(), { token, fetcher }),
      NegativeEvidenceError);
  }
  const malformed = fixture();
  malformed.jobs.total_count = 50;
  await assert.rejects(verifyNegativeReleaseEvidence(request(), {
    token, fetcher: mockFetch(malformed)
  }), NegativeEvidenceError);
  await assert.rejects(verifyNegativeReleaseEvidence(request(), { token: "" }), /missing_read_token/);
});

test("PER-1370 endpoint allowlist and transport errors cannot redirect or leak secrets", async () => {
  const token = "secret-governance-token";
  const client = makeReadOnlyEvidenceClient({ token,
    fetcher: async () => { throw Error("Authorization: " + token); } });
  await assert.rejects(client("/actions/runs/1"), e =>
    e instanceof NegativeEvidenceError && !e.message.includes(token));
  for (const path of [
    "/actions/runs/../secrets", "/actions/runs/1/other",
    "https://attacker.example", "/releases/tags/../../evil",
    "/actions/runs/1?x=unsafe", "/releases/tags/v1.2.3/../test"
  ]) await assert.rejects(client(path), /invalid_read_path/);
  assert.throws(() => makeReadOnlyEvidenceClient({ token: "bad\nheader" }), /missing_read_token/);
});

test("PER-1370 immutable negative-evidence path never writes or dispatches GitHub actions", () => {
  const source = readFileSync("scripts/release-negative-uat.mjs", "utf8");
  assert.doesNotMatch(source, /"workflow","run"|"release","create"|"release","edit"|"release","delete"/);
  assert.match(source, /method: "GET"/);
  assert.match(source, /target_release_exists/);
});
