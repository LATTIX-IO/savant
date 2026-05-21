"use client";

import { useState } from "react";

import { Ic } from "@/components/savant/icons";
import { Delta, Facet } from "@/components/savant/primitives";
import { EVAL_RUNS } from "@/lib/savant-data";

type StatusFilter = "all" | "running" | "regressions" | "passing";

export function EvaluationsScreen() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const running = EVAL_RUNS.filter((r) => r.status === "running");

  const filtered = (() => {
    if (statusFilter === "all") return EVAL_RUNS;
    if (statusFilter === "running") return running;
    if (statusFilter === "regressions") return EVAL_RUNS.filter((r) => r.status.includes("regression"));
    if (statusFilter === "passing") return EVAL_RUNS.filter((r) => r.status === "complete");
    return EVAL_RUNS;
  })();

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/04</span>
            <span className="sep">—</span>
            <span>Evaluations</span>
          </div>
          <h1 className="h-display">Evaluation runs</h1>
          <div className="page-head-sub">
            Every candidate is measured against its baseline. Runs are flagged when a candidate
            underperforms or regresses on rubric criteria.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost">
            <Ic.ExternalLink className="b-icon" />
            Export report
          </button>
          <button type="button" className="btn btn-primary">
            <Ic.Plus className="b-icon" />
            Run evaluation
          </button>
        </div>
      </div>

      <div className="kpi-strip" style={{ marginBottom: 24 }}>
        <div className="kpi">
          <div className="kpi-label">Coverage</div>
          <div className="kpi-value num">
            94<span style={{ fontSize: 16, color: "var(--muted)" }}>%</span>
          </div>
          <div className="kpi-trend up">▲ 2.1 pts · 30d</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg cases per run</div>
          <div className="kpi-value num">186</div>
          <div className="kpi-trend">contract-corpus largest</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Regressions · 24h</div>
          <div className="kpi-value num" style={{ color: "var(--oxblood)" }}>
            6
          </div>
          <div className="kpi-trend down">Contract Clause Reviewer</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Median runtime</div>
          <div className="kpi-value num">
            28<span style={{ fontSize: 16, color: "var(--muted)" }}>s</span>
          </div>
          <div className="kpi-trend up">▼ 4s vs last week</div>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
        <div className="col" style={{ gap: 0 }}>
          <div className="filterbar">
            <Facet active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
              All <span className="f-count">{EVAL_RUNS.length}</span>
            </Facet>
            <Facet active={statusFilter === "running"} onClick={() => setStatusFilter("running")}>
              Running <span className="f-count">{running.length}</span>
            </Facet>
            <Facet active={statusFilter === "regressions"} onClick={() => setStatusFilter("regressions")}>
              With regressions{" "}
              <span className="f-count">
                {EVAL_RUNS.filter((r) => r.status.includes("regression")).length}
              </span>
            </Facet>
            <Facet active={statusFilter === "passing"} onClick={() => setStatusFilter("passing")}>
              Passing <span className="f-count">{EVAL_RUNS.filter((r) => r.status === "complete").length}</span>
            </Facet>
            <div className="grow" />
            <button type="button" className="btn btn-sm">
              <Ic.Filter className="b-icon" />
              24h
            </button>
          </div>
          <div className="panel" style={{ borderRadius: "0 0 6px 6px", borderTop: 0 }}>
            <div className="panel-bd tight">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Skill / Version</th>
                    <th>Dataset</th>
                    <th style={{ textAlign: "right" }}>Cases</th>
                    <th style={{ textAlign: "right" }}>Pass</th>
                    <th style={{ textAlign: "right" }}>Δ</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const failed = r.cases - r.passed;
                    return (
                      <tr key={r.id}>
                        <td>
                          <div className="tbl-name-text">
                            <span className="pri">{r.skill}</span>
                            <span className="sec mono">{r.ref}</span>
                          </div>
                        </td>
                        <td className="mono" style={{ color: "var(--ink-3)", fontSize: 11.5 }}>
                          {r.dataset}
                        </td>
                        <td className="num" style={{ textAlign: "right" }}>
                          {r.cases}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="num">{r.passed}</span>
                          {failed > 0 && (
                            <span
                              className="num"
                              style={{ color: "var(--oxblood)", marginLeft: 6, fontSize: 11.5 }}
                            >
                              −{failed}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {r.delta == null ? (
                            <span className="subtle mono">baseline</span>
                          ) : (
                            <Delta v={r.delta} />
                          )}
                        </td>
                        <td>
                          {r.status === "running" ? (
                            <span className="chip chip-brass">
                              <RunningDot />
                              running
                            </span>
                          ) : r.status === "complete-with-regressions" ? (
                            <span className="chip chip-blood">
                              <Ic.Warn style={{ width: 10, height: 10 }} />
                              {failed} regressions
                            </span>
                          ) : r.status === "complete-baseline" ? (
                            <span className="chip chip-paper">baseline set</span>
                          ) : (
                            <span className="chip chip-moss">
                              <Ic.Check style={{ width: 10, height: 10 }} />
                              passed
                            </span>
                          )}
                        </td>
                        <td className="subtle" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {r.started}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd">
              <div className="row" style={{ gap: 10 }}>
                <div className="panel-title">Queue · running</div>
                <span className="chip chip-brass">
                  <RunningDot />
                  {running.length}
                </span>
              </div>
            </div>
            <div className="panel-bd" style={{ padding: 0 }}>
              {running.map((r) => {
                const pct = Math.round(((r.passed + (r.cases - r.passed) * 0.7) / r.cases) * 100);
                return (
                  <div key={r.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>
                    <div className="row between" style={{ marginBottom: 6 }}>
                      <span className="skill-name" style={{ fontSize: 12.5 }}>
                        {r.skill}
                      </span>
                      <span className="mono num subtle" style={{ fontSize: 11.5 }}>
                        {pct}%
                      </span>
                    </div>
                    <div className="mono subtle" style={{ fontSize: 11, marginBottom: 8 }}>
                      {r.ref} · {r.dataset}
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: "var(--ivory)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${pct}%`,
                          background: "var(--brass)",
                          animation: "shimmer 1.6s linear infinite",
                          backgroundImage:
                            "linear-gradient(90deg, var(--brass) 0%, var(--brass-deep) 50%, var(--brass) 100%)",
                          backgroundSize: "200% 100%",
                        }}
                      />
                    </div>
                    <div className="row" style={{ gap: 10, marginTop: 6 }}>
                      <span className="subtle" style={{ fontSize: 11 }}>
                        {r.passed}/{r.cases} cases · ~14s remaining
                      </span>
                    </div>
                  </div>
                );
              })}
              <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between" }}>
                <span className="subtle" style={{ fontSize: 11.5 }}>
                  Eval workers
                </span>
                <span className="mono" style={{ fontSize: 11.5 }}>
                  2 / 4 active
                </span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Coverage by tier</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>
                Skills with active eval suites
              </span>
            </div>
            <div className="panel-bd">
              <CoverageBar tier={1} pct={100} />
              <CoverageBar tier={2} pct={94} />
              <CoverageBar tier={3} pct={71} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Top failure modes · 30d</div>
            </div>
            <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <FailRow label="Off-policy response" n={42} />
              <FailRow label="Missing risk-flag" n={31} />
              <FailRow label="Format / schema drift" n={18} />
              <FailRow label="Latency p95 over budget" n={14} />
              <FailRow label="Tone compliance" n={8} last />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoverageBar({ tier, pct }: { tier: 1 | 2 | 3; pct: number }) {
  return (
    <div className="bar">
      <div className="bar-label row" style={{ gap: 6 }}>
        <span className={`tier tier-${tier}`}>T{tier}</span>
        <span style={{ fontSize: 12.5 }}>Tier {tier}</span>
      </div>
      <div className="bar-track">
        <div className={`bar-fill ${pct < 80 ? "warn" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="bar-value">
        {pct}
        <span className="muted" style={{ fontSize: 10.5, marginLeft: 2 }}>
          %
        </span>
      </div>
    </div>
  );
}

function FailRow({ label, n, last }: { label: string; n: number; last?: boolean }) {
  const max = 42;
  const pct = (n / max) * 100;
  return (
    <div style={{ padding: "8px 0", borderBottom: last ? 0 : "1px solid var(--rule)" }}>
      <div className="row between" style={{ marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{label}</span>
        <span className="mono num subtle" style={{ fontSize: 11.5 }}>
          {n}
        </span>
      </div>
      <div style={{ height: 3, background: "var(--ivory)", borderRadius: 2 }}>
        <div
          style={{ height: "100%", width: `${pct}%`, background: "var(--slate)", borderRadius: 2 }}
        />
      </div>
    </div>
  );
}

function RunningDot() {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        background: "currentColor",
        borderRadius: "50%",
        animation: "pulse 1.4s ease-in-out infinite",
      }}
    />
  );
}
