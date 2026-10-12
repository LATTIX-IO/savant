/** PER-1058: opt-in, customer-harness-owned, no-content telemetry. */
export type HarnessTelemetrySpanKind = "workflow" | "step" | "tool" | "model";
export type HarnessTelemetrySpanStatus = "started" | "completed" | "failed" | "canceled";
export interface HarnessTelemetrySpanV1 {
  schemaVersion: 1;
  tenantId: string;
  adapterId: string;
  runId: string;
  /** Identity pins to the adapter v1 execution request. */
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  nodeId?: string;
  specVersionHash: string;
  testSuiteHash: string;
  kind: HarnessTelemetrySpanKind;
  status: HarnessTelemetrySpanStatus;
  startedAtMs: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  /** Content and token-bearing fields are deliberately absent. */
  captureLevel: "none" | "metadata";
}
export interface HarnessTelemetryBatchV1 {
  schemaVersion: 1;
  tenantId: string;
  adapterId: string;
  traceId: string;
  batchId: string;
  cursor: number;
  spans: HarnessTelemetrySpanV1[];
}
export type HarnessTelemetrySend = (batch: HarnessTelemetryBatchV1) =>
  Promise<{ batchId: string; acceptedCursor: number }>;
export interface HarnessTelemetryCoverage {
  completeness: "none" | "partial" | "complete";
  observedStepIds: string[];
  missingStepIds: string[];
}
