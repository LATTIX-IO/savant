/**
 * Marketing conversion instrumentation.
 *
 * Events are pushed to `window.dataLayer` (when a tag manager is installed) and
 * re-dispatched as a `savant:analytics` DOM event so any collector can subscribe
 * without the page depending on a vendor SDK. Nothing here sends network
 * requests on its own.
 */

export const MARKETING_EVENTS = [
  "hero_primary_cta",
  "hero_secondary_cta",
  "product_demo_interaction",
  "improvement_section_interaction",
  "security_link",
  "pricing_toggle",
  "pricing_cta",
  "faq_expand",
  "sales_cta",
  "signup_start",
  "signup_complete",
  "repository_connect_complete",
  "section_view",
  "cta_click",
] as const;

export type MarketingEventName = (typeof MARKETING_EVENTS)[number];

export type MarketingEventProps = Record<string, string | number | boolean | undefined>;

export type MarketingEvent = {
  event: MarketingEventName;
  device: "mobile" | "tablet" | "desktop";
  path: string;
} & MarketingEventProps;

export const MARKETING_ANALYTICS_DOM_EVENT = "savant:analytics";

export function isMarketingEventName(value: string | undefined | null): value is MarketingEventName {
  return typeof value === "string" && (MARKETING_EVENTS as readonly string[]).includes(value);
}

export function resolveDeviceClass(viewportWidth: number): MarketingEvent["device"] {
  if (!Number.isFinite(viewportWidth) || viewportWidth < 768) return "mobile";
  if (viewportWidth < 1100) return "tablet";
  return "desktop";
}

export function buildMarketingEvent(
  name: MarketingEventName,
  props: MarketingEventProps,
  context: { viewportWidth: number; path: string },
): MarketingEvent {
  const clean: MarketingEventProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined && value !== "") clean[key] = value;
  }

  return {
    ...clean,
    event: name,
    device: resolveDeviceClass(context.viewportWidth),
    path: context.path,
  };
}

/** Signup links count as the start of the signup funnel wherever they sit. */
export function isSignupHref(href: string | null | undefined): boolean {
  if (!href) return false;
  return /^\/signup(?:[/?#]|$)/.test(href);
}

type DataLayerWindow = Window & { dataLayer?: unknown[] };

export function trackMarketingEvent(name: MarketingEventName, props: MarketingEventProps = {}) {
  if (typeof window === "undefined") return;

  const payload = buildMarketingEvent(name, props, {
    viewportWidth: window.innerWidth,
    path: window.location.pathname,
  });

  const w = window as DataLayerWindow;
  if (Array.isArray(w.dataLayer)) {
    w.dataLayer.push(payload);
  }

  window.dispatchEvent(new CustomEvent(MARKETING_ANALYTICS_DOM_EVENT, { detail: payload }));
}
