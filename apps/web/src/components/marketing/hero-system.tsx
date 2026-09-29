"use client";

import { useEffect, useRef, useState } from "react";

import { OrbitSystem, orbitPoint } from "@/components/brand/orbit-system";
import { SignalNode, SignalStar } from "@/components/brand/signal-node";
import { nextLoopStep } from "@/lib/marketing-motion";

const CX = 300;
const CY = 280;
const INNER = 140;
const OUTER = 228;
const STEP_MS = 950;
const STEP_COUNT = 8;
const FINAL_STEP = STEP_COUNT - 1;

type Stage = {
  key: string;
  label: string;
  angle: number;
  step: number;
  ring: "inner" | "outer";
};

// The repository feeds in from the outer ring; governed stages sit on the
// inner orbit, and distribution faces the downstream surfaces.
const STAGES: Stage[] = [
  { key: "repo", label: "Repository", angle: 180, step: 1, ring: "outer" },
  { key: "eval", label: "Evaluation", angle: 225, step: 3, ring: "inner" },
  { key: "approve", label: "Approval", angle: 270, step: 4, ring: "inner" },
  { key: "release", label: "Release", angle: 315, step: 5, ring: "inner" },
  { key: "distribute", label: "Distribution", angle: 0, step: 5, ring: "inner" },
  { key: "feedback", label: "Feedback", angle: 135, step: 7, ring: "inner" },
];

// Downstream surfaces on the outer ring. Names match Savant's supported runtimes.
const SURFACES = [
  { key: "claude", label: "Claude", angle: -38 },
  { key: "codex", label: "Codex", angle: -12 },
  { key: "vscode", label: "VS Code", angle: 14 },
  { key: "agents", label: "Agents", angle: 40 },
];

const CAPTIONS = [
  "Idle — awaiting a change",
  "Repository — commit 8a3cf2 received",
  "Savant — candidate v2.5.0 registered",
  "Evaluation — 148 cases scored",
  "Approval — 2 of 2 reviewers approved",
  "Release — v2.5.0 promoted",
  "Distribution — 4 surfaces in sync",
  "Feedback — run evidence returns",
];

const STEP_LIST = [
  { label: "Repository", detail: "A commit lands in the skill repository." },
  { label: "Evaluation", detail: "The candidate is scored against its eval suite." },
  { label: "Approval", detail: "Reviewers approve under policy." },
  { label: "Release", detail: "The approved version is promoted and recorded." },
  { label: "Distribution", detail: "Every authorized tool receives the same version." },
  { label: "Feedback", detail: "Run evidence returns to inform the next change." },
];

function stagePoint(stage: Stage) {
  return orbitPoint(CX, CY, stage.ring === "outer" ? OUTER : INNER, stage.angle);
}

