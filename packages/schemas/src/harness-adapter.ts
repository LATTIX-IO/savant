import type {
  AdapterFeature, AdapterRunStatus, AdapterScope, HarnessAdapter, HarnessAdapterCapabilities,
  HarnessCaller, HarnessRun, HarnessRunEvent, HarnessTestRequest, VerifiedHarnessPrincipal,
} from "@savant/types/harness-adapter";

export class AdapterProtocolError extends Error {
  constructor(readonly code: string) {
    // Never reflect untrusted adapter text, tokens, payloads or tenant existence in errors.
    super(code);
    this.name = "AdapterProtocolError";
  }
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const FEATURES: readonly AdapterFeature[] = ["execute", "observe", "cancel", "events"];
const STATUSES: readonly AdapterRunStatus[] = ["queued", "running", "succeeded", "failed", "canceled", "timedOut"];
const TERMINAL: readonly AdapterRunStatus[] = ["succeeded", "failed", "canceled", "timedOut"];
const COVERAGE = ["complete", "partial", "unsupported"] as const;
type Plain = Record<string, unknown>;
function fail(code: string): never { throw new AdapterProtocolError(code); }

/** Verify a JSON-only, depth- and size-limited owned snapshot before reading any nested values. */
function snapshot(value: unknown): Plain {
  let nodes = 0;
  const inspect = (item: unknown, depth: number): void => {
    if (++nodes > 4096 || depth > 12) fail("invalid_payload");
    if (item === null || typeof item === "string" || typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))) return;
    if (typeof item !== "object") fail("invalid_payload");
    if (Array.isArray(item)) {
      if (item.length > 1000 || Object.keys(item).length !== item.length) fail("invalid_payload");
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
        if ("value" in descriptor) inspect(descriptor.value, depth + 1);
        else fail("invalid_payload");
      }
      return;
    }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      fail("invalid_payload");
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (key === "__proto__" || key === "prototype" || key === "constructor" || !("value" in descriptor))
        fail("invalid_payload");
      inspect(descriptor.value, depth + 1);
    }
  };
  inspect(value, 0);
  const encoded = JSON.stringify(value);
  if (!encoded || encoded.length > 65_536) fail("invalid_payload");
  const parsed: unknown = JSON.parse(encoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("invalid_payload");
  return parsed as Plain;
}
function object(value: unknown): Plain {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalid_payload");
  return value as Plain;
}
function fields(obj: Plain, required: string[], optional: string[] = []): void {
  if (required.some((key) => !Object.hasOwn(obj, key))) fail("invalid_payload");
  if (Object.keys(obj).some((key) => !required.includes(key) && !optional.includes(key))) fail("invalid_payload");
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) fail("invalid_payload");
  return value;
}
function positive(value: unknown, maximum: number, allowZero = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0) || value > maximum)
    fail("invalid_payload");
  return value;
}
function integer(value: unknown, maximum: number, allowZero = false): number {
  const number = positive(value, maximum, allowZero);
  if (!Number.isSafeInteger(number)) fail("invalid_payload");
  return number;
}

export const harnessAdapterCapabilitiesSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/harness-adapter/capabilities-v1.json",
  type: "object", additionalProperties: false,
  required: ["protocol", "adapterId", "features", "coverage", "limits"],
  properties: {
    protocol: { type: "object", additionalProperties: false, required: ["major", "minor"],
      properties: { major: { const: 1 }, minor: { type: "integer", minimum: 0, maximum: 32 } } },
    adapterId: { type: "string", pattern: ID.source },
    features: { type: "object", additionalProperties: false, required: FEATURES,
      properties: Object.fromEntries(FEATURES.map((feature) => [feature, { type: "boolean" }])) },
    coverage: { type: "object", additionalProperties: false, required: ["execution", "observation"],
      properties: { execution: { enum: COVERAGE }, observation: { enum: COVERAGE } } },
    limits: { type: "object", additionalProperties: false, required: ["maxConcurrency", "maxDurationMs", "maxCostUsd"],
      properties: { maxConcurrency: { type: "integer", minimum: 1, maximum: 1000 },
        maxDurationMs: { type: "integer", minimum: 1, maximum: 86_400_000 },
        maxCostUsd: { type: "number", exclusiveMinimum: 0, maximum: 100_000 } } },
  },
} as const;


