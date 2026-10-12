import type {
  HarnessTelemetryBatchV1, HarnessTelemetryCoverage, HarnessTelemetrySend, HarnessTelemetrySpanV1,
} from "@savant/types/harness-telemetry";

export class HarnessTelemetryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "HarnessTelemetryError";
    this.code = code;
  }
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = ["workflow", "step", "tool", "model"] as const;
const STATUS = ["started", "completed", "failed", "canceled"] as const;
const KEYS = ["schemaVersion", "tenantId", "adapterId", "runId", "traceId", "spanId", "parentSpanId",
  "nodeId", "specVersionHash", "testSuiteHash", "kind", "status", "startedAtMs", "durationMs",
  "inputTokens", "outputTokens", "estimatedCostUsd", "captureLevel"] as const;
const REQUIRED = KEYS.filter(key => !["parentSpanId", "nodeId", "durationMs", "inputTokens",
  "outputTokens", "estimatedCostUsd"].includes(key));

function fail(code: string): never { throw new HarnessTelemetryError(code); }
function id(v: unknown): v is string { return typeof v === "string" && ID.test(v); }
function amount(v: unknown, upper: number, integer = false): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= upper &&
    (!integer || Number.isSafeInteger(v));
}
/** No-content parser. Rejects inherited/accessor/prototype-pollution and unknown fields before serialization. */
export function parseHarnessTelemetrySpan(value: unknown): HarnessTelemetrySpanV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    fail("invalid_telemetry");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.entries(descriptors).some(([key, descriptor]) => !KEYS.includes(key as typeof KEYS[number]) ||
      !("value" in descriptor) || ["__proto__", "constructor", "prototype"].includes(key)))
    fail("invalid_telemetry");
  const root = value as Record<string, unknown>;
  if (REQUIRED.some(key => !Object.hasOwn(root, key)) || root.schemaVersion !== 1 ||
      !id(root.tenantId) || !id(root.adapterId) || !id(root.runId) || !id(root.traceId) ||
      !id(root.spanId) || !HASH.test(root.specVersionHash as string) ||
      !HASH.test(root.testSuiteHash as string) ||
      !KINDS.includes(root.kind as typeof KINDS[number]) ||
      !STATUS.includes(root.status as typeof STATUS[number]) ||
      !["none", "metadata"].includes(root.captureLevel as string) ||
      !amount(root.startedAtMs, Number.MAX_SAFE_INTEGER, true))
    fail("invalid_telemetry");
  if (root.parentSpanId !== undefined && (!id(root.parentSpanId) || root.parentSpanId === root.spanId))
    fail("invalid_telemetry");
  if (root.nodeId !== undefined && !id(root.nodeId)) fail("invalid_telemetry");
  for (const field of ["durationMs", "inputTokens", "outputTokens"] as const)
    if (root[field] !== undefined && !amount(root[field], 1_000_000_000, true)) fail("invalid_telemetry");
  if (root.estimatedCostUsd !== undefined && !amount(root.estimatedCostUsd, 100_000))
    fail("invalid_telemetry");
  // An owned snapshot ensures callers cannot mutate queued telemetry after validation.
  const encoded = JSON.stringify(root);
  if (encoded.length > 8192) fail("invalid_telemetry");
  return JSON.parse(encoded) as HarnessTelemetrySpanV1;
}

const stringIdSchema = { type: "string", pattern: ID.source, maxLength: 128 } as const;
const stringHashSchema = { type: "string", pattern: HASH.source, minLength: 64, maxLength: 64 } as const;
export const harnessTelemetrySpanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/harness-telemetry/span-v1.json",
  type: "object", additionalProperties: false,
  required: REQUIRED,
  properties: {
    schemaVersion: { const: 1 },
    tenantId: stringIdSchema, adapterId: stringIdSchema, runId: stringIdSchema,
    traceId: stringIdSchema, spanId: stringIdSchema, parentSpanId: stringIdSchema, nodeId: stringIdSchema,
    specVersionHash: stringHashSchema, testSuiteHash: stringHashSchema,
    kind: { enum: KINDS }, status: { enum: STATUS },
    startedAtMs: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    durationMs: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
    inputTokens: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
    outputTokens: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
    estimatedCostUsd: { type: "number", minimum: 0, maximum: 100_000 },
    captureLevel: { enum: ["none", "metadata"] },
  },
} as const;

