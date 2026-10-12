import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessTelemetrySpanV1 } from "@savant/types/harness-telemetry";
import {
  HarnessTelemetryError, parseHarnessTelemetrySpan,
  createHarnessTelemetryBuffer, summarizeHarnessCoverage,
} from "./harness-telemetry.ts";

const H = "a".repeat(64);
const T = "b".repeat(64);
const span = (id = "s1", extras: Record<string, unknown> = {}): HarnessTelemetrySpanV1 => ({
  schemaVersion: 1, tenantId: "tenant-a", adapterId: "adapter-a",
  runId: "run-a", traceId: "trace-a", spanId: id,
  specVersionHash: H, testSuiteHash: T, kind: "step",
  status: "completed", startedAtMs: 10, durationMs: 20,
  captureLevel: "metadata", ...extras,
}) as HarnessTelemetrySpanV1;

function denied(code: string, fn: () => unknown) {
  assert.throws(fn, (e: unknown) => e instanceof HarnessTelemetryError && e.code === code);
}

test("PER-1093 RED: no-content v1 parser rejects raw IO, telemetry spoof, fields and prototype pollution", () => {
  assert.deepEqual(parseHarnessTelemetrySpan(span()), span());
  for (const payload of [
    { ...span(), input: "raw secret" },
    { ...span(), prompt: "private message" },
    { ...span(), captureLevel: "full" },
    { ...span(), tenantId: "other", spanId: "" },
    { ...span(), specVersionHash: "wrong" },
    { ...span(), schemaVersion: 2 },
    { ...span(), startedAtMs: -1 },
    { ...span(), inputTokens: -5 },
    { ...span(), nodeId: "tool/{evil}" },
    JSON.parse('{"schemaVersion":1,"__proto__":{"isAdmin":true}}'),
  ]) denied("invalid_telemetry", () => parseHarnessTelemetrySpan(payload));
});

test("PER-1093 RED: no untrusted property getters executed", () => {
  const malicious = span();
  Object.defineProperty(malicious, "runId", { enumerable: true, get() { throw Error("leaked"); } });
  denied("invalid_telemetry", () => parseHarnessTelemetrySpan(malicious));
});

test("PER-1093 RED: disabled SDK queues nothing, no transport calls, no plaintext telemetry", async () => {
  let calls = 0;
  const sdk = createHarnessTelemetryBuffer({
    enabled: false,
    tenantId: "tenant-a", adapterId: "adapter-a", traceId: "trace-a",
    send: async () => { calls++; return { batchId: "not-called", acceptedCursor: 0 }; },
  });
  assert.equal(sdk.record(span()), false);
  assert.equal(await sdk.flush(), 0);
  assert.equal(calls, 0);
  assert.equal(sdk.pendingCount(), 0);
});

test("PER-1098 RED: enabled SDK stable replay cursor and exactly once queued span", async () => {
  const received: Array<{ batchId: string; cursor: number; ids: string[] }> = [];
  const sdk = createHarnessTelemetryBuffer({
    enabled: true, tenantId: "tenant-a", adapterId: "adapter-a", traceId: "trace-a",
    send: async b => {
      received.push({ batchId: b.batchId, cursor: b.cursor, ids: b.spans.map(x => x.spanId) });
      return { batchId: b.batchId, acceptedCursor: b.cursor + b.spans.length };
    },
  });
  assert.equal(sdk.record(span("s1")), true);
  assert.equal(sdk.record(span("s1")), false);
  assert.equal(sdk.record(span("s2")), true);
  assert.equal(await sdk.flush(), 2);
  assert.equal(sdk.pendingCount(), 0);
  assert.equal(await sdk.flush(), 0);
  assert.deepEqual(received.map(x => x.ids), [["s1", "s2"]]);
});

test("PER-1098 RED: failed dispatch preserves exact batch ID and retry safety", async () => {
  let first = true;
  const observed: string[] = [];
  const sdk = createHarnessTelemetryBuffer({
    enabled: true, tenantId: "tenant-a", adapterId: "adapter-a", traceId: "trace-a",
    send: async b => {
      observed.push(b.batchId);
      if (first) { first = false; throw Error("provider raw secret"); }
      return { batchId: b.batchId, acceptedCursor: b.cursor + b.spans.length };
    },
  });
  sdk.record(span());
  await assert.rejects(() => sdk.flush(), (e: unknown) => e instanceof HarnessTelemetryError && e.code === "transport_unavailable");
  assert.equal(sdk.pendingCount(), 1);
  assert.equal(await sdk.flush(), 1);
  assert.equal(observed[0], observed[1]);
});

test("PER-1098 RED: bounded queue and tenant, trace identity", () => {
  const sdk = createHarnessTelemetryBuffer({
    enabled: true, tenantId: "tenant-a", adapterId: "adapter-a", traceId: "trace-a",
    maxPending: 2, send: async b => ({ batchId: b.batchId, acceptedCursor: b.cursor + b.spans.length }),
  });
  assert.equal(sdk.record(span("s1")), true);
  assert.equal(sdk.record(span("s2")), true);
  denied("backpressure", () => sdk.record(span("s3")));
  denied("identity_mismatch", () => sdk.record(span("foreign", { tenantId: "tenant-b" })));
  assert.equal(sdk.pendingCount(), 2);
});

test("PER-1098 RED: stale/forged batch acknowledgements never lose unsent records", async () => {
  const sdk = createHarnessTelemetryBuffer({
    enabled: true, tenantId: "tenant-a", adapterId: "adapter-a", traceId: "trace-a",
    send: async () => ({ batchId: "forged", acceptedCursor: 100 }),
  });
  sdk.record(span());
  await assert.rejects(() => sdk.flush(), (e: unknown) => e instanceof HarnessTelemetryError && e.code === "invalid_ack");
  assert.equal(sdk.pendingCount(), 1);
});

test("PER-1093 RED: missing workflow step coverage is explicitly partial, not silently complete", () => {
  assert.deepEqual(summarizeHarnessCoverage(["step-a", "step-b"], [span("one", { nodeId: "step-a" })]), {
    completeness: "partial", observedStepIds: ["step-a"], missingStepIds: ["step-b"],
  });
  assert.deepEqual(summarizeHarnessCoverage(["step-a"], []), {
    completeness: "none", observedStepIds: [], missingStepIds: ["step-a"],
  });
});
