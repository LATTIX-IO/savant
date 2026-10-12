import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessReservationStore, HarnessReservationError } from "./invocation-reservations.ts";

const org = "11111111-1111-4111-8111-111111111111";
const caps = {
  protocol: { major: 1, minor: 0 },
  adapterId: "sandbox-adapter",
  features: { execute: true, observe: true, cancel: true, events: true },
  coverage: { execution: "partial", observation: "partial" },
  limits: { maxConcurrency: 2, maxDurationMs: 30000, maxCostUsd: 1 },
};
const payload = () => ({
  tenantId: org, adapterId: "sandbox-adapter", actor: "tester",
  runId: "run-1", traceId: "trace-1", idempotencyKey: "idem-1",
  specVersionHash: "a".repeat(64), testSuiteHash: "b".repeat(64),
  inputRef: "fixture-1", budget: { maxDurationMs: 1000, maxCostUsd: 0.25 },
  capture: { level: "metadata", retentionDays: 7, residency: "us-east-1" },
});
const fail = (code: string, fn: () => Promise<unknown> | unknown) =>
  assert.rejects(async () => { await fn(); },
    (e: unknown) => e instanceof HarnessReservationError && e.code === code);

function harness(limits = { maxActive: 2, maxReservedCostUsd: 0.5 }) {
  let io = 0;
  // This fake provider is intentionally not a valid SQL service: dangerous
  // requests must be denied before a transaction or any I/O attempt.
  const neverSql = Object.assign(async () => {
    io++;
    throw new Error("UNEXPECTED_DB_ACCESS");
  }, { begin: async () => { io++; throw new Error("UNEXPECTED_DB_ACCESS"); } });
  const store = createHarnessReservationStore({
    sql: neverSql as never, now: () => new Date("2026-10-12T12:00:00Z"), limits,
  });
  return { store, io: () => io };
}

test("PER-1059: invalid store quotas fail closed before IO", () => {
  for (const limits of [
    { maxActive: 0, maxReservedCostUsd: 1 },
    { maxActive: 1001, maxReservedCostUsd: 1 },
    { maxActive: 1.5, maxReservedCostUsd: 1 },
    { maxActive: 1, maxReservedCostUsd: -1 },
    { maxActive: 1, maxReservedCostUsd: Number.POSITIVE_INFINITY },
  ]) assert.throws(() => harness(limits), (e: unknown) =>
    e instanceof HarnessReservationError);
});

test("PER-1059: forged tenant and actor rejected before database IO", async () => {
  const h = harness();
  await fail("unauthorized", () => h.store.reserve({
    organizationId: "22222222-2222-4222-8222-222222222222", actorSubject: "tester",
    request: payload(), capabilities: caps,
  }));
  await fail("unauthorized", () => h.store.reserve({
    organizationId: org, actorSubject: "other", request: payload(), capabilities: caps,
  }));
  await fail("unauthorized", () => h.store.reserve({
    organizationId: "untrusted\nvalue", actorSubject: "tester", request: payload(), capabilities: caps,
  }));
  assert.equal(h.io(), 0);
});

test("PER-1059: invalid budget/adapter capability and malformed content are denied before database IO", async () => {
  const h = harness();
  await fail("quota_exceeded", () => h.store.reserve({
    organizationId: org, actorSubject: "tester",
    request: { ...payload(), budget: { maxDurationMs: 1000, maxCostUsd: 0.75 } },
    capabilities: caps,
  }));
  await fail("unsupported", () => h.store.reserve({
    organizationId: org, actorSubject: "tester", request: payload(),
    capabilities: { ...caps, features: { ...caps.features, execute: false, cancel: false },
      coverage: { ...caps.coverage, execution: "unsupported" } },
  }));
  const unsafe = payload();
  Object.defineProperty(unsafe, "inputRef", {
    enumerable: true,
    get() { throw Error("credential exfiltration"); },
  });
  await assert.rejects(() => h.store.reserve({
    organizationId: org, actorSubject: "tester", request: unsafe, capabilities: caps,
  }));
  assert.equal(h.io(), 0);
});

test("PER-1059: cross-tenant run lookup/cancel rejects malformed run IDs before I/O", async () => {
  const h = harness();
  await fail("not_found", () => h.store.getRun(org, "../../foreign"));
  await fail("not_found", () => h.store.requestCancel(org, "bad\nid"));
  await fail("not_found", () => h.store.markRunning(org, "bad/request", "external"));
  await fail("not_found", () => h.store.applyEvent(org, "bad/request", {}));
  assert.equal(h.io(), 0);
});
