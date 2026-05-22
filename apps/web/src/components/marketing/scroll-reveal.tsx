"use client";

import { useEffect } from "react";

/**
 * Toggles `data-revealed="true"` on every `[data-reveal]` element when it
 * enters the viewport, then unobserves it. Cooperates with the CSS in
 * marketing.css to fade + lift the element into place.
 *
 * Mounted once at the top of the marketing layout — no per-component setup.
 */
export function ScrollRevealObserver() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }

    const targets = document.querySelectorAll<HTMLElement>(
      "[data-reveal]:not([data-revealed='true'])",
    );

    if (targets.length === 0) return;

    // Respect reduced-motion users by revealing everything immediately.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((el) => {
        el.dataset.revealed = "true";
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.dataset.revealed = "true";
            observer.unobserve(el);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
    );

    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return null;
}