function labelPlacement(stage: Stage) {
  if (stage.ring === "outer") {
    const p = stagePoint(stage);
    return { x: p.x, y: p.y, anchor: "middle" as const, dy: -18 };
  }
  if (stage.key === "distribute") {
    // Tucked inside the orbit so the outbound fan to the surfaces stays clear.
    const p = stagePoint(stage);
    return { x: p.x - 10, y: p.y, anchor: "end" as const, dy: 26 };
  }
  const p = orbitPoint(CX, CY, INNER + 22, stage.angle);
  const rad = (stage.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const anchor = cos < -0.3 ? ("end" as const) : cos > 0.3 ? ("start" as const) : ("middle" as const);
  const dy = sin < -0.3 ? -4 : sin > 0.3 ? 14 : 4;
  return { ...p, anchor, dy };
}

export function HeroSystem() {
  // Server render shows the completed state, which is also what reduced-motion
  // visitors keep: the whole lifecycle, fully legible and still.
  const [step, setStep] = useState(FINAL_STEP);
  const [running, setRunning] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    let visible = true;
    let timer: number | undefined;

    const tick = () => {
      if (visible && document.visibilityState === "visible") {
        setRunning(true);
        setStep((value) => nextLoopStep(value, STEP_COUNT));
      }
      timer = window.setTimeout(tick, STEP_MS);
    };

    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
          });
    observer?.observe(root);

    // Hold the complete picture briefly, then begin the loop from rest.
    timer = window.setTimeout(tick, 1400);

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, []);

  const on = (at: number) => (step >= at ? "true" : "false");
  const center = { x: CX, y: CY };
  const distribute = orbitPoint(CX, CY, INNER, 0);
  const feedback = orbitPoint(CX, CY, INNER, 135);

  return (
    <figure ref={rootRef} className="hs">
      <svg
        className="hs-svg"
        viewBox="0 0 640 560"
        role="img"
        aria-labelledby="hs-title"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id="hs-title">
          Savant lifecycle: a change moves from the repository through evaluation, approval, and
          release, is distributed to downstream tools, and run feedback returns to Savant.
        </title>

        <circle className="hs-outer" cx={CX} cy={CY} r={OUTER} />
        <OrbitSystem cx={CX} cy={CY} r={INNER} className="hs-orbit" />

        {/* Inbound: repository → Savant */}
        <line
          className="hs-path"
          data-on={on(2)}
          x1={CX - OUTER}
          y1={CY}
          x2={CX - 30}
          y2={CY}
          pathLength={1}
        />

        {/* Spokes: Savant → each governed stage */}
        {STAGES.filter((s) => s.ring === "inner" && s.key !== "feedback").map((stage) => {
          const p = stagePoint(stage);
          return (
            <line
              key={stage.key}
              className="hs-path"
              data-on={on(stage.step)}
              x1={center.x}
              y1={center.y}
              x2={p.x}
              y2={p.y}
              pathLength={1}
            />
          );
        })}

        {/* Outbound: distribution → surfaces */}
        {SURFACES.map((surface) => {
          const p = orbitPoint(CX, CY, OUTER, surface.angle);
          const mx = (distribute.x + p.x) / 2;
          const my = distribute.y;
          return (
            <path
              key={surface.key}
              className="hs-path hs-path-out"
              data-on={on(6)}
              d={`M${distribute.x} ${distribute.y}Q${mx} ${my} ${p.x} ${p.y}`}
              pathLength={1}
            />
          );
        })}

        {/* Feedback: along the orbit, then inward */}
        <path
          className="hs-path hs-path-feedback"
          data-on={on(7)}
          d={`M${distribute.x} ${distribute.y}A${INNER} ${INNER} 0 0 1 ${feedback.x} ${feedback.y}L${CX - 18} ${CY + 30}`}
          pathLength={1}
        />

        <g className="hs-center" data-on={on(2)}>
          <circle className="hs-center-ring" cx={CX} cy={CY} r={46} />
          <SignalStar cx={CX} cy={CY} r={32} className="hs-star" />
        </g>

        {STAGES.map((stage) => {
          const p = stagePoint(stage);
          const l = labelPlacement(stage);
          const isCurrent = step === stage.step || (stage.key === "distribute" && step === 6);
          return (
            <g key={stage.key} className="hs-stage" data-on={on(stage.step)}>
              <SignalNode
                cx={p.x}
                cy={p.y}
                r={7}
                state={running && isCurrent ? "signal" : step >= stage.step ? "on" : "idle"}
              />
              <text className="hs-label" x={l.x} y={l.y + l.dy} textAnchor={l.anchor}>
                {stage.label}
              </text>
            </g>
          );
        })}

        {SURFACES.map((surface) => {
          const p = orbitPoint(CX, CY, OUTER, surface.angle);
          return (
            <g key={surface.key} className="hs-surface" data-on={on(6)}>
              <SignalNode cx={p.x} cy={p.y} r={5.5} state={step >= 6 ? "on" : "idle"} />
              <text className="hs-label hs-label-tool" x={p.x + 14} y={p.y + 4}>
                {surface.label}
              </text>
              <text className="hs-version" x={p.x + 14} y={p.y + 18}>
                v2.5.0
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="hs-caption">
        <span className="hs-caption-index" aria-hidden="true">
          {String(step).padStart(2, "0")}/{String(FINAL_STEP).padStart(2, "0")}
        </span>
        <span className="hs-caption-text">
          {running ? CAPTIONS[step] : "Governed loop — every stage recorded"}
        </span>
      </figcaption>

      {/* Text equivalent; also the small-screen form of the diagram. */}
      <ol className="hs-steps">
        {STEP_LIST.map((item, index) => (
          <li key={item.label} data-on={step >= (STAGES[index]?.step ?? 0) ? "true" : "false"}>
            <span className="hs-steps-label">{item.label}</span>
            <span className="hs-steps-detail">{item.detail}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