const schemaId = { type: "string", pattern: ID.source } as const;
const schemaHash = { type: "string", pattern: HASH.source } as const;
export const harnessTestRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/harness-adapter/test-request-v1.json",
  type: "object", additionalProperties: false,
  required: ["tenantId", "adapterId", "actor", "runId", "traceId", "idempotencyKey",
    "specVersionHash", "testSuiteHash", "inputRef", "budget", "capture"],
  properties: {
    tenantId: schemaId, adapterId: schemaId, actor: schemaId, runId: schemaId,
    traceId: schemaId, idempotencyKey: schemaId, specVersionHash: schemaHash,
    testSuiteHash: schemaHash, inputRef: schemaId,
    budget: { type: "object", additionalProperties: false, required: ["maxDurationMs", "maxCostUsd"],
      properties: { maxDurationMs: { type: "integer", minimum: 1, maximum: 86_400_000 },
        maxCostUsd: { type: "number", exclusiveMinimum: 0, maximum: 100_000 } } },
    capture: { type: "object", additionalProperties: false, required: ["level", "retentionDays", "residency"],
      properties: { level: { enum: ["none", "metadata", "redacted"] },
        retentionDays: { type: "integer", minimum: 0, maximum: 30 }, residency: schemaId } },
  },
} as const;

export const harnessRunEventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/harness-adapter/run-event-v1.json",
  type: "object", additionalProperties: false,
  required: ["eventId", "tenantId", "runId", "traceId", "sequence", "status"],
  properties: {
    eventId: schemaId, tenantId: schemaId, runId: schemaId, traceId: schemaId,
    sequence: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    status: { enum: STATUSES },
  },
} as const;

export function parseHarnessCapabilities(input: unknown): HarnessAdapterCapabilities {
  const root = snapshot(input);
  fields(root, ["protocol", "adapterId", "features", "coverage", "limits"]);
  const protocol = object(root.protocol);
  fields(protocol, ["major", "minor"]);
  if (protocol.major !== 1) fail("unsupported_version");
  integer(protocol.minor, 32, true);
  identifier(root.adapterId);
  const features = object(root.features);
  fields(features, [...FEATURES]);
  for (const feature of FEATURES) if (typeof features[feature] !== "boolean") fail("invalid_capabilities");
  const coverage = object(root.coverage);
  fields(coverage, ["execution", "observation"]);
  if (!COVERAGE.includes(coverage.execution as typeof COVERAGE[number]) ||
      !COVERAGE.includes(coverage.observation as typeof COVERAGE[number]))
    fail("invalid_capabilities");
  const limits = object(root.limits);
  fields(limits, ["maxConcurrency", "maxDurationMs", "maxCostUsd"]);
  integer(limits.maxConcurrency, 1000);
  integer(limits.maxDurationMs, 86_400_000);
  positive(limits.maxCostUsd, 100_000);
  if ((!features.execute && (features.cancel || coverage.execution !== "unsupported")) ||
      (features.execute && coverage.execution === "unsupported") ||
      (!features.observe && (features.events || coverage.observation !== "unsupported")) ||
      (features.observe && coverage.observation === "unsupported"))
    fail("invalid_capabilities");
  return root as unknown as HarnessAdapterCapabilities;
}

export function validateHarnessTestRequest(input: unknown, capabilities: HarnessAdapterCapabilities): HarnessTestRequest {
  const root = snapshot(input);
  fields(root, ["tenantId", "adapterId", "actor", "runId", "traceId", "idempotencyKey",
    "specVersionHash", "testSuiteHash", "inputRef", "budget", "capture"]);
  for (const key of ["tenantId", "adapterId", "actor", "runId", "traceId", "idempotencyKey", "inputRef"])
    identifier(root[key]);
  if (root.adapterId !== capabilities.adapterId) fail("invalid_payload");
  for (const key of ["specVersionHash", "testSuiteHash"])
    if (typeof root[key] !== "string" || !HASH.test(root[key])) fail("invalid_payload");
  const budget = object(root.budget);
  fields(budget, ["maxDurationMs", "maxCostUsd"]);
  integer(budget.maxDurationMs, capabilities.limits.maxDurationMs);
  positive(budget.maxCostUsd, capabilities.limits.maxCostUsd);
  const capture = object(root.capture);
  fields(capture, ["level", "retentionDays", "residency"]);
  if (!["none", "metadata", "redacted"].includes(capture.level as string)) fail("invalid_payload");
  integer(capture.retentionDays, 30, true);
  identifier(capture.residency);
  return root as unknown as HarnessTestRequest;
}

