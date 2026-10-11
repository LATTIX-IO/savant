import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeWorkflowSpecification,
  parseWorkflowSpecification,
  WorkflowSpecError,
  workflowSpecificationSchema,
} from "./workflow-specification.ts";

function validWorkflow(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    workflowId: "triage-flow",
    version: "1.0.0",
    source: { runtime: "customer-harness", sourceRef: "refs/heads/main" },
    nodes: [
      { id: "start", kind: "agent", outputs: [{ id: "out", dataType: "application/json" }] },
      {
        id: "model", kind: "opaque", native: {
          kind: "vendor.magical_model",
          payload: { nested: { z: 2, a: [1, { k: "kept" }] } },
        },
        inputs: [{ id: "in", dataType: "application/json" }],
        outputs: [{ id: "out", dataType: "text/plain" }],
      },
      { id: "end", kind: "decision", inputs: [{ id: "in", dataType: "text/plain" }] },
    ],
    edges: [
      { id: "e1", from: { nodeId: "start", portId: "out" }, to: { nodeId: "model", portId: "in" } },
      {
        id: "e2", from: { nodeId: "model", portId: "out" }, to: { nodeId: "end", portId: "in" },
        condition: { format: "opaque", expression: "vendor-condition", extensions: { x: 1 } },
      },
    ],
    outcomeRefs: ["dataset/golden-triage-v1"],
    extensions: { vendor: { z: true, a: null } },
  };
}

function failsWith(code: string, payload: unknown) {
  assert.throws(
    () => parseWorkflowSpecification(payload),
    (error: unknown) => error instanceof WorkflowSpecError && error.code === code,
  );
}

test("PER-1077: typed v1 round-trip preserves native extensions, ids and conditional annotations", () => {
  const source = validWorkflow();
  const parsed = parseWorkflowSpecification(source);
  assert.deepEqual(parsed, source);
  assert.deepEqual(JSON.parse(canonicalizeWorkflowSpecification(parsed)), {
    ...source,
    // Stable object-key order is immaterial when reparsed.
  });
  assert.equal(workflowSpecificationSchema.$id, "https://savant.dev/schemas/workflow-specification/v1.json");
});

test("PER-1077: object-key insertion order does not change canonical form", () => {
  const a = validWorkflow();
  const b = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
  b.source = { sourceRef: "refs/heads/main", runtime: "customer-harness" };
  b.extensions = { vendor: { a: null, z: true } };
  assert.equal(canonicalizeWorkflowSpecification(parseWorkflowSpecification(a)), canonicalizeWorkflowSpecification(parseWorkflowSpecification(b)));
});

test("PER-1077: rejects duplicate node and edge IDs", () => {
  const a = validWorkflow();
  (a.nodes as Array<Record<string, unknown>>).push({ id: "start", kind: "tool" });
  failsWith("duplicate-node", a);
  const b = validWorkflow();
  (b.edges as Array<Record<string, unknown>>).push((b.edges as Array<Record<string, unknown>>)[0]!);
  failsWith("duplicate-edge", b);
});

test("PER-1077: rejects missing nodes, ports and duplicate ports", () => {
  const a = validWorkflow();
  ((a.edges as Array<Record<string, unknown>>)[0]!.to as Record<string, unknown>).nodeId = "missing";
  failsWith("missing-node", a);
  const b = validWorkflow();
  ((b.edges as Array<Record<string, unknown>>)[0]!.to as Record<string, unknown>).portId = "missing";
  failsWith("missing-port", b);
  const c = validWorkflow();
  (c.nodes as Array<Record<string, unknown>>)[0]!.outputs = [{ id: "out", dataType: "json" }, { id: "out", dataType: "json" }];
  failsWith("duplicate-port", c);
});

test("PER-1077: rejects cycles, including self loops, rather than silently treating them as bounded", () => {
  const a = validWorkflow();
  (a.nodes as Array<Record<string, unknown>>)[0]!.inputs = [{ id: "in", dataType: "text/plain" }];
  (a.edges as Array<Record<string, unknown>>).push({
    id: "e3", from: { nodeId: "end", portId: "out" }, to: { nodeId: "start", portId: "in" },
  });
  (a.nodes as Array<Record<string, unknown>>)[2]!.outputs = [{ id: "out", dataType: "text/plain" }];
  failsWith("cycle", a);
});

test("PER-1077: unknown major versions and unrecognized node kinds fail explicitly; opaque kinds survive", () => {
  const a = validWorkflow();
  a.schemaVersion = 2;
  failsWith("unsupported-version", a);
  const b = validWorkflow();
  (b.nodes as Array<Record<string, unknown>>)[0]!.kind = "future.vendor.node";
  failsWith("invalid-node", b);
  const c = validWorkflow();
  delete (c.nodes as Array<Record<string, unknown>>)[1]!.native;
  failsWith("invalid-node", c);
});

test("PER-1077: malformed metadata, pollution keys and oversized graphs are rejected", () => {
  const a = validWorkflow();
  a.extensions = JSON.parse('{"__proto__":{"isAdmin":true}}');
  failsWith("unsafe-key", a);
  const b = validWorkflow();
  (b.nodes as Array<Record<string, unknown>>)[0]!.label = "x".repeat(530_000);
  failsWith("size-limit", b);
  const c = validWorkflow();
  a.source = { runtime: "ignored" };
  (c.nodes as Array<Record<string, unknown>>)[0]!.inputs = [{ id: "", dataType: "text/plain" }];
  failsWith("invalid-port", c);
});
