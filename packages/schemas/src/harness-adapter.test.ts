import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessAdapter, HarnessTestRequest, HarnessCaller } from "@savant/types/harness-adapter";
import {
  AdapterProtocolError, createHarnessGateway, parseHarnessCapabilities,
  validateHarnessTestRequest, parseHarnessRunEvent,
} from "./harness-adapter.ts";

const hash = "a".repeat(64);
const sha = "b".repeat(64);
const capabilities = {
  protocol: { major: 1, minor: 0 },
  adapterId: "sandbox-adapter",
  features: { execute: true, observe: true, cancel: true, events: true },
  coverage: { execution: "partial", observation: "partial" },
  limits: { maxConcurrency: 2, maxDurationMs: 30_000, maxCostUsd: 1 },
};
const request = (): HarnessTestRequest => ({
  tenantId: "tenant-A", adapterId: "sandbox-adapter", actor: "operator",
  runId: "run-1", traceId: "trace-1", idempotencyKey: "idempotency-1",
  specVersionHash: hash, testSuiteHash: sha, inputRef: "fixture-1",
  budget: { maxDurationMs: 5000, maxCostUsd: 0.25 },
  capture: { level: "metadata", retentionDays: 7, residency: "us-east-1" },
});
const caller = (credential = "execute", tenantId = "tenant-A"): HarnessCaller =>
  ({ credential, tenantId, actor: "operator" });
const run = (status = "queued") => ({
  tenantId: "tenant-A", adapterId: "sandbox-adapter", runId: "run-1",
  externalRunId: "sandbox-run-1", traceId: "trace-1",
  specVersionHash: hash, testSuiteHash: sha, status,
});
function denied(code: string, fn: () => unknown | Promise<unknown>) {
  return assert.rejects(async () => { await fn(); }, (error: unknown) =>
    error instanceof AdapterProtocolError && error.code === code);
}

function fixture(options: { features?: Partial<typeof capabilities.features>; status?: string; events?: unknown[]; fail?: boolean; malformedRun?: boolean } = {}) {
  const history: string[] = [];
  const audit: string[] = [];
  let result = run(options.status ?? "queued");
  const adapter: HarnessAdapter = {
    async discoverCapabilities() { history.push("discover"); return { ...capabilities, features: { ...capabilities.features, ...options.features },
    coverage: { ...capabilities.coverage, execution: options.features?.execute === false ? "unsupported" : "partial" } }; },
    async validateConfiguration() { history.push("validate"); return true; },
    async executeTest() { history.push("execute"); if (options.fail) throw new Error("provider secret 123"); return options.malformedRun ? { ...result, tenantId: "tenant-B" } : result; },
    async cancel() { history.push("cancel"); result = { ...result, status: "canceled" }; return result; },
    async getRun() { history.push("get"); return result; },
    async *streamEvents() {
      history.push("events");
      for (const e of options.events ?? [
        { eventId: "event-1", tenantId: "tenant-A", runId: "run-1", traceId: "trace-1", sequence: 1, status: "running" },
        { eventId: "event-2", tenantId: "tenant-A", runId: "run-1", traceId: "trace-1", sequence: 2, status: "succeeded" },
      ]) yield e;
    },
    async health() { history.push("health"); return "healthy"; },
  };
  const gateway = createHarnessGateway({
    adapter,
    now: () => 1000,
    verifyCredential: async (c: HarnessCaller) => {
      if (c.credential === "missing") return null;
      return {
        tenantId: c.credential === "foreign" ? "tenant-B" : c.tenantId,
        actor: c.actor,
        scopes: c.credential === "read" ? ["harness:read"] as const : ["harness:read", "harness:execute", "harness:cancel"] as const,
        expiresAtMs: c.credential === "expired" ? 999 : 9999,
        revoked: c.credential === "revoked",
      };
    },
    authorizeRun: async (tenantId: string, runId: string) => tenantId === "tenant-A" && runId === "run-1",
    audit: async ({ action }: { action: string }) => { audit.push(action); },
  });
  return { gateway, history, audit };
}