export function createHarnessTelemetryBuffer(config: {
  enabled: boolean;
  tenantId: string;
  adapterId: string;
  traceId: string;
  /** Backpressure is lossless: full queue refuses new events. Defaults 256, maximum 1000. */
  maxPending?: number;
  batchSize?: number;
  send: HarnessTelemetrySend;
}) {
  if (!id(config.tenantId) || !id(config.adapterId) || !id(config.traceId) ||
      typeof config.send !== "function")
    fail("invalid_configuration");
  const maxPending = config.maxPending ?? 256;
  const batchSize = config.batchSize ?? 100;
  if (!amount(maxPending, 1000, true) || maxPending < 1 ||
      !amount(batchSize, 100, true) || batchSize < 1)
    fail("invalid_configuration");
  const queued: HarnessTelemetrySpanV1[] = [];
  const seen = new Set<string>();
  let acknowledged = 0;
  let pendingFlush: Promise<number> | null = null;
  function record(input: unknown): boolean {
    if (!config.enabled) return false; // Disabled means absolutely no parsing or transport.
    const item = parseHarnessTelemetrySpan(input);
    if (item.tenantId !== config.tenantId || item.adapterId !== config.adapterId ||
        item.traceId !== config.traceId) fail("identity_mismatch");
    const key = item.runId + ":" + item.spanId + ":" + item.status;
    if (seen.has(key)) return false;
    if (queued.length >= maxPending) fail("backpressure");
    // Prevent unbounded history growth; replays beyond this window require server-side idempotency.
    if (seen.size >= 2048) seen.delete(seen.values().next().value!);
    seen.add(key);
    queued.push(item);
    return true;
  }
  async function flush(): Promise<number> {
    if (!config.enabled || queued.length === 0) return 0;
    if (pendingFlush) return pendingFlush;
    const promise = (async () => {
      const spans = queued.slice(0, batchSize);
      const batchId = "b:" + config.traceId + ":" + acknowledged + ":" + spans[0]!.spanId + ":" + spans.at(-1)!.spanId;
      const batch: HarnessTelemetryBatchV1 = {
        schemaVersion: 1, tenantId: config.tenantId, adapterId: config.adapterId,
        traceId: config.traceId, batchId, cursor: acknowledged, spans,
      };
      let response: { batchId: string; acceptedCursor: number };
      try { response = await config.send(batch); }
      catch { fail("transport_unavailable"); }
      if (!response || response.batchId !== batchId || response.acceptedCursor !== acknowledged + spans.length)
        fail("invalid_ack");
      queued.splice(0, spans.length);
      acknowledged += spans.length;
      return spans.length;
    })();
    pendingFlush = promise;
    try { return await promise; } finally { pendingFlush = null; }
  }
  return { record, flush, pendingCount: () => queued.length };
}

/** Only expected graph step IDs count as observed; never report whole-provider capture. */
export function summarizeHarnessCoverage(expected: readonly string[], spans: readonly HarnessTelemetrySpanV1[]): HarnessTelemetryCoverage {
  const expectedIds = [...new Set(expected)].sort();
  if (expectedIds.some(step => !id(step))) fail("invalid_telemetry");
  const observed = new Set<string>();
  for (const span of spans) {
    const validated = parseHarnessTelemetrySpan(span);
    if (validated.kind === "step" && validated.nodeId && expectedIds.includes(validated.nodeId))
      observed.add(validated.nodeId);
  }
  const observedStepIds = [...observed].sort();
  const missingStepIds = expectedIds.filter(id => !observed.has(id));
  return { completeness: observedStepIds.length === 0 ? "none" :
      missingStepIds.length > 0 ? "partial" : "complete",
    observedStepIds, missingStepIds };
}
