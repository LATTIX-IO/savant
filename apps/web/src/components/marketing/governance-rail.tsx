"use client";

import { useEffect, useRef, useState } from "react";

import { resolveScrollProgress, resolveStageIndex } from "@/lib/marketing-motion";

const STAGES = [
  {
    title: "Connect",
    body: "Point Savant at the Git repository where skills live. Webhook sync keeps every change visible.",
    state: "acme/skills · main",
  },
  {
    title: "Evaluate",
    body: "Each candidate runs against rubric evals and its regression suite before review opens.",
    state: "148 cases · 24s",
  },
  {
    title: "Approve",
    body: "Owners, reviewers, and compliance act on one timeline, routed by tier and policy.",
    state: "2 of 2 approved",
  },
  {
    title: "Release",
    body: "Promote draft → staging → production. Every release is signed and pinned to a commit.",
    state: "v2.5.0 · signed",
  },
  {
    title: "Distribute",
    body: "The approved version reaches every authorized tool through integrations or the sync agent.",
    state: "4 surfaces in sync",
  },
  {
    title: "Audit",
    body: "Every event is recorded append-only, exportable to your SIEM, with one-click rollback.",
    state: "append-only",
  },
];

/**
 * The provenance line fills as the visitor scrolls the section, and the signal
 * node travels to the stage in focus. With reduced motion the state still
 * follows scroll; only the transitions are removed (CSS).
 */
export function GovernanceRail() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;

    let frame = 0;
    const wide = window.matchMedia("(min-width: 900px)");

    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      if (wide.matches) {
        const progress = resolveScrollProgress(root.getBoundingClientRect().top, vh, 0.85, 0.5);
        setActive(progress <= 0 ? -1 : resolveStageIndex(progress, STAGES.length));
        return;
      }
      // Stacked layout: the last stage whose node has passed 60% of the viewport.
      const items = Array.from(root.querySelectorAll<HTMLElement>("[data-stage]"));
      let index = -1;
      items.forEach((item, i) => {
        if (item.getBoundingClientRect().top < vh * 0.6) index = i;
      });
      setActive(index);
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const fill = active < 0 ? 0 : (active / (STAGES.length - 1)) * 100;

  return (
    <div
      ref={ref}
      className="gr"
      style={{ "--gr-fill": `${fill}%` } as React.CSSProperties}
      data-started={active >= 0 ? "true" : "false"}
    >
      <span className="gr-line" aria-hidden="true">
        <span className="gr-line-fill" />
        <span className="gr-traveller" />
      </span>
      <ol className="gr-list">
      {STAGES.map((stage, index) => {
        const state = index < active ? "done" : index === active ? "current" : "pending";
        return (
          <li key={stage.title} className="gr-stage" data-stage={index} data-state={state}>
            <span className="gr-node" aria-hidden="true" />
            <span className="gr-num">{String(index + 1).padStart(2, "0")}</span>
            <h3 className="gr-title">{stage.title}</h3>
            <p className="gr-body">{stage.body}</p>
            <span className="gr-state">
              {state === "current" ? <span className="sr-only">In focus: </span> : null}
              {stage.state}
            </span>
          </li>
        );
      })}
      </ol>
    </div>
  );
}