test("PER-1092 RED: version negotiation fails closed and false capability claims cannot execute", async () => {
  assert.equal(parseHarnessCapabilities(capabilities).protocol.major, 1);
  assert.throws(() => parseHarnessCapabilities({ ...capabilities, protocol: { major: 2, minor: 0 } }),
    (error: unknown) => error instanceof AdapterProtocolError && error.code === "unsupported_version");
  assert.throws(() => parseHarnessCapabilities({ ...capabilities, features: { ...capabilities.features, execute: false, cancel: true } }),
    (error: unknown) => error instanceof AdapterProtocolError && error.code === "invalid_capabilities");
  const f = fixture({ features: { execute: false, cancel: false } });
  await denied("unsupported", () => f.gateway.execute(caller(), request()));
  assert.deepEqual(f.history, ["discover"]);
});

test("PER-1092 RED: valid fixture bounds budgets, capture, digests and input", () => {
  assert.equal(validateHarnessTestRequest(request(), parseHarnessCapabilities(capabilities)).runId, "run-1");
  for (const mutation of [
    { specVersionHash: "short" }, { inputRef: "https://private.example/raw" },
    { budget: { maxCostUsd: 9, maxDurationMs: 5000 } },
    { capture: { level: "raw", retentionDays: 100, residency: "any" } },
    { __proto__: null, extraField: "untrusted" },
  ]) {
    assert.throws(() => validateHarnessTestRequest({ ...request(), ...mutation }, parseHarnessCapabilities(capabilities)),
      (e: unknown) => e instanceof AdapterProtocolError);
  }
  const poison = JSON.parse('{"tenantId":"tenant-A","__proto__":{"admin":true}}') as Record<string, unknown>;
  assert.throws(() => validateHarnessTestRequest({ ...request(), ...poison }, parseHarnessCapabilities(capabilities)));
});

test("PER-1092 RED: no external I/O on forged tenant, missing, revoked, expired or insufficient scope", async () => {
  for (const credential of ["missing", "revoked", "expired", "foreign", "read"]) {
    const f = fixture();
    await denied(credential === "read" ? "insufficient_scope" : "unauthorized", () => f.gateway.execute(caller(credential), request()));
    assert.deepEqual(f.history, [], credential);
    assert.deepEqual(f.audit, [], credential);
  }
  const f = fixture();
  await denied("unauthorized", () => f.gateway.execute(caller("execute", "tenant-B"), request()));
  assert.deepEqual(f.history, []);
});

test("PER-1092 RED: authorized execution pins source identity and emits minimal audit record", async () => {
  const f = fixture();
  const result = await f.gateway.execute(caller(), request());
  assert.equal(result.status, "queued");
  assert.deepEqual(f.history, ["discover", "execute"]);
  assert.deepEqual(f.audit, ["executeTest"]);
});

test("PER-1092 RED: pending, success, failure, timeout, cancellation are typed and attributable", async () => {
  for (const status of ["queued", "running", "succeeded", "failed", "timedOut", "canceled"]) {
    const f = fixture({ status });
    assert.equal((await f.gateway.execute(caller(), request())).status, status);
  }
  const f = fixture();
  assert.equal((await f.gateway.cancel(caller(), "run-1")).status, "canceled");
  assert.deepEqual(f.history, ["discover", "cancel"]);
  await denied("not_found", () => f.gateway.cancel(caller(), "foreign-run"));
  assert.deepEqual(f.history, ["discover", "cancel"]);
});

test("PER-1092 RED: run lookup checks tenant ownership before provider I/O", async () => {
  const f = fixture();
  await denied("not_found", () => f.gateway.getRun(caller(), "foreign-run"));
  assert.deepEqual(f.history, []);
  assert.equal((await f.gateway.getRun(caller("read"), "run-1")).runId, "run-1");
});

test("PER-1092 RED: event parsing rejects cross-tenant, duplicated/out-of-order and oversized event data", async () => {
  const base = { eventId: "evt-1", tenantId: "tenant-A", runId: "run-1", traceId: "trace-1", sequence: 1, status: "running" };
  assert.equal(parseHarnessRunEvent(base, request()).eventId, "evt-1");
  assert.throws(() => parseHarnessRunEvent({ ...base, tenantId: "tenant-B" }, request()));
  assert.throws(() => parseHarnessRunEvent({ ...base, rawPrompt: "sensitive user payload" }, request()));
  for (const events of [
    [base, base],
    [{ ...base, sequence: 2 }, { ...base, eventId: "evt-2", sequence: 1 }],
    [{ ...base, eventId: "evt-1", sequence: 0 }],
  ]) {
    const f = fixture({ events });
    await denied("invalid_event", async () => { for await (const _ of f.gateway.events(caller("read"), "run-1", request())) void _; });
  }
});

