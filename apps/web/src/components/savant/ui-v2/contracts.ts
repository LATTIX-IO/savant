/** UI-only contracts: never infer product capability or evaluation success from presentation state. */
export type UiV2Density = "compact" | "comfortable";
export type UiV2Status = "ready" | "running" | "warning" | "failed" | "planned" | "simulated" | "unavailable";

const LABELS: Record<UiV2Status, string> = {
  ready: "Ready", running: "Running", warning: "Needs attention",
  failed: "Failed", planned: "Planned", simulated: "Simulated",
  unavailable: "Unavailable",
};

export function normalizeUiV2Density(value: unknown): UiV2Density {
  return value === "comfortable" ? "comfortable" : "compact";
}

export function uiV2StatusLabel(status: UiV2Status, label?: string): string {
  const trimmed = label?.trim();
  // Presentation labels never suppress disclosure of non-operational status.
  if (status === "planned" || status === "simulated" || status === "unavailable") {
    return trimmed ? `${LABELS[status]} · ${trimmed}` : LABELS[status];
  }
  return trimmed || LABELS[status];
}

export function uiV2MetricValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "number" && !Number.isFinite(value)) return "Not available";
  if (typeof value === "string" && value.trim() === "") return "Not available";
  return String(value);
}

/** For app navigation only; never turn supplied values into external/javascript links. */
export function isSafeUiV2InternalHref(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//")
    && !/[\\\u0000-\u001f\u007f]/.test(href);
}
