import { Ic } from "@/components/savant/icons";

type Step = {
  label: string;
  value: string;
  meta: string;
  metaSub?: string;
  state: "ok" | "warn" | "fail" | "now";
  icon?: React.ReactNode;
};

const STEPS: Step[] = [
  {
    label: "Repository",
    value: "wh/legal-skills",
    meta: "github · main",
    metaSub: "ari.chen · 4m ago",
    state: "ok",
  },
  {
    label: "Reference",
    value: "v2.4.0-rc.2",
    meta: "8a31cf2",
    metaSub: "+418 / −62",
    state: "ok",
  },
  {
    label: "Evaluation",
    value: "248 cases · 6 flagged",
    meta: "94% pass",
    metaSub: "−0.6 vs baseline",
    state: "warn",
  },
  {
    label: "Approval",
    value: "2 of 3 approved",
    meta: "compliance",
    metaSub: "awaiting",
    state: "now",
  },
  {
    label: "Release",
    value: "Production · v2.3.7",
    meta: "Pinned · 2d",
    metaSub: "vscode-sync · codex · github",
    state: "ok",
  },
];

function NodeIcon({ state }: { state: Step["state"] }) {
  if (state === "ok") return <Ic.Check />;
  if (state === "warn") return <Ic.Warn />;
  if (state === "fail") return <Ic.X />;
  // now — animated pulse, no inner glyph
  return null;
}

export function HeroProvenanceRail() {
  return (
    <div className="prov-rail" data-reveal data-reveal-delay="2">
      <div className="prov-rail-hd">
        <span>Provenance · live</span>
        <span className="pr-live">commit → release</span>
      </div>

      <div className="prov-rail-list">
        {STEPS.map((s) => (
          <div className="prov-step" key={s.label}>
            <span className={`prov-node ${s.state}`} aria-hidden>
              <NodeIcon state={s.state} />
            </span>
            <div className="prov-body">
              <div className="prov-label">{s.label}</div>
              <div className="prov-value">{s.value}</div>
            </div>
            <div className="prov-meta-right">
              <div>{s.meta}</div>
              {s.metaSub ? <span className="muted">{s.metaSub}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="prov-rail-foot">
        <span>
          <strong>contract-corpus-v9</strong>
          <span style={{ color: "var(--subtle)", marginLeft: 8 }}>
            ran 58m ago · 24s
          </span>
        </span>
        <span>signed bundle · 44a0…1cf2</span>
      </div>
    </div>
  );
}
