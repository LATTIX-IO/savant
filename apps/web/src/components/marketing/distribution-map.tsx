import { SavantIcon } from "@/components/brand/savant-icon";

import { SectionHead } from "./section-head";

// Surfaces Savant distributes to today (see SKILL_RUNTIMES in @savant/types).
const SURFACES = [
  { name: "Claude", via: "Native integration" },
  { name: "OpenAI", via: "Native integration" },
  { name: "Codex", via: "Managed sync agent" },
  { name: "GitHub Copilot", via: "Managed sync agent" },
  { name: "VS Code", via: "Managed sync agent" },
];

const POINTS = [
  { title: "One approved version.", body: "Distribution starts from the release your reviewers approved, never a local copy." },
  { title: "Every authorized surface.", body: "Policy decides which tools and groups receive a skill before anything ships." },
  { title: "No silent drift.", body: "Each surface reports the version it runs, so a mismatch is visible and one rollback fixes all of them." },
];

const ROW_Y = [20, 60, 100, 140, 180];

export function DistributionMap() {
  return (
    <section className="section" id="distribution" data-nav="how" aria-labelledby="dist-title">
      <div className="shell">
        <SectionHead id="dist-title" index="06" meta="Distribution" title="Approved skills reach every tool as one version.">
          <p>
            Savant keeps the canonical release and propagates it outward: native integrations where
            tools support remote delivery, a managed sync agent for developer environments.
          </p>
        </SectionHead>

        <div className="dm" data-reveal>
          <div className="dm-map">
            <div className="dm-source">
              <SavantIcon size={44} />
              <div>
                <div className="dm-source-skill">architecture-review</div>
                <div className="dm-source-version">
                  <span className="dm-signal" aria-hidden="true" />
                  <span className="num">v2.5.0</span> approved
                </div>
              </div>
            </div>

            <svg className="dm-lines" viewBox="0 0 120 200" preserveAspectRatio="none" aria-hidden="true">
              {ROW_Y.map((y) => (
                <path key={y} d={`M0 100C60 100 60 ${y} 120 ${y}`} pathLength={1} />
              ))}
            </svg>

            <ul className="dm-surfaces" aria-label="Distribution targets">
              {SURFACES.map((surface) => (
                <li key={surface.name}>
                  <span className="dm-node" aria-hidden="true" />
                  <span className="dm-name">{surface.name}</span>
                  <span className="dm-via">{surface.via}</span>
                  <span className="dm-sync">
                    <span className="num">v2.5.0</span>
                    <span className="dm-sync-ok">in sync</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <dl className="dm-points">
            {POINTS.map((point) => (
              <div key={point.title}>
                <dt>{point.title}</dt>
                <dd>{point.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
