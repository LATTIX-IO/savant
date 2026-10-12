/** Savant QA protocol v1. This contract cannot schedule production AI work. */
export type AdapterProtocolVersion = { major: 1; minor: number };
export type AdapterFeature = "execute" | "observe" | "cancel" | "events";
export type AdapterScope = "harness:read" | "harness:execute" | "harness:cancel";
export type AdapterRunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "timedOut";
export type AdapterCaptureLevel = "none" | "metadata" | "redacted";

export interface HarnessAdapterCapabilities {
  protocol: AdapterProtocolVersion;
  adapterId: string;
  features: Record<AdapterFeature, boolean>;
  /** Observable operations only; unknown provider coverage MUST NOT be inferred. */
  coverage: { execution: "complete" | "partial" | "unsupported"; observation: "complete" | "partial" | "unsupported" };
  limits: { maxConcurrency: number; maxDurationMs: number; maxCostUsd: number };
}

export interface HarnessTestRequest {
  tenantId: string;
  adapterId: string;
  actor: string;
  runId: string;
  traceId: string;
  idempotencyKey: string;
  /** Hex SHA-256 digests of immutable, authorized artifacts; not raw content. */
  specVersionHash: string;
  testSuiteHash: string;
  inputRef: string;
  budget: { maxDurationMs: number; maxCostUsd: number };
  capture: { level: AdapterCaptureLevel; retentionDays: number; residency: string };
}

export interface HarnessRun {
  tenantId: string;
  adapterId: string;
  runId: string;
  externalRunId: string;
  traceId: string;
  specVersionHash: string;
  testSuiteHash: string;
  status: AdapterRunStatus;
}

export interface HarnessRunEvent {
  eventId: string;
  tenantId: string;
  runId: string;
  traceId: string;
  sequence: number;
  status: AdapterRunStatus;
}

/** Not passed to external harnesses; the verifier must authenticate this material. */
export interface HarnessCaller {
  tenantId: string;
  actor: string;
  credential: string;
}

/** Return only after OAuth/mTLS/signed-token verification against a trusted authority. */
export interface VerifiedHarnessPrincipal {
  tenantId: string;
  actor: string;
  scopes: AdapterScope[];
  expiresAtMs: number;
  revoked: boolean;
}

export interface HarnessAdapter {
  discoverCapabilities(): Promise<unknown>;
  validateConfiguration(input: { tenantId: string; adapterId: string; configurationRef: string }): Promise<boolean>;
  executeTest(request: HarnessTestRequest): Promise<unknown>;
  cancel(input: { tenantId: string; runId: string }): Promise<unknown>;
  getRun(input: { tenantId: string; runId: string }): Promise<unknown>;
  streamEvents(input: { tenantId: string; runId: string }): AsyncIterable<unknown>;
  health(): Promise<"healthy" | "degraded" | "unavailable">;
}
