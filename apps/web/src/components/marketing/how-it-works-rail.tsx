"use client";

import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    num: "01",
    title: "Connect",
    body: "Point Savant at your skill repository. Webhook sync keeps everything live.",
    pill: "wh/legal-skills · main",
  },
  {
    num: "02",
    title: "Evaluate",
    body: "Candidates run against rubric-based evals. Regressions surface immediately.",
    pill: "248 cases · 24s",
  },
  {
    num: "03",
    title: "Approve",
    body: "Owners, reviewers, compliance act on a single timeline.",
    pill: "2 of 3 approved",
  },
  {
    num: "04",
    title: "Release",
    body: "Promote through draft → staging → production. Release records are signed automatically.",
    pill: "promoted · v2.4.0",
  },
  {
    num: "05",
    title: "Audit",
    body: "Every event recorded immutably. Stream to SIEM. Retained for seven years.",
    pill: "append-only",
  },
];

export function HowItWorksRail() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<number>(0);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const steps = Array.from(root.querySelectorAll<HTMLElement>(".how-step"));
    if (steps.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the highest-progress visible step.
        let bestIndex = -1;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestIndex = Number((entry.target as HTMLElement).dataset.index ?? -1);
          }
        }
        if (bestIndex >= 0) setActive((prev) => Math.max(prev, bestIndex));
      },
      { rootMargin: "-30% 0px -30% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    steps.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const linePct = ((active + 1) / STEPS.length) * 100;

  return (
    <div ref={containerRef} className="how-rail">
      <div className="how-rail-line" style={{ width: `${linePct}%` }} aria-hidden />
      {STEPS.map((s, i) => (
        <div
          key={s.num}
          className="how-step"
          data-index={i}
          data-active={i <= active}
        >
          <div className="how-step-num">/{s.num}</div>
          <h4>{s.title}</h4>
          <p>{s.body}</p>
          <div className="how-step-state">
            <span className="pill">{s.pill}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
