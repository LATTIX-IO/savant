import { SectionHead } from "./section-head";

// Scattered on purpose: offsets and tilts are the visual argument.
const FRAGMENTS = [
  { label: "repos", x: 6, y: 10, r: -4 },
  { label: "documents", x: 50, y: 4, r: 3 },
  { label: "chat threads", x: 26, y: 38, r: -2 },
  { label: "local machines", x: 60, y: 46, r: 5 },
  { label: "agent configs", x: 8, y: 70, r: 2 },
  { label: "wikis", x: 70, y: 18, r: -6 },
];

const GAPS = ["no shared baseline", "no evaluation", "no release governance", "no clear rollback"];

const LIFECYCLE = ["Source", "Evaluate", "Approve", "Release", "Distribute", "Learn"];

export function ProblemTransition() {
  return (
    <section className="section" data-nav="" aria-labelledby="problem-title">
      <div className="shell">
        <SectionHead
          id="problem-title"
          index="01"
          meta="Why Savant"
          title={
            <>
              Most teams ship skills on trust.
              <br />
              Savant ships them on <em>evidence</em>.
            </>
          }
        >
          <p>
            Expertise is becoming executable through AI, but most organizations have no control
            over it. Prompts, runbooks, and agent instructions drift across tools with no version,
            no measurement, and no trail when something regresses.
          </p>
        </SectionHead>

        <div className="pt">
          <div className="pt-side pt-without" data-reveal>
            <div className="pt-kicker">Without Savant</div>
            <p className="pt-lede">Skills scattered across</p>
            <ul className="pt-frags" aria-label="Where skills live today">
              {FRAGMENTS.map((f) => (
                <li
                  key={f.label}
                  style={{ "--x": `${f.x}%`, "--y": `${f.y}%`, "--r": `${f.r}deg` } as React.CSSProperties}
                >
                  <span className="pt-frag-node" aria-hidden="true" />
                  {f.label}
                </li>
              ))}
            </ul>
            <ul className="pt-gaps">
              {GAPS.map((gap) => (
                <li key={gap}>
                  <span aria-hidden="true">→</span> {gap}
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-divider" aria-hidden="true" />

          <div className="pt-side pt-with" data-reveal data-reveal-delay="1">
            <div className="pt-kicker">With Savant</div>
            <p className="pt-lede">One governed lifecycle</p>
            <ol className="pt-life">
              {LIFECYCLE.map((stage, index) => (
                <li key={stage} data-last={index === LIFECYCLE.length - 1 ? "true" : undefined}>
                  <span className="pt-life-node" aria-hidden="true" />
                  <span className="pt-life-num">{String(index + 1).padStart(2, "0")}</span>
                  <span className="pt-life-label">{stage}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
