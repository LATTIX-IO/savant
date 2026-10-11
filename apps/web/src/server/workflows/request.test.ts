import assert from "node:assert/strict";
import test from "node:test";

import { readWorkflowRequestObject } from "./request.ts";
import { WorkflowArtifactError } from "./workflow-artifacts.ts";

const fails = (code: string) => (error: unknown) => error instanceof WorkflowArtifactError && error.code === code;
function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/workflows/triage", {
    method: "PUT", body, headers: { "Content-Type": "application/json", ...headers },
  });
}

test("PER-1082: bounded JSON reader accepts a normal workflow request", async () => {
  const data = await readWorkflowRequestObject(req(JSON.stringify({
    repositoryId: "a", specification: { schemaVersion: 1 },
  }), { Origin: "https://example.test" }));
  assert.equal(data.repositoryId, "a");
});

test("PER-1082: oversized body denied before parse even when length is absent or dishonest", async () => {
  await assert.rejects(readWorkflowRequestObject(req("a".repeat(751_000))), fails("workflow_request_oversized"));
  await assert.rejects(readWorkflowRequestObject(req("{}", { "Content-Length": "900000" })), fails("workflow_request_oversized"));
});

test("PER-1082: malformed and non-object JSON gets a stable safe error", async () => {
  for (const payload of ["{bad", "null", "[]", ""]) {
    await assert.rejects(readWorkflowRequestObject(req(payload)), fails("invalid_json_body"));
  }
});

test("PER-1082: cross-origin and non-JSON mutation attempts rejected before parsing", async () => {
  await assert.rejects(readWorkflowRequestObject(req("{}", { Origin: "https://external.test" })), fails("request_origin_denied"));
  await assert.rejects(readWorkflowRequestObject(req("{}", { "Content-Type": "text/plain" })), fails("unsupported_media_type"));
  await assert.rejects(readWorkflowRequestObject(req("{}", { Origin: "invalid" })), fails("request_origin_denied"));
});
