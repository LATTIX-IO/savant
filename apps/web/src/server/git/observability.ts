import { logGitEvent } from "./redaction.ts";

/**
 * Lightweight in-process metrics and tracing for the git subsystem. Metric
 * labels and span attributes are restricted to an allowlist, so credentials can
 * never be attached (spec §39). Exporters (OTel, Prometheus) can read
 * `snapshotGitMetrics()` / subscribe via `setGitSpanExporter()`.
 */

export type GitMetricName =
  | "git_connection_total"
  | "git_repository_sync_total"
  | "git_repository_sync_duration_seconds"
  | "git_provider_request_total"
  | "git_provider_auth_failure_total"
  | "git_repository_indexed_skills";

const ALLOWED_LABELS = new Set(["provider", "status", "result", "status_class", "reason"]);
const ALLOWED_SPAN_ATTRIBUTES = new Set([
  "provider",
  "connection_id",
  "repository_id",
  "organization_id",
  "error_code",
  "revision",
  "entry_count",
  "file_count",
  "skill_count",
  "result",
]);

type Labels = Record<string, string>;

type MetricSeries = { labels: Labels; value: number; count: number };

const metrics = new Map<string, MetricSeries>();

function sanitizeLabels(labels: Record<string, string | number | null | undefined>): Labels {
  const output: Labels = {};
  for (const [key, value] of Object.entries(labels)) {
    if (ALLOWED_LABELS.has(key) && value != null) {
      output[key] = String(value).slice(0, 64);
    }
  }
  return output;
}

function seriesKey(name: GitMetricName, labels: Labels): string {
  return `${name}{${Object.keys(labels).sort().map((key) => `${key}=${labels[key]}`).join(",")}}`;
}

export function incrementGitMetric(name: GitMetricName, labels: Record<string, string | number | null | undefined>, by = 1): void {
  const clean = sanitizeLabels(labels);
  const key = seriesKey(name, clean);
  const series = metrics.get(key) ?? { labels: clean, value: 0, count: 0 };
  series.value += by;
  series.count += 1;
  metrics.set(key, series);
}

export function observeGitMetric(name: GitMetricName, labels: Record<string, string | number | null | undefined>, value: number): void {
  incrementGitMetric(name, labels, value);
}

export function snapshotGitMetrics(): Array<{ name: string; labels: Labels; value: number; count: number }> {
  return [...metrics.entries()].map(([key, series]) => ({
    name: key.slice(0, key.indexOf("{")),
    labels: series.labels,
    value: series.value,
    count: series.count,
  }));
}

export function resetGitMetrics(): void {
  metrics.clear();
}

export function statusClass(status: number): string {
  return status === 0 ? "network" : `${Math.floor(status / 100)}xx`;
}

export type GitSpan = {
  name: string;
  parent: string | null;
  attributes: Record<string, string | number | boolean>;
  startedAt: number;
  durationMs: number;
  error: string | null;
};

let spanExporter: ((span: GitSpan) => void) | null = null;

export function setGitSpanExporter(exporter: ((span: GitSpan) => void) | null): void {
  spanExporter = exporter;
}

export type SpanHandle = {
  name: string;
  setAttribute(key: string, value: string | number | boolean | null | undefined): void;
};

/**
 * Runs `fn` inside a span. Hierarchy:
 * repository.sync → git.connection.resolve, git.credential.resolve,
 * provider.repository.validate, provider.tree.read, skill.discovery,
 * skill.validation, skill.index.commit.
 */
export async function withGitSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | null | undefined>,
  fn: (span: SpanHandle) => Promise<T>,
  parent: SpanHandle | null = null,
): Promise<T> {
  const attrs: Record<string, string | number | boolean> = {};
  const handle: SpanHandle = {
    name,
    setAttribute(key, value) {
      if (ALLOWED_SPAN_ATTRIBUTES.has(key) && value != null) {
        attrs[key] = typeof value === "string" ? value.slice(0, 120) : value;
      }
    },
  };

  for (const [key, value] of Object.entries(attributes)) {
    handle.setAttribute(key, value);
  }

  const startedAt = Date.now();
  let error: string | null = null;

  try {
    return await fn(handle);
  } catch (caught) {
    error = caught instanceof Error && "code" in caught && typeof caught.code === "string" ? caught.code : "error";
    throw caught;
  } finally {
    const span: GitSpan = {
      name,
      parent: parent?.name ?? null,
      attributes: attrs,
      startedAt,
      durationMs: Date.now() - startedAt,
      error,
    };

    spanExporter?.(span);
    logGitEvent("info", "span", { span: name, parent: span.parent, duration_ms: span.durationMs, error_code: error, ...attrs });
  }
}
