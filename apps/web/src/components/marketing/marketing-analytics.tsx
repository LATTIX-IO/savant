"use client";

import { useEffect } from "react";

import { isMarketingEventName, isSignupHref, trackMarketingEvent } from "@/lib/marketing-analytics";

/**
 * One delegated listener instead of per-component handlers:
 *   - clicks on `[data-track]` emit that event (plus `data-track-*` props)
 *   - any click on a /signup link also emits `signup_start`
 *   - `<details data-track>` emits when opened
 *   - `section[aria-labelledby]` emits `section_view` once, for funnel retention
 */
export function MarketingAnalytics() {
  useEffect(() => {
    const propsFrom = (el: HTMLElement) => {
      const props: Record<string, string> = {};
      for (const [key, value] of Object.entries(el.dataset)) {
        if (key.startsWith("track") && key !== "track" && value) {
          props[key.slice(5, 6).toLowerCase() + key.slice(6)] = value;
        }
      }
      return props;
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const el = target?.closest<HTMLElement>("a[data-track], button[data-track]");
      if (el && isMarketingEventName(el.dataset.track)) {
        trackMarketingEvent(el.dataset.track, propsFrom(el));
      }

      const link = target?.closest<HTMLAnchorElement>("a[href]");
      if (link && isSignupHref(link.getAttribute("href"))) {
        trackMarketingEvent("signup_start", { placement: link.dataset.trackPlacement });
      }
    };

    const onToggle = (event: Event) => {
      const el = event.target as HTMLElement;
      if (el instanceof HTMLDetailsElement && el.open && isMarketingEventName(el.dataset.track)) {
        trackMarketingEvent(el.dataset.track, propsFrom(el));
      }
    };

    document.addEventListener("click", onClick);
    // `toggle` does not bubble; capture it on the document instead.
    document.addEventListener("toggle", onToggle, true);

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const section = entry.target as HTMLElement;
            trackMarketingEvent("section_view", {
              section: section.id || section.getAttribute("aria-labelledby") || "unknown",
            });
            observer?.unobserve(section);
          }
        },
        { threshold: 0.35 },
      );
      document.querySelectorAll("section[aria-labelledby]").forEach((section) => observer?.observe(section));
    }

    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("toggle", onToggle, true);
      observer?.disconnect();
    };
  }, []);

  return null;
}
