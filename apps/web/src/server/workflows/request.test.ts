import assert from "node:assert/strict";
import test from "node:test";

import { readWorkflowRequestObject } from "./request.ts";
import { WorkflowArtifactError } from "./workflow-artifacts.ts";

const fails = (code: string) => (error: unknown) => error instanceof WorkflowArtifactError && error.code === code;

test("PER-1082: bounded JSON reader accepts a normal workflow request", async () => {
  const data = await readWorkflowRequestObject(new Request("https://example.test", {
    method: "PUT", body: JSON.stringify({ repositoryId: "a", specification: { schemaVersion: 1 } }),
  }));
  assert.equal(data.repositoryId, "a");
});

test("PER-1082: oversized body denied before parse even when content-length is absent or dishonest", async () => {
  await assert.rejects(readWorkflowRequestObject(new Request("https://example.test", {
    method: "PUT", body: "a".repeat(751_000),
  })), fails("workflow_request_oversized"));
  await assert.rejects(readWorkflowRequestObject(new Request("https://example.test", {
    method: "PUT", body: "{}", headers: { "Content-Length": "900000" },
  })), fails("workflow_request_oversized"));
});

test("PER-1082: malformed and non-object JSON gets a stable safe error", async () => {
  for (const payload of ["{bad", "null", "[]", ""]) {
    await assert.rejects(readWorkflowRequestObject(new Request("https://example.test", {
      method: "PUT", body: payload,
    })), fails("invalid_json_body"));
  }
});
