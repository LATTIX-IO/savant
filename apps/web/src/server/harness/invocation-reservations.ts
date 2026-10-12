/**
 * PER-1059 increment 1. Durable private reservation store, NOT a public API.
 * AuthN/AuthZ of callers, provenance and webhook signatures MUST precede use.
 * Execution stays in the customer's harness.
 */
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import type { HarnessAdapterCapabilities, HarnessRunEvent } from "@savant/types/harness-adapter";
import { parseHarnessCapabilities, parseHarnessRunEvent, validateHarnessTestRequest } from "@savant/schemas/harness-adapter";

type State = "queued" | "running" | "cancelRequested" | "succeeded" | "failed" | "timedOut" | "canceled";
type RunRow = {
  id: string; organization_id: string; run_id: string; adapter_id: string;
  idempotency_key: string; request_digest: string; actor_subject: string;
  trace_id: string; spec_version_hash: string; test_suite_hash: string;
  status: State; external_run_id: string | null; latest_event_sequence: string | number;
  deadline_at: Date; max_cost_usd: string;
};
const TENANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TERMINAL: ReadonlySet<State> = new Set(["succeeded", "failed", "timedOut", "canceled"]);
export class HarnessReservationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "HarnessReservationError"; this.code = code; }
}
function reject(code: string): never { throw new HarnessReservationError(code); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function micros(usd: number): bigint {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0 || usd > 100000) reject("invalid_budget");
  const units = Math.round(usd * 1_000_000);
  if (!Number.isSafeInteger(units) || Math.abs(usd * 1_000_000 - units) > 0.00001) reject("invalid_budget");
  return BigInt(units);
}
function checkActor(organizationId: string, actorSubject: string): void {
  if (typeof organizationId !== "string" || !TENANT.test(organizationId) ||
    typeof actorSubject !== "string" || !IDENT.test(actorSubject)) reject("unauthorized");
}
function checkRunId(runId: string): void {
  if (typeof runId !== "string" || !IDENT.test(runId)) reject("not_found");
}
function output(row: RunRow) {
  return {
    tenantId: row.organization_id, adapterId: row.adapter_id, runId: row.run_id,
    traceId: row.trace_id, specVersionHash: row.spec_version_hash,
    testSuiteHash: row.test_suite_hash, status: row.status,
    externalRunId: row.external_run_id, latestSequence: Number(row.latest_event_sequence),
    deadlineAt: new Date(row.deadline_at).toISOString(),
  };
}
export interface HarnessReservationLimits {
  maxActive: number;
  maxReservedCostUsd: number;
}
export function createHarnessReservationStore(deps: {
  sql: Sql; now: () => Date; limits: HarnessReservationLimits;
}) {
  const { sql } = deps;
  if (!Number.isSafeInteger(deps.limits.maxActive) || deps.limits.maxActive < 1 ||
      deps.limits.maxActive > 1000) reject("invalid_configuration");
  const maxMicro = micros(deps.limits.maxReservedCostUsd);
  function clock(): Date {
    const date = deps.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) reject("invalid_configuration");
    return date;
  }
  return {
    async reserve(input: {
      organizationId: string; actorSubject: string;
      request: unknown; capabilities: HarnessAdapterCapabilities;
    }) {
      checkActor(input.organizationId, input.actorSubject);
      const capabilities = parseHarnessCapabilities(input.capabilities);
      if (!capabilities.features.execute) reject("unsupported");
      const request = validateHarnessTestRequest(input.request, capabilities);
      if (request.tenantId !== input.organizationId || request.actor !== input.actorSubject)
        reject("unauthorized");
      const cost = micros(request.budget.maxCostUsd);
      if (cost > maxMicro) reject("quota_exceeded");
      const at = clock(), deadline = new Date(at.getTime() + request.budget.maxDurationMs);
      const requestDigest = digest(request);
      return sql.begin(async tx => {
        // All tenant reservations lock the same authoritative row; safe across processes.
        const tenants = await tx<{ id: string }[]>`
          select id from organizations where id=${input.organizationId} for update
        `;
        if (!tenants.length) reject("not_found");
        const existing = await tx<RunRow[]>`
          select * from harness_eval_runs
          where organization_id=${input.organizationId} and idempotency_key=${request.idempotencyKey}
        `;
        if (existing.length) {
          if (existing[0]!.request_digest !== requestDigest) reject("idempotency_conflict");
          return { ...output(existing[0]!), replay: true };
        }
        const reused = await tx<{ id: string }[]>`
          select id from harness_eval_runs where organization_id=${input.organizationId} and run_id=${request.runId}
        `;
        if (reused.length) reject("idempotency_conflict");
        const active = await tx<{ active_count: number; reserved_micros: string }[]>`
          select count(*)::int as active_count,
            coalesce(round(sum(max_cost_usd)*1000000)::bigint,0)::text as reserved_micros
          from harness_eval_runs where organization_id=${input.organizationId}
            and status in ('queued','running','cancelRequested')
        `;
        if ((active[0]?.active_count ?? 0) >= deps.limits.maxActive ||
            BigInt(active[0]?.reserved_micros ?? "0") + cost > maxMicro) reject("quota_exceeded");
        const rows = await tx<RunRow[]>`
          insert into harness_eval_runs (
            organization_id,adapter_id,run_id,actor_subject,idempotency_key,request_digest,
            spec_version_hash,test_suite_hash,trace_id,input_ref,max_cost_usd,
            max_duration_ms,capture_level,retention_days,residency,deadline_at
          ) values (
            ${input.organizationId},${request.adapterId},${request.runId},${input.actorSubject},
            ${request.idempotencyKey},${requestDigest},${request.specVersionHash},
            ${request.testSuiteHash},${request.traceId},${request.inputRef},
            ${request.budget.maxCostUsd},${request.budget.maxDurationMs},
            ${request.capture.level},${request.capture.retentionDays},${request.capture.residency},${deadline}
          ) returning *
        `;
        const row = rows[0]!;
        await tx`
          insert into harness_eval_transitions (organization_id,harness_run_id,action,to_status)
          values (${input.organizationId},${row.id},'reserved','queued')
        `;
        return { ...output(row), replay: false };
      });
    },
    async getRun(organizationId: string, runId: string) {
      if (typeof organizationId !== "string" || !TENANT.test(organizationId)) reject("unauthorized");
      checkRunId(runId);
      const rows = await sql<RunRow[]>`
        select * from harness_eval_runs where organization_id=${organizationId} and run_id=${runId}
      `;
      if (!rows.length) reject("not_found");
      return output(rows[0]!);
    },
    // Internal authenticated dispatch acknowledgement; not a user-reachable route.
    async markRunning(organizationId: string, runId: string, externalRunId: string) {
      if (typeof organizationId !== "string" || !TENANT.test(organizationId)) reject("unauthorized");
      checkRunId(runId); checkRunId(externalRunId);
      return sql.begin(async tx => {
        const rows = await tx<RunRow[]>`
          select * from harness_eval_runs where organization_id=${organizationId}
            and run_id=${runId} for update
        `;
        const row = rows[0];
        if (!row) reject("not_found");
        if (row.status === "running" && row.external_run_id === externalRunId) return output(row);
        if (row.status !== "queued") reject("invalid_transition");
        const at = clock();
        if (new Date(row.deadline_at).getTime() <= at.getTime()) reject("deadline_exceeded");
        const updated = await tx<RunRow[]>`
          update harness_eval_runs set status='running',external_run_id=${externalRunId},
            updated_at=${at} where id=${row.id} and organization_id=${organizationId} returning *
        `;
        await tx`
          insert into harness_eval_transitions
            (organization_id,harness_run_id,action,from_status,to_status)
          values (${organizationId},${row.id},'started','queued','running')
        `;
        return output(updated[0]!);
      });
    },
    async requestCancel(organizationId: string, runId: string) {
      if (typeof organizationId !== "string" || !TENANT.test(organizationId)) reject("unauthorized");
      checkRunId(runId);
      return sql.begin(async tx => {
        const rows = await tx<RunRow[]>`
          select * from harness_eval_runs where organization_id=${organizationId}
            and run_id=${runId} for update
        `;
        const row = rows[0];
        if (!row) reject("not_found");
        if (row.status === "cancelRequested" || TERMINAL.has(row.status)) return output(row);
        const updated = await tx<RunRow[]>`
          update harness_eval_runs set status='cancelRequested',updated_at=${clock()}
          where organization_id=${organizationId} and id=${row.id} returning *
        `;
        await tx`
          insert into harness_eval_transitions
            (organization_id,harness_run_id,action,from_status,to_status)
          values (${organizationId},${row.id},'cancelRequested',${row.status},'cancelRequested')
        `;
        return output(updated[0]!);
      });
    },
    // Webhook signature and connector scope MUST be verified by an upstream controller.
    async applyEvent(organizationId: string, runId: string, rawEvent: unknown,
      delivery?: { deliveryId: string; payloadSha256: string }) {
      if (typeof organizationId !== "string" || !TENANT.test(organizationId)) reject("unauthorized");
      checkRunId(runId);
      if (delivery && (typeof delivery.deliveryId !== "string" || !IDENT.test(delivery.deliveryId) ||
          typeof delivery.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/.test(delivery.payloadSha256)))
        reject("invalid_delivery");
      return sql.begin(async tx => {
        const rows = await tx<RunRow[]>`
          select * from harness_eval_runs where organization_id=${organizationId}
            and run_id=${runId} for update
        `;
        const row = rows[0];
        if (!row) reject("not_found");
        let event: HarnessRunEvent;
        try {
          event = parseHarnessRunEvent(rawEvent, {
            tenantId: organizationId, runId, traceId: row.trace_id,
          });
        } catch { reject("invalid_event"); }
        if (!["running","succeeded","failed","timedOut","canceled"].includes(event.status))
          reject("invalid_event");
        if (delivery) {
          const received = await tx<{ event_id: string; payload_sha256: string }[]>`
            select event_id,payload_sha256 from harness_eval_deliveries
            where organization_id=${organizationId} and harness_run_id=${row.id}
              and delivery_id=${delivery.deliveryId}
          `;
          if (received.length) {
            const prior = received[0]!;
            if (prior.event_id !== event.eventId || prior.payload_sha256 !== delivery.payloadSha256)
              reject("delivery_conflict");
            return { ...output(row), replay: true };
          }
        }
        const previous = await tx<{ sequence: string; status: string; trace_id: string }[]>`
          select sequence::text,status,trace_id from harness_eval_events
          where organization_id=${organizationId} and harness_run_id=${row.id} and event_id=${event.eventId}
        `;
        if (previous.length) {
          const old = previous[0]!;
          if (old.sequence !== String(event.sequence) ||
              old.status !== event.status || old.trace_id !== event.traceId) reject("event_conflict");
          return { ...output(row), replay: true };
        }
        if (TERMINAL.has(row.status)) reject("late_event");
        if (event.sequence <= Number(row.latest_event_sequence)) reject("out_of_order");
        if (row.status === "cancelRequested" && !["canceled","timedOut","failed"].includes(event.status))
          reject("cancel_race");
        if (row.status === "queued" && event.status === "canceled") reject("invalid_transition");
        if (delivery) {
          await tx`
            insert into harness_eval_deliveries
              (organization_id,harness_run_id,delivery_id,event_id,payload_sha256)
            values (${organizationId},${row.id},${delivery.deliveryId},${event.eventId},${delivery.payloadSha256})
          `;
        }
        await tx`
          insert into harness_eval_events
            (organization_id,harness_run_id,event_id,sequence,status,trace_id)
          values (${organizationId},${row.id},${event.eventId},${event.sequence},${event.status},${event.traceId})
        `;
        const updated = await tx<RunRow[]>`
          update harness_eval_runs set status=${event.status},
            latest_event_sequence=${event.sequence},updated_at=${clock()}
          where organization_id=${organizationId} and id=${row.id} returning *
        `;
        await tx`
          insert into harness_eval_transitions
            (organization_id,harness_run_id,action,from_status,to_status,event_id)
          values (${organizationId},${row.id},'eventApplied',${row.status},${event.status},${event.eventId})
        `;
        return { ...output(updated[0]!), replay: false };
      });
    },
    // Reconciler-only: expire stale active reservations without accepting late success.
    async expireDue(organizationId: string) {
      if (typeof organizationId !== "string" || !TENANT.test(organizationId)) reject("unauthorized");
      return sql.begin(async tx => {
        const tenants = await tx<{ id: string }[]>`
          select id from organizations where id=${organizationId} for update
        `;
        if (!tenants.length) reject("not_found");
        const at = clock();
        const expired = await tx<RunRow[]>`
          update harness_eval_runs set status='timedOut',updated_at=${at}
          where organization_id=${organizationId} and status in ('queued','running','cancelRequested')
            and deadline_at<=${at}
          returning *
        `;
        for (const row of expired) {
          await tx`
            insert into harness_eval_transitions
              (organization_id,harness_run_id,action,to_status)
            values (${organizationId},${row.id},'expired','timedOut')
          `;
        }
        return expired.length;
      });
    },
  };
}
