"use client";

import type { CSSProperties, ReactNode } from "react";
import { Ic, ProviderIcon, type ProviderId } from "@/components/savant/icons";

export function RepoChip({ provider, name }: { provider: ProviderId; name: string }) {
  return (
    <span className="ref" title={`${provider} · ${name}`}>
      <ProviderIcon p={provider} size={10} />
      <span>{name}</span>
    </span>
  );
}

export function CommitRef({ commit, label }: { commit: string; label?: string }) {
  return (
    <span className="ref">
      <Ic.Commit className="ref-icon" />
      <span>{label || commit}</span>
    </span>
  );
}

export function BranchRef({ branch }: { branch: string }) {
  return (
    <span className="ref">
      <Ic.Branch className="ref-icon" />
      <span>{branch}</span>
    </span>
  );
}

export function TagRef({ tag }: { tag: string }) {
  return (
    <span className="ref">
      <Ic.Tag className="ref-icon" />
      <span>{tag}</span>
    </span>
  );
}

const envMap: Record<string, { cls: string; dot: string; label: string }> = {
  production: { cls: "chip chip-moss", dot: "var(--moss)", label: "Production" },
  staging: { cls: "chip chip-brass", dot: "var(--brass)", label: "Staging" },
  draft: { cls: "chip chip-slate", dot: "var(--slate)", label: "Draft" },
  "—": { cls: "chip chip-paper", dot: "var(--faint)", label: "—" },
};

export function EnvPill({ env }: { env: string }) {
  const c = envMap[env] ?? envMap.draft!;
  return (
    <span className={c.cls}>
      <span className="dot" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

export function Tier({ n }: { n: number }) {
  return <span className={`tier tier-${n}`}>T{n}</span>;
}

export function Sparkline({
  data,
  w = 64,
  h = 22,
  color = "var(--moss)",
}: {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
}) {
  if (!data || data.length === 0) {
    return (
      <span className="faint mono" style={{ fontSize: 11 }}>
        —
      </span>
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pad = 2;
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const area = d + ` L${last[0]},${h} L${first[0]},${h} Z`;
  return (
    <svg className="minichart" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={area} fill={color} opacity="0.10" />
      <path d={d} stroke={color} strokeWidth="1.25" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="1.6" fill={color} />
    </svg>
  );
}

export function Delta({ v }: { v: number | string | null | undefined }) {
  if (v == null || v === "flat") return <span className="delta flat">±0.0</span>;
  let n: number;
  if (typeof v === "string") {
    const parsed = parseFloat(v);
    if (Number.isNaN(parsed)) return <span className="delta flat">{v}</span>;
    n = parsed;
  } else {
    n = v;
  }
  if (n > 0) return <span className="delta up">▲ {n.toFixed(1)}</span>;
  if (n < 0) return <span className="delta down">▼ {Math.abs(n).toFixed(1)}</span>;
  return <span className="delta flat">±0.0</span>;
}

export type ProvenanceStep = {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  state?: "ok" | "warn" | "fail" | "now" | "";
};

export function ProvenanceRail({ steps }: { steps: ProvenanceStep[] }) {
  return (
    <div className="rail">
      {steps.map((s, i) => (
        <div className={`rail-step ${s.state || ""}`} key={i}>
          <div className="rs-label">
            <span className="rs-node" />
            <span>{s.label}</span>
          </div>
          <div className="rs-value">{s.value}</div>
          {s.meta ? <div className="rs-meta">{s.meta}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function ScoreBar({
  label,
  baseline,
  candidate,
  dir,
}: {
  label: string;
  baseline: number;
  candidate: number;
  dir: "up" | "down";
}) {
  const cls = dir === "down" ? "bar-fill fail" : dir === "up" ? "bar-fill" : "bar-fill warn";
  return (
    <div className="bar">
      <div className="bar-label">{label}</div>
      <div className="bar-track">
        <div className={cls} style={{ width: `${candidate * 100}%` }} />
        <div className="bar-baseline" style={{ left: `${baseline * 100}%` }} title={`Baseline ${baseline}`} />
      </div>
      <div className="bar-value">
        {candidate.toFixed(2)}
        <span
          className="muted"
          style={{ fontSize: 10.5, marginLeft: 4, fontFamily: "var(--mono)" }}
        >
          ({dir === "up" ? "+" : "−"}
          {Math.abs(candidate - baseline).toFixed(2)})
        </span>
      </div>
    </div>
  );
}

export function Facet({
  active,
  onClick,
  children,
  count,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number | null;
}) {
  return (
    <button className={`facet ${active ? "active" : ""}`} onClick={onClick} type="button">
      {children}
      {count != null ? <span className="f-count">{count}</span> : null}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  const style: CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: 10.5,
    color: "var(--muted)",
    border: "1px solid var(--rule-2)",
    borderRadius: 3,
    padding: "1px 5px",
    background: "var(--linen)",
  };
  return <span style={style}>{children}</span>;
}