function runResponse(input: unknown, tenantId: string, runId: string, adapterId: string,
  expected?: HarnessTestRequest): HarnessRun {
  const root = snapshot(input);
  fields(root, ["tenantId", "adapterId", "runId", "externalRunId", "traceId",
    "specVersionHash", "testSuiteHash", "status"]);
  for (const key of ["tenantId", "adapterId", "runId", "externalRunId", "traceId"]) identifier(root[key]);
  if (root.tenantId !== tenantId || root.adapterId !== adapterId || root.runId !== runId)
    fail("invalid_response");
  if (!STATUSES.includes(root.status as AdapterRunStatus)) fail("invalid_response");
  for (const key of ["specVersionHash", "testSuiteHash"])
    if (typeof root[key] !== "string" || !HASH.test(root[key])) fail("invalid_response");
  if (expected && (root.traceId !== expected.traceId ||
    root.specVersionHash !== expected.specVersionHash || root.testSuiteHash !== expected.testSuiteHash))
    fail("invalid_response");
  return root as unknown as HarnessRun;
}

export function parseHarnessRunEvent(input: unknown, expected: Pick<HarnessTestRequest, "tenantId" | "runId" | "traceId">): HarnessRunEvent {
  let root: Plain;
  try { root = snapshot(input); } catch { return fail("invalid_event"); }
  fieldsOrInvalidEvent(root, ["eventId", "tenantId", "runId", "traceId", "sequence", "status"]);
  if (root.tenantId !== expected.tenantId || root.runId !== expected.runId || root.traceId !== expected.traceId ||
      typeof root.eventId !== "string" || !ID.test(root.eventId) ||
      !Number.isSafeInteger(root.sequence as number) || (root.sequence as number) < 1 ||
      !STATUSES.includes(root.status as AdapterRunStatus))
    fail("invalid_event");
  return root as unknown as HarnessRunEvent;
}
function fieldsOrInvalidEvent(root: Plain, required: string[]) {
  try { fields(root, required); } catch { fail("invalid_event"); }
}

export interface HarnessGatewayDependencies {
  adapter: HarnessAdapter;
  /** MUST perform cryptographic authentication and revocation checking, not decode-only JWT parsing. */
  verifyCredential: (caller: HarnessCaller) => Promise<VerifiedHarnessPrincipal | null>;
  /** MUST query tenant-scoped durable ownership before get/cancel/event provider I/O. */
  authorizeRun: (tenantId: string, runId: string) => Promise<boolean>;
  now: () => number;
  /** Emit only minimal metadata, never credentials or raw prompts. */
  audit: (entry: { tenantId: string; actor: string; action: string; runId?: string; traceId?: string }) => Promise<void>;
}

