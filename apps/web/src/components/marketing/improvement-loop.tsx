"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { OrbitSystem, orbitPoint } from "@/components/brand/orbit-system";
import { SignalStar } from "@/components/brand/signal-node";
import { trackMarketingEvent } from "@/lib/marketing-analytics";

import { SectionHead } from "./section-head";

const LOOP = ["Use", "Observe", "Measure", "Recommend", "Validate", "Approve", "Release"];

const CX = 220;
const CY = 220;
const R = 150;

export function ImprovementLoop() {
  const [open, setOpen] = useState(false);
  const tracked = useRef(false);

  const reveal = (source: "hover" | "click") => {
    setOpen(true);
    if (!tracked.current) {
      tracked.current = true;
      trackMarketingEvent("improvement_section_interaction", { source });
    }
  };

  return (
    <section
      className="section savant-dark il-section"
      id="improvement"
      data-nav="product"
      aria-labelledby="improve-title"
    >
      <div className="shell">
        <SectionHead
          id="improve-title"
          index="04"
          meta="Continuous improvement"
          title={
            <>
              Every use can make
              <br />
              the skill <em>better</em>.
            </>
          }
        >
          <p>
            Real runs generate evidence. Savant measures outcomes, proposes bounded improvements,
            and validates each candidate against the regression suite. Only people approve, and
            nothing reaches production outside your release policy.
          </p>
        </SectionHead>

        <div className="il">
          <figure className="il-loop" data-reveal>
            <svg viewBox="0 0 440 440" className="il-svg" aria-hidden="true">
              <OrbitSystem cx={CX} cy={CY} r={R} className="il-orbit" />
              <g className="il-traveller">
                <circle cx={CX} cy={CY - R} r={6} />
              </g>
              {LOOP.map((stage, i) => {
                const angle = -90 + (360 / LOOP.length) * i;
                const p = orbitPoint(CX, CY, R, angle);
                const l = orbitPoint(CX, CY, R + 28, angle);
                const anchor = Math.abs(l.x - CX) < 8 ? "middle" : l.x > CX ? "start" : "end";
                return (
                  <g key={stage} className="il-stage">
                    <circle
                      className="il-node"
                      cx={p.x}
                      cy={p.y}
                      r={5.5}
                      data-signal={stage === "Recommend" ? "true" : undefined}
                    />
                    <text x={l.x} y={l.y + 4} textAnchor={anchor}>
                      {stage}
                    </text>
                  </g>
                );
              })}
              <SignalStar cx={CX} cy={CY} r={30} className="il-star" />
            </svg>
            <figcaption className="sr-only">
              The improvement loop: use, observe, measure, recommend, validate, approve, release,
              then repeat.
            </figcaption>
            <ol className="il-steps" aria-hidden="true">
              {LOOP.map((stage) => (
                <li key={stage}>{stage}</li>
              ))}
              <li className="il-steps-repeat">↺ repeat</li>
            </ol>
          </figure>

          <div className="il-evidence" data-reveal data-reveal-delay="1">
            <div className="ev" onMouseEnter={() => reveal("hover")}>
              <div className="ev-head">
                <span className="ev-skill">architecture-review</span>
                <span className="ev-flag">
                  <span className="ev-flag-dot" aria-hidden="true" />
                  Recommendation available
                </span>
              </div>

              <dl className="ev-compare">
                <div>
                  <dt>Baseline · v2.4.0</dt>
                  <dd className="num">87.4</dd>
                </div>
                <div className="ev-candidate">
                  <dt>Candidate · v2.5.0</dt>
                  <dd className="num">92.6</dd>
                </div>
                <div className="ev-delta">
                  <dt>Δ quality</dt>
                  <dd className="num">+5.2</dd>
                </div>
              </dl>

              <div className="ev-gate">
                <span className="ev-gate-bar" aria-hidden="true">
                  <span />
                </span>
                <span>
                  <span className="num">148 / 148</span> regressions passed
                </span>
              </div>

              <button
                type="button"
                className="btn btn-signal btn-md ev-toggle"
                aria-expanded={open}
                aria-controls="ev-detail"
                onClick={() => (open ? setOpen(false) : reveal("click"))}
              >
                {open ? "Hide recommendation" : "Review recommendation"}
                <span className="ev-toggle-glyph" aria-hidden="true">
                  {open ? "−" : "+"}
                </span>
              </button>

              <div id="ev-detail" className="ev-detail" hidden={!open}>
                <div className="ev-detail-block">
                  <h3>Observed behavior</h3>
                  <p>18% of runs required manual trade-off analysis edits.</p>
                </div>
                <div className="ev-detail-block">
                  <h3>Proposed improvement</h3>
                  <p>Require operational complexity analysis for each alternative.</p>
                </div>
                <div className="ev-detail-block">
                  <h3>Measured impact</h3>
                  <dl className="ev-impact">
                    <div>
                      <dt>Quality</dt>
                      <dd className="num">+5.2</dd>
                    </div>
                    <div>
                      <dt>Edit rate</dt>
                      <dd className="num">−6.5%</dd>
                    </div>
                    <div>
                      <dt>Latency</dt>
                      <dd className="num">+1.8%</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
            <p className="ev-note">Illustrative example. Approval always stays with your reviewers.</p>
          </div>
        </div>

        <div className="section-cta" data-reveal>
          <a
            href="mailto:sales@savant.app?subject=Savant%20walkthrough"
            className="btn btn-primary btn-lg"
            data-track="sales_cta"
            data-track-placement="improvement"
          >
            See Savant in action
          </a>
          <Link href="/docs#improvement" className="link-arrow">
            How recommendations are validated
          </Link>
        </div>
      </div>
    </section>
  );
}