test("PER-1092 RED: healthy/read/config operations need authenticated scope, do not leak credential", async () => {
  const f = fixture();
  assert.equal(await f.gateway.health(caller("read")), "healthy");
  assert.equal(await f.gateway.validateConfiguration(caller(), "opaque-secret-ref"), true);
  assert.deepEqual(f.audit, ["validateConfiguration"]);
  const f2 = fixture();
  await denied("unauthorized", () => f2.gateway.health(caller("revoked")));
  assert.deepEqual(f2.history, []);
});

test("PER-1102: repeat and concurrent same-key requests execute exactly once", async () => {
  const f = fixture();
  const [one, two] = await Promise.all([
    f.gateway.execute(caller(), request()),
    f.gateway.execute(caller(), request()),
  ]);
  assert.deepEqual(one, two);
  assert.equal(f.history.filter((name) => name === "execute").length, 1);
  assert.deepEqual(f.audit, ["executeTest"]);
  const replay = await f.gateway.execute(caller(), request());
  assert.deepEqual(replay, one);
  assert.equal(f.history.filter((name) => name === "execute").length, 1);
  await denied("idempotency_conflict", () => f.gateway.execute(caller(), { ...request(), testSuiteHash: hash }));
  await denied("idempotency_conflict", () => f.gateway.execute(caller(), {
    ...request(), idempotencyKey: "other",
  }));
});

test("PER-1102: adapter errors and forged run identity are sanitized", async () => {
  const failure = fixture({ fail: true });
  await denied("provider_unavailable", () => failure.gateway.execute(caller(), request()));
  assert.deepEqual(failure.audit, []);
  const forged = fixture({ malformedRun: true });
  await denied("invalid_response", () => forged.gateway.execute(caller(), request()));
  assert.deepEqual(forged.audit, []);
});

test("PER-1102: event delivery is ordered, tenant-bound, and stops at terminal state", async () => {
  const f = fixture({ events: [
    { eventId: "evt-1", tenantId: "tenant-A", runId: "run-1", traceId: "trace-1", sequence: 1, status: "running" },
    { eventId: "evt-2", tenantId: "tenant-A", runId: "run-1", traceId: "trace-1", sequence: 3, status: "succeeded" },
    { eventId: "evt-3", tenantId: "tenant-A", runId: "run-1", traceId: "trace-1", sequence: 4, status: "failed" },
  ] });
  const statuses: string[] = [];
  for await (const e of f.gateway.events(caller("read"), "run-1", request())) statuses.push(e.status);
  assert.deepEqual(statuses, ["running", "succeeded"]);
  const foreign = fixture();
  await denied("not_found", async () => {
    for await (const _ of foreign.gateway.events(caller("read"), "unknown-run", request())) void _;
  });
  assert.deepEqual(foreign.history, []);
});

test("PER-1102: invalid credential and untrusted accessors cannot run side effects", async () => {
  const f = fixture();
  const suspicious = { ...request() };
  Object.defineProperty(suspicious, "inputRef", { enumerable: true, get() { throw new Error("secret getter"); } });
  await denied("invalid_payload", () => f.gateway.execute(caller(), suspicious));
  assert.deepEqual(f.history, []);
  const g = fixture();
  await denied("insufficient_scope", () => g.gateway.cancel(caller("read"), "run-1"));
  assert.deepEqual(g.history, []);
});

test("PER-1102: declared concurrency and budget are enforced before execute", async () => {
  const f = fixture();
  await denied("invalid_payload", () => f.gateway.execute(caller(), {
    ...request(), budget: { maxDurationMs: 40_000, maxCostUsd: 0.25 },
  }));
  assert.deepEqual(f.history, ["discover"]);
});
