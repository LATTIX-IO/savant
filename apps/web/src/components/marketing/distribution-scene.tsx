import type { ReactNode } from "react";

import { Ic } from "@/components/savant/icons";

type ToolBadge = {
  title: string;
  icon: ReactNode;
};

type ValuePoint = {
  title: string;
  detail: string;
  icon: ReactNode;
};

const RELEASE_CHIPS = ["signed release", "eval-backed", "ready to ship"] as const;
const POLICY_CHIPS = ["approval", "target rules", "version pin", "rollback ready"] as const;

const TOOL_BADGES: ToolBadge[] = [
  {
    title: "VS Code",
    icon: <Monogram value="VS" />,
  },
  {
    title: "Agents",
    icon: <Ic.Server />,
  },
  {
    title: "CI / automation",
    icon: <Ic.GitHub />,
  },
  {
    title: "Internal apps",
    icon: <Ic.Connectors />,
  },
];

const VALUE_POINTS: ValuePoint[] = [
  {
    title: "One source of truth",
    detail: "Approve once and know every downstream surface is using the same version.",
    icon: <Ic.CheckCircle />,
  },
  {
    title: "Safer rollout",
    detail: "Policy wraps delivery with approvals, allowed targets, and a clean rollback path.",
    icon: <Ic.Lock />,
  },
  {
    title: "Less drift",
    detail: "No manual re-copying, stale prompts, or guessing which tool is on which release.",
    icon: <Ic.Refresh />,
  },
];

function Monogram({ value }: { value: string }) {
  return (
    <span className="dist-monogram" aria-hidden="true">
      {value}
    </span>
  );
}

export function DistributionScene() {
  return (
    <div className="dist-scene" data-reveal data-reveal-delay="1">
      <div className="dist-storyboard">
        <article className="dist-story-card dist-story-card-source">
          <div className="dist-story-kicker">Approved release</div>
          <span className="dist-story-icon">
            <Ic.Release />
          </span>
          <h3>One approved version.</h3>
          <p>
            Savant starts from the release your team approved and keeps that version as the source of truth.
          </p>
          <div className="dist-chip-row">
            {RELEASE_CHIPS.map((chip) => (
              <span key={chip} className="dist-soft-chip">
                {chip}
              </span>
            ))}
          </div>
        </article>

        <div className="dist-flow-arrow" aria-hidden="true">
          <span />
        </div>

        <article className="dist-story-card dist-story-card-policy">
          <div className="dist-story-kicker">Policy layer</div>
          <span className="dist-story-icon">
            <Ic.Lock />
          </span>
          <h3>One policy decision.</h3>
          <p>
            Approval, allowed targets, and rollback controls are applied one time before anything goes downstream.
          </p>
          <div className="dist-chip-row">
            {POLICY_CHIPS.map((chip) => (
              <span key={chip} className="dist-policy-pill">
                {chip}
              </span>
            ))}
          </div>
        </article>

        <div className="dist-flow-arrow" aria-hidden="true">
          <span />
        </div>

        <article className="dist-story-card dist-story-card-tools">
          <div className="dist-story-kicker">Everyday tools</div>
          <span className="dist-story-icon">
            <Ic.Connectors />
          </span>
          <h3>One version in every tool.</h3>
          <p>
            IDEs, agents, automation, and internal apps stay aligned instead of quietly drifting apart.
          </p>
          <div className="dist-tool-cloud">
            {TOOL_BADGES.map((tool) => (
              <span key={tool.title} className="dist-tool-badge">
                <span className="dist-tool-badge-icon">{tool.icon}</span>
                <span>{tool.title}</span>
              </span>
            ))}
          </div>
        </article>
      </div>

      <div className="dist-value-strip" aria-label="Distribution value summary">
        {VALUE_POINTS.map((point) => (
          <article key={point.title} className="dist-value-item">
            <span className="dist-value-icon">{point.icon}</span>
            <div className="dist-value-copy">
              <h4>{point.title}</h4>
              <p>{point.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
