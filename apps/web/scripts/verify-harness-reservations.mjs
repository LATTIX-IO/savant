import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createHarnessReservationStore, HarnessReservationError } from "../src/server/harness/invocation-reservations.ts";

const url = process.env.DATABASE_URL;
if (!url || process.env.SAVANT_HARNESS_SCHEMA_TEST !== "1" ||
    !["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)) {
  throw new Error("Harness integration test requires explicit isolated local PostgreSQL opt-in.");
}
const sql = postgres(url, { max: 8, prepare: false });
const hashA = "a".repeat(64), hashB = "b".repeat(64);
const stamp = randomUUID().slice(0, 8);
const nowValue = { at: new Date("2026-10-12T12:00:00.000Z") };
let orgA, orgB;
const caps = {
  protocol: { major: 1, minor: 0 },
  adapterId: "sandbox-adapter",
  features: { execute: true, observe: true, cancel: true, events: true },
  coverage: { execution: "partial", observation: "partial" },
  limits: { maxConcurrency: 2, maxDurationMs: 30000, maxCostUsd: 1 },
};
const request = (tenantId, runId, extras = {}) => ({
  tenantId, adapterId: "sandbox-adapter", actor: "test-operator",
  runId, idempotencyKey: "submit-" + runId,
  traceId: "trace-" + runId,
  specVersionHash: hashA, testSuiteHash: hashB,
  inputRef: "fixture-golden", budget: { maxDurationMs: 5000, maxCostUsd: 0.25 },
  capture: { level: "metadata", retentionDays: 7, residency: "us-east-1" },
  ...extras,
});
const event = (tenantId, runId, eventId, sequence, status, traceId = "trace-" + runId) => ({
  eventId, tenantId, runId, traceId, sequence, status,
});
const denied = async (code, fn) => assert.rejects(fn, e =>
  e instanceof HarnessReservationError && e.code === code);
try {
  const [a] = await sql`
    insert into organizations (slug,display_name)
    values (${"broker-a-" + stamp},'Broker test A') returning id
  `;
  const [b] = await sql`
    insert into organizations (slug,display_name)
    values (${"broker-b-" + stamp},'Broker test B') returning id
  `;
  orgA = a.id; orgB = b.id;
  const store = () => createHarnessReservationStore({
    sql, now: () => nowValue.at, limits: { maxActive: 2, maxReservedCostUsd: 0.5 },
  });
  const s1 = store(), s2 = store();
  // Reject unauthenticated/foreign actor before touching database.
  await denied("unauthorized", () => s1.reserve({
    organizationId: orgA, actorSubject: "test-operator",
    request: request(orgB, "foreign"), capabilities: caps,
  }));
  await denied("unauthorized", () => s1.reserve({
    organizationId: orgA, actorSubject: "test-operator",
    request: request(orgA, "wrong-actor", { actor: "other" }), capabilities: caps,
  }));
  assert.equal((await sql`select count(*)::int as n from harness_eval_runs`)[0].n, 0);

  const r1 = request(orgA, "run-one"), r2 = request(orgA, "run-two");
  const bookings = await Promise.all([
    s1.reserve({ organizationId: orgA, actorSubject: "test-operator", request: r1, capabilities: caps }),
    s2.reserve({ organizationId: orgA, actorSubject: "test-operator", request: r2, capabilities: caps }),
  ]);
  assert.deepEqual(bookings.map(x => x.status), ["queued", "queued"]);
  assert.ok(bookings.every(x => x.replay === false));

  // Durable replay across separate store instances (represents another process).
  const replay = await s2.reserve({
    organizationId: orgA, actorSubject: "test-operator", request: r1, capabilities: caps,
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.runId, r1.runId);
  await denied("idempotency_conflict", () => s1.reserve({
    organizationId: orgA, actorSubject: "test-operator",
    request: { ...r1, testSuiteHash: hashA }, capabilities: caps,
  }));
  await denied("idempotency_conflict", () => s1.reserve({
    organizationId: orgA, actorSubject: "test-operator",
    request: { ...r1, idempotencyKey: "another" }, capabilities: caps,
  }));
  await denied("quota_exceeded", () => s1.reserve({
    organizationId: orgA, actorSubject: "test-operator",
    request: request(orgA, "run-three"), capabilities: caps,
  }));
  assert.equal((await sql`select count(*)::int as n from harness_eval_runs where organization_id=${orgA}`)[0].n, 2);

  // Tenant-owned read and cancel must not leak foreign run metadata.
  await denied("not_found", () => s1.getRun(orgB, "run-one"));
  await denied("not_found", () => s1.requestCancel(orgB, "run-one"));
  await denied("not_found", () => s1.applyEvent(orgB, "run-one",
    event(orgB, "run-one", "e-foreign", 1, "running")));
  await denied("not_found", () => s1.getRun(orgA, "nonexistent"));
  assert.equal((await s2.getRun(orgA, "run-one")).status, "queued");

  // Cancel-before-dispatch and late success cannot override a user's cancellation.
  assert.equal((await s1.requestCancel(orgA, "run-one")).status, "cancelRequested");
  await denied("invalid_transition", () => s1.markRunning(orgA, "run-one", "external-one"));
  await denied("cancel_race", () => s1.applyEvent(orgA, "run-one",
    event(orgA, "run-one", "e-success-late", 1, "succeeded")));
  assert.equal((await sql`select count(*)::int as n from harness_eval_events where organization_id=${orgA}`)[0].n, 0);
  assert.equal((await s1.applyEvent(orgA, "run-one",
    event(orgA, "run-one", "e-cancel", 1, "canceled"))).status, "canceled");
  assert.equal((await s2.requestCancel(orgA, "run-one")).status, "canceled");
  assert.equal((await s1.applyEvent(orgA, "run-one",
    event(orgA, "run-one", "e-cancel", 1, "canceled"))).replay, true);
  await denied("late_event", () => s1.applyEvent(orgA, "run-one",
    event(orgA, "run-one", "e-unauthorized-late", 2, "succeeded")));
  await denied("event_conflict", () => s1.applyEvent(orgA, "run-one",
    event(orgA, "run-one", "e-cancel", 1, "failed")));

  const r3 = await s1.reserve({
    organizationId: orgA, actorSubject: "test-operator",
    request: request(orgA, "run-three"), capabilities: caps,
  });
  assert.equal(r3.status, "queued");

  assert.equal((await s1.markRunning(orgA, "run-two", "external-two")).status, "running");
  assert.equal((await s2.markRunning(orgA, "run-two", "external-two")).status, "running");
  await denied("invalid_transition", () => s1.markRunning(orgA, "run-two", "forged-external"));
  await denied("invalid_event", () => s1.applyEvent(orgA, "run-two",
    { ...event(orgA, "run-two", "e-bad", 1, "running"), rawPrompt: "prod-secret" }));
  await denied("invalid_event", () => s1.applyEvent(orgA, "run-two",
    event(orgB, "run-two", "e-tenant-forged", 1, "running")));
  await denied("invalid_event", () => s1.applyEvent(orgA, "run-two",
    event(orgA, "run-two", "e-trace-forged", 1, "running", "wrong-trace")));
  const signedDelivery = { deliveryId: "delivery-one", payloadSha256: "c".repeat(64) };
  const runningEvent = event(orgA, "run-two", "e-running", 1, "running");
  const concurrentDeliveries = await Promise.all([
    s1.applyEvent(orgA, "run-two", runningEvent, signedDelivery),
    s2.applyEvent(orgA, "run-two", runningEvent, signedDelivery),
  ]);
  assert.equal(concurrentDeliveries.filter(r => r.replay === false).length, 1);
  assert.equal(concurrentDeliveries.filter(r => r.replay === true).length, 1);
  assert.ok(concurrentDeliveries.every(r => r.latestSequence === 1));
  // Exactly one signed receipt, atomically attached to the accepted event.
  assert.equal((await sql`select count(*)::int as n from harness_eval_deliveries where organization_id=${orgA}`)[0].n, 1);
  const replaySigned = await s2.applyEvent(orgA, "run-two", runningEvent, signedDelivery);
  assert.equal(replaySigned.replay, true);
  await denied("delivery_conflict", () => s2.applyEvent(orgA, "run-two", runningEvent,
    { ...signedDelivery, payloadSha256: "d".repeat(64) }));
  await denied("delivery_conflict", () => s2.applyEvent(orgA, "run-two",
    event(orgA, "run-two", "different-event-id", 2, "succeeded"), signedDelivery));
  await denied("invalid_delivery", () => s2.applyEvent(orgA, "run-two",
    event(orgA, "run-two", "forged-delivery", 2, "succeeded"),
    { deliveryId: "invalid\nvalue", payloadSha256: "d".repeat(64) }));
  assert.equal((await sql`select count(*)::int as n from harness_eval_deliveries where organization_id=${orgA}`)[0].n, 1);
  await denied("not_found", () => s1.applyEvent(orgB, "run-two",
    runningEvent, signedDelivery));
  await denied("out_of_order", () => s1.applyEvent(orgA, "run-two",
    event(orgA, "run-two", "e-sequence-replay", 1, "succeeded")));
  assert.equal((await s1.applyEvent(orgA, "run-two",
    event(orgA, "run-two", "e-done", 2, "succeeded"))).status, "succeeded");
  assert.equal((await s2.getRun(orgA, "run-two")).status, "succeeded");

  // Reconciliation frees stale quota but never reopens a terminal state.
  nowValue.at = new Date(nowValue.at.getTime() + 6000);
  assert.equal(await s2.expireDue(orgA), 1);
  assert.equal((await s1.getRun(orgA, "run-three")).status, "timedOut");
  assert.equal(await s1.expireDue(orgA), 0);
  await denied("late_event", () => s1.applyEvent(orgA, "run-three",
    event(orgA, "run-three", "e-late", 1, "succeeded")));
  // Schema-level composite FK rejects cross-tenant event grafting.
  const [run] = await sql`select id from harness_eval_runs where organization_id=${orgA} and run_id='run-two'`;
  let foreignDenied = false;
  try {
    await sql`insert into harness_eval_events
      (organization_id,harness_run_id,event_id,sequence,status,trace_id)
      values (${orgB},${run.id},'forged-db',100,'succeeded','trace-run-two')`;
  } catch (error) {
    foreignDenied = error.code === "23503";
    if (!foreignDenied) throw error;
  }
  assert.equal(foreignDenied, true);
  const audit = await sql`
    select action,count(*)::int as n from harness_eval_transitions
    where organization_id=${orgA} group by action
  `;
  assert.ok(audit.some(x => x.action === "reserved" && x.n === 3));
  assert.ok(audit.some(x => x.action === "cancelRequested" && x.n === 1));
  assert.ok(audit.some(x => x.action === "expired" && x.n === 1));
  assert.equal((await sql`select count(*)::int as n from harness_eval_runs where organization_id=${orgB}`)[0].n, 0);
  await sql`delete from organizations where id=${orgA}`;
  orgA = null;
  assert.equal((await sql`select count(*)::int as n from harness_eval_events`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from harness_eval_deliveries`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from harness_eval_transitions`)[0].n, 0);
  console.log(JSON.stringify({
    harnessReservations: "passed",
    assertions: [
      "tenant-matched authorization", "durable cross-process replay", "tenant quotas",
      "duplicate run/receipt safety", "cancel-vs-complete race", "deadline recovery",
      "malicious event rejection", "DB composite tenant FK", "transactional audit", "cascade",
    ],
  }));
} finally {
  if (orgA) await sql`delete from organizations where id=${orgA}`;
  if (orgB) await sql`delete from organizations where id=${orgB}`;
  await sql.end({ timeout: 5 });
}