/** Pure control-plane boundary. Example in-memory idempotency is process-local, NOT durable billing protection. */
export function createHarnessGateway(deps: HarnessGatewayDependencies) {
  const requests = new Map<string, { identity: string; promise: Promise<HarnessRun> }>();
  const runKeys = new Map<string, string>();
  let active = 0;
  let cachedCapabilities: HarnessAdapterCapabilities | null = null;
  async function principal(caller: HarnessCaller, scope: AdapterScope): Promise<VerifiedHarnessPrincipal> {
    if (!caller || typeof caller.credential !== "string" || !caller.credential || (typeof caller.tenantId !== "string" || !ID.test(caller.tenantId)) ||
        (typeof caller.actor !== "string" || !ID.test(caller.actor))) fail("unauthorized");
    let result: VerifiedHarnessPrincipal | null;
    try { result = await deps.verifyCredential(caller); } catch { fail("unauthorized"); }
    if (!result || result.revoked || !Number.isFinite(result.expiresAtMs) ||
        result.expiresAtMs <= deps.now() || result.tenantId !== caller.tenantId ||
        result.actor !== caller.actor || !Array.isArray(result.scopes))
      fail("unauthorized");
    if (!result.scopes.includes(scope)) fail("insufficient_scope");
    return result;
  }
  async function capabilities() {
    if (!cachedCapabilities) {
      const raw = await callExternal(() => deps.adapter.discoverCapabilities());
      cachedCapabilities = parseHarnessCapabilities(raw);
    }
    return cachedCapabilities;
  }
  async function callExternal<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch { return fail("provider_unavailable"); }
  }
  async function ownsRun(tenantId: string, runId: string) {
    if (!ID.test(runId)) fail("not_found");
    let allowed = false;
    try { allowed = await deps.authorizeRun(tenantId, runId); } catch { /* fail closed */ }
    if (!allowed) fail("not_found");
  }
  return {
    async discover(caller: HarnessCaller) {
      await principal(caller, "harness:read");
      return capabilities();
    },
    async validateConfiguration(caller: HarnessCaller, configurationRef: string) {
      await principal(caller, "harness:execute");
      if (typeof configurationRef !== "string" || !ID.test(configurationRef)) fail("invalid_payload");
      const cap = await capabilities();
      const result = await callExternal(() => deps.adapter.validateConfiguration({
        tenantId: caller.tenantId, adapterId: cap.adapterId, configurationRef,
      }));
      await deps.audit({ tenantId: caller.tenantId, actor: caller.actor, action: "validateConfiguration" });
      return result;
    },
    async execute(caller: HarnessCaller, input: unknown): Promise<HarnessRun> {
      await principal(caller, "harness:execute");
      // Use caller identity rather than a tenant or actor asserted by a client payload.
      const raw = snapshot(input);
      if (raw.tenantId !== caller.tenantId || raw.actor !== caller.actor) fail("unauthorized");
      const cap = await capabilities();
      if (!cap.features.execute) fail("unsupported");
      const req = validateHarnessTestRequest(raw, cap);
      const key = caller.tenantId + ":" + req.idempotencyKey;
      const runKey = caller.tenantId + ":" + req.runId;
      const identity = JSON.stringify(req);
      const replay = requests.get(key);
      if (replay) {
        if (replay.identity !== identity) fail("idempotency_conflict");
        return replay.promise;
      }
      if (runKeys.has(runKey)) fail("idempotency_conflict");
      if (requests.size >= 128 || active >= cap.limits.maxConcurrency) fail("quota_exceeded");
      active++;
      // Set promise before dispatch to coalesce concurrent duplicate requests.
      const pending = (async () => {
        try {
          const response = await callExternal(() => deps.adapter.executeTest(req));
          const result = runResponse(response, req.tenantId, req.runId, cap.adapterId, req);
          await deps.audit({ tenantId: req.tenantId, actor: caller.actor, action: "executeTest",
            runId: req.runId, traceId: req.traceId });
          return result;
        } finally { active--; }
      })();
      requests.set(key, { identity, promise: pending });
      runKeys.set(runKey, key);
      void pending.catch(() => {
        if (requests.get(key)?.promise === pending) {
          requests.delete(key);
          runKeys.delete(runKey);
        }
      });
      return pending;
    },
    async getRun(caller: HarnessCaller, runId: string): Promise<HarnessRun> {
      await principal(caller, "harness:read");
      await ownsRun(caller.tenantId, runId);
      const cap = await capabilities();
      return runResponse(await callExternal(() => deps.adapter.getRun({ tenantId: caller.tenantId, runId })),
        caller.tenantId, runId, cap.adapterId);
    },
    async cancel(caller: HarnessCaller, runId: string): Promise<HarnessRun> {
      await principal(caller, "harness:cancel");
      await ownsRun(caller.tenantId, runId);
      const cap = await capabilities();
      if (!cap.features.cancel) fail("unsupported");
      const result = runResponse(await callExternal(() => deps.adapter.cancel({ tenantId: caller.tenantId, runId })),
        caller.tenantId, runId, cap.adapterId);
      await deps.audit({ tenantId: caller.tenantId, actor: caller.actor, action: "cancel", runId,
        traceId: result.traceId });
      return result;
    },
    async *events(caller: HarnessCaller, runId: string, expected: HarnessTestRequest): AsyncGenerator<HarnessRunEvent> {
      await principal(caller, "harness:read");
      await ownsRun(caller.tenantId, runId);
      if (expected.tenantId !== caller.tenantId || expected.runId !== runId) fail("unauthorized");
      const cap = await capabilities();
      if (!cap.features.events) fail("unsupported");
      let sequence = 0;
      let count = 0;
      const eventIds = new Set<string>();
      try {
        for await (const raw of deps.adapter.streamEvents({ tenantId: caller.tenantId, runId })) {
          if (++count > 1000) fail("quota_exceeded");
          const event = parseHarnessRunEvent(raw, expected);
          if (eventIds.has(event.eventId) || event.sequence <= sequence) fail("invalid_event");
          eventIds.add(event.eventId);
          sequence = event.sequence;
          yield event;
          if (TERMINAL.includes(event.status)) break;
        }
      } catch (error) {
        if (error instanceof AdapterProtocolError) throw error;
        fail("provider_unavailable");
      }
    },
    async health(caller: HarnessCaller) {
      await principal(caller, "harness:read");
      const result = await callExternal(() => deps.adapter.health());
      if (result !== "healthy" && result !== "degraded" && result !== "unavailable") fail("invalid_response");
      return result;
    },
  };
}
