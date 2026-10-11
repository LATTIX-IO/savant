import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { WorkflowArtifactError } from "./workflow-artifacts.ts";
import { createWorkflowGitHubClient } from "./workflow-github-client.ts";

const sha = (value: string) => createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0" + value).digest("hex");
const c1 = "a".repeat(40);
const c2 = "b".repeat(40);
function fixture() {
  const state = { current: c1, commits: new Map<string, { content: string; sha: string }>(), requests: [] as Array<{ url: string; method: string; authorization: string | null }>, status: 0, malformed: false, tamper: false };
  const content = '{"schemaVersion":1,"workflowId":"triage"}';
  state.commits.set(c1, { content, sha: sha(content) });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const headers = new Headers(init?.headers);
    state.requests.push({ url: String(input), method, authorization: headers.get("Authorization") });
    if (state.status) return new Response(JSON.stringify({ message: "SECRET MUST NOT LEAK" }), { status: state.status });
    if (state.malformed) return new Response("not-json", { status: 200 });
    if (url.pathname.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: state.current } });
    if (url.pathname.endsWith("/contents/workflows/triage.json")) {
      if (method === "GET") {
        const ref = url.searchParams.get("ref") || state.current;
        const item = state.commits.get(ref);
        if (!item) return new Response("{}", { status: 404 });
        const blob = state.tamper ? "{\"modified\":true}" : item.content;
        return Response.json({ type: "file", encoding: "base64", content: Buffer.from(blob).toString("base64"), sha: item.sha });
      }
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { sha?: string; content: string };
        const latest = state.commits.get(state.current);
        if ((body.sha ?? null) !== (latest?.sha ?? null)) return new Response("{}", { status: 409 });
        const content = Buffer.from(body.content, "base64").toString("utf8");
        state.current = c2;
        const file = { content, sha: sha(content) };
        state.commits.set(c2, file);
        return Response.json({ content: { sha: file.sha }, commit: { sha: c2 } });
      }
    }
    return new Response("{}", { status: 404 });
  };
  const client = createWorkflowGitHubClient({ owner: "example", repository: "repo", branch: "main", accessToken: "secret-token", fetcher });
  return { client, state };
}
const codeIs = (code: string) => (error: unknown) => error instanceof WorkflowArtifactError && error.code === code;

test("PER-1087: GitHub create/read/update/pinned read checks SHA, content and explicit branch", async () => {
  const { client, state } = fixture();
  const old = await client.read("workflows/triage.json");
  assert.equal(old?.commitSha, c1);
  assert.equal(old?.blobSha, sha(old.content));
  const next = await client.write("workflows/triage.json", "{\"changed\":true}", old.blobSha);
  assert.equal(next.commitSha, c2);
  assert.equal(next.blobSha, sha("{\"changed\":true}"));
  const pinned = await client.read("workflows/triage.json", c1);
  const current = await client.read("workflows/triage.json");
  assert.equal(pinned?.content, old.content);
  assert.equal(current?.content, "{\"changed\":true}");
  assert.equal(state.requests.find(x => x.method === "PUT")?.authorization, "Bearer secret-token");
  assert.ok(state.requests.some(x => x.url.includes("ref=" + c1)));
});

test("PER-1087: rejects content SHA mismatch before any parse or downstream indexing", async () => {
  const { client, state } = fixture();
  state.tamper = true;
  await assert.rejects(client.read("workflows/triage.json"), codeIs("workflow_integrity_failed"));
});
test("PER-1087: stale competing writer is 409 with no changed head", async () => {
  const { client, state } = fixture();
  await assert.rejects(client.write("workflows/triage.json", "new", "f".repeat(40)), codeIs("revision_conflict"));
  assert.equal(state.current, c1);
});
test("PER-1087: provider failure matrix has stable sanitized errors", async () => {
  for (const [status, code] of [[401,"git_access_denied"],[403,"git_access_denied"],[429,"git_rate_limited"],[500,"git_unavailable"],[409,"revision_conflict"]] as const) {
    const { client, state } = fixture();
    state.status = status;
    await assert.rejects(client.write("workflows/triage.json", "changed", sha("old")), (error: unknown) =>
      codeIs(code)(error) && !String(error).includes("SECRET") && !JSON.stringify(error).includes("secret-token"));
  }
});
test("PER-1087: malformed response, failed fetch and oversized streamed JSON fail closed", async () => {
  const { client, state } = fixture();
  state.malformed = true;
  await assert.rejects(client.read("workflows/triage.json"), codeIs("git_invalid_response"));
  const failing = createWorkflowGitHubClient({ owner:"a", repository:"b",branch:"main",accessToken:"secret",fetcher:async () => {throw Error("secret details");} });
  await assert.rejects(failing.read("workflows/triage.json"), codeIs("git_unavailable"));
  const huge = createWorkflowGitHubClient({ owner:"a", repository:"b",branch:"main",accessToken:"secret",fetcher:async () => new Response("z".repeat(1_600_000), {status:200}) });
  await assert.rejects(huge.read("workflows/triage.json"), codeIs("git_response_oversized"));
});
test("PER-1087: invalid destination path rejected before contacting provider", async () => {
  const {client,state}=fixture();
  await assert.rejects(client.write("../passwords", "a", null), codeIs("workflow_id_invalid"));
  assert.equal(state.requests.length,0);
});
