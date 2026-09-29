"use client";

import { useEffect, useMemo, useState } from "react";

import {
  REJECTION_REASONS,
  type GateCheck,
  type LearningHistoryPoint,
  type RecommendationEditStatus,
  type RejectionReason,
  type SkillImprovementRecommendation,
  type SkillIntelligencePayload,
} from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { Delta } from "@/components/savant/primitives";
import {
  fetchSkillImprovements,
  fetchSkillIntelligence,
  reevaluateImprovement,
  requestSkillOptimization,
  reviewImprovement,
  stageImprovement,
} from "@/lib/control-plane-client";

type LoadState<T> = { status: "loading" | "error" | "success"; data: T | null; error: string | null };

export function useSkillIntelligence(skillId: string, reloadToken: number) {
  const [intelligence, setIntelligence] = useState<LoadState<SkillIntelligencePayload>>({ status: "loading", data: null, error: null });
  const [improvements, setImprovements] = useState<LoadState<SkillImprovementRecommendation[]>>({ status: "loading", data: null, error: null });
  const [localReload, setLocalReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    fetchSkillIntelligence(skillId, { signal })
      .then((response) => setIntelligence({ status: "success", data: response.data, error: null }))
      .catch((error: unknown) => {
        if (!signal.aborted) {
          setIntelligence({ status: "error", data: null, error: error instanceof Error ? error.message : "Could not load skill intelligence." });
        }
      });
    fetchSkillImprovements(skillId, { signal })
      .then((response) => setImprovements({ status: "success", data: response.data, error: null }))
      .catch((error: unknown) => {
        if (!signal.aborted) {
          setImprovements({ status: "error", data: null, error: error instanceof Error ? error.message : "Could not load improvements." });
        }
      });

    return () => controller.abort();
  }, [skillId, reloadToken, localReload]);

  return { intelligence, improvements, reload: () => setLocalReload((value) => value + 1) };
}

function Note({ tone, children }: { tone?: "brass" | "blood"; children: React.ReactNode }) {
  return (
    <div className={`note ${tone ?? ""}`}>
      {tone === "blood" ? <Ic.XCircle className="n-icon" /> : tone === "brass" ? <Ic.Warn className="n-icon" /> : <Ic.Overview className="n-icon" />}
      <span>{children}</span>
    </div>
  );
}

function Loading({ state, label }: { state: LoadState<unknown>; label: string }) {
  if (state.status === "loading") {
    return (
      <div className="note">
        <Ic.Spinner className="n-icon" />
        <span>Loading {label}…</span>
      </div>
    );
  }
  return <Note tone="blood">{state.error ?? `Could not load ${label}.`}</Note>;
}

function fmt(value: number | null | undefined, digits = 1, suffix = ""): string {
  return value == null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function scoreClass(score: number | null): string {
  if (score == null) return "";
  if (score < 70) return "fail";
  if (score < 85) return "warn";
  return "";
}

function MeterRow({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div className="bar">
      <div className="bar-label">
        {label}
        {sub ? <span className="subtle" style={{ fontSize: 11, marginLeft: 6 }}>{sub}</span> : null}
      </div>
      <div className="bar-track">
        {value != null ? <div className={`bar-fill ${scoreClass(value)}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /> : null}
      </div>
      <div className="bar-value mono num">{fmt(value, 0)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RUNS
// ---------------------------------------------------------------------------

export function RunsTab({ state }: { state: LoadState<SkillIntelligencePayload> }) {
  if (!state.data) return <Loading state={state} label="run telemetry" />;
  const data = state.data;

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      {!data.telemetryEnabled ? (
        <Note tone="brass">Optimization telemetry is disabled for this skill. Only outcome metrics are retained.</Note>
      ) : null}
      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Telemetry coverage</div>
          <span className="subtle" style={{ fontSize: 11.5 }}>Last 90 days · {data.health.runCount} runs</span>
        </div>
        <div className="panel-bd tight">
          {data.coverage.length > 0 ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Runtime</th>
                  <th style={{ textAlign: "right" }}>Runs</th>
                  <th>Dominant level</th>
                  <th style={{ textAlign: "right" }}>Coverage</th>
                  <th style={{ textAlign: "right" }}>Full / IO / Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data.coverage.map((row) => (
                  <tr key={row.runtime}>
                    <td className="mono">{row.runtime.toUpperCase()}</td>
                    <td className="mono num" style={{ textAlign: "right" }}>{row.runCount}</td>
                    <td>
                      <span className={`chip ${row.dominantLevel === "full" ? "chip-moss" : row.dominantLevel === "io" ? "chip-brass" : "chip-paper"}`}>
                        {row.dominantLevel === "full" ? "FULL" : row.dominantLevel === "io" ? "PARTIAL" : "OUTCOME ONLY"}
                      </span>
                    </td>
                    <td className="mono num" style={{ textAlign: "right" }}>{fmt(row.coveragePct, 0, "%")}</td>
                    <td className="mono num subtle" style={{ textAlign: "right" }}>
                      {row.levelCounts.full} / {row.levelCounts.io} / {row.levelCounts.outcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Note>No runs have been reported yet. Instrument a runtime with a telemetry ingest token to start observing this skill.</Note>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Run history</div>
          <span className="subtle" style={{ fontSize: 11.5 }}>Latest {data.runs.length} · identities pseudonymized</span>
        </div>
        <div className="panel-bd tight">
          {data.runs.length > 0 ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Runtime</th>
                  <th>Version</th>
                  <th>Level</th>
                  <th>Outcome</th>
                  <th style={{ textAlign: "right" }}>Weak label</th>
                  <th>Feedback</th>
                  <th style={{ textAlign: "right" }}>Latency</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.runId}>
                    <td>
                      <div className="tbl-name-text">
                        <span className="pri mono" style={{ fontSize: 11.5 }}>{run.runId}</span>
                        <span className="sec">{run.started}{run.taskArchetype ? ` · ${run.taskArchetype}` : ""}</span>
                      </div>
                    </td>
                    <td>
                      <span className="mono">{run.runtime}</span>
                      {run.model ? <div className="subtle" style={{ fontSize: 11 }}>{run.model}</div> : null}
                    </td>
                    <td className="mono subtle">{run.skillVersionId}</td>
                    <td className="subtle">{run.telemetryLevel}</td>
                    <td>
                      {run.success == null ? <span className="subtle">—</span> : run.success
                        ? <span className="chip chip-moss"><Ic.Check style={{ width: 10, height: 10 }} />success</span>
                        : <span className="chip chip-blood"><Ic.X style={{ width: 10, height: 10 }} />failed</span>}
                    </td>
                    <td className="mono num" style={{ textAlign: "right" }}>{fmt(run.weakLabel, 2)}</td>
                    <td style={{ fontSize: 11.5 }} className="muted">{run.feedbackCategories.join(", ") || "—"}</td>
                    <td className="mono num subtle" style={{ textAlign: "right" }}>{run.latencyMs == null ? "—" : `${(run.latencyMs / 1000).toFixed(1)}s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Note>No runs recorded in the analysis window.</Note>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// INSIGHTS
// ---------------------------------------------------------------------------

function LearningCurve({ points }: { points: LearningHistoryPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const scored = points.filter((point) => point.score != null);
  if (scored.length < 2) {
    return <Note>The learning curve appears once at least two versions have evaluation scores.</Note>;
  }

  const width = 640;
  const height = 200;
  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const scores = scored.map((point) => point.score as number);
  const min = Math.floor(Math.min(...scores) / 5) * 5 - 5;
  const max = Math.min(100, Math.ceil(Math.max(...scores) / 5) * 5 + 5);
  const x = (index: number) => pad.left + (index / (scored.length - 1)) * (width - pad.left - pad.right);
  const y = (score: number) => pad.top + (1 - (score - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);
  const path = scored.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.score as number).toFixed(1)}`).join(" ");
  const ticks = [min, (min + max) / 2, max];
  const active = hover == null ? null : scored[hover] ?? null;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Quality score by skill version">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--rule)" strokeWidth={1} />
            <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="var(--subtle)">{tick.toFixed(0)}</text>
          </g>
        ))}
        {hover != null ? (
          <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} stroke="var(--rule-2)" strokeWidth={1} />
        ) : null}
        <path d={path} fill="none" stroke="var(--moss)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {scored.map((point, index) => (
          <g key={`${point.version}-${index}`}>
            {point.optimizerGenerated ? (
              <rect x={x(index) - 5} y={y(point.score as number) - 5} width={10} height={10} transform={`rotate(45 ${x(index)} ${y(point.score as number)})`} fill="var(--moss)" stroke="var(--panel)" strokeWidth={2} />
            ) : (
              <circle cx={x(index)} cy={y(point.score as number)} r={4} fill="var(--moss)" stroke="var(--panel)" strokeWidth={2} />
            )}
            <text x={x(index)} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">{point.version}</text>
            <rect
              x={x(index) - 18}
              y={pad.top}
              width={36}
              height={height - pad.top - pad.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
        {scored.length > 0 ? (
          <text x={x(scored.length - 1) - 6} y={y(scores[scores.length - 1] as number) - 10} textAnchor="end" fontSize={11} fill="var(--ink)">
            {(scores[scores.length - 1] as number).toFixed(1)}
          </text>
        ) : null}
      </svg>
      {active ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${(x(hover as number) / width) * 100}%`,
            transform: "translateX(-50%)",
            background: "var(--panel)",
            border: "1px solid var(--rule-2)",
            borderRadius: 4,
            padding: "6px 10px",
            fontSize: 11.5,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--ink)" }}>{active.version}</div>
          <div className="muted">Score {fmt(active.score)}{active.delta != null ? ` · Δ ${active.delta > 0 ? "+" : ""}${active.delta.toFixed(1)}` : ""}</div>
          {active.optimizerGenerated ? <div className="muted">Optimizer-generated · {active.runsUsed ?? "—"} runs used</div> : null}
        </div>
      ) : null}
      <div className="subtle" style={{ fontSize: 11, marginTop: 6 }}>
        ● human-authored release · ◆ release from an approved improvement recommendation
      </div>
    </div>
  );
}

export function InsightsTab({
  state,
  skillId,
  onChanged,
}: {
  state: LoadState<SkillIntelligencePayload>;
  skillId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!state.data) return <Loading state={state} label="skill insights" />;
  const data = state.data;
  const activeJob = data.jobs.find((job) => job.status === "queued" || job.status === "running") ?? null;

  async function analyze() {
    setBusy(true);
    setMessage(null);
    try {
      await requestSkillOptimization(skillId, {});
      setMessage({ tone: "ok", text: "Optimization queued. SkillOpt will propose a bounded candidate; nothing changes in production until a reviewer approves it." });
      onChanged();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not queue the optimization job." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split wide">
      <div className="col" style={{ gap: "var(--gutter)", minWidth: 0 }}>
        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Skill health</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>Composite is for navigation · promotion inspects each dimension</span>
          </div>
          <div className="panel-bd">
            <div className="row" style={{ gap: 28, alignItems: "baseline", marginBottom: 14, flexWrap: "wrap" }}>
              <div>
                <span className="h-display" style={{ fontSize: 34 }}>{data.health.composite ?? "—"}</span>
                <span className="muted" style={{ fontSize: 14 }}> / 100</span>
              </div>
              <div className="col" style={{ gap: 2 }}>
                <span className="eyebrow" style={{ fontSize: 10 }}>7-day trend</span>
                {data.health.trend7d == null ? <span className="subtle">—</span> : <Delta v={data.health.trend7d} />}
              </div>
              <div className="col" style={{ gap: 2 }}>
                <span className="eyebrow" style={{ fontSize: 10 }}>30-day trend</span>
                {data.health.trend30d == null ? <span className="subtle">—</span> : <Delta v={data.health.trend30d} />}
              </div>
              <div className="col" style={{ gap: 2 }}>
                <span className="eyebrow" style={{ fontSize: 10 }}>Runs</span>
                <span className="mono num">{data.health.runCount.toLocaleString()}</span>
              </div>
              <div className="col" style={{ gap: 2 }}>
                <span className="eyebrow" style={{ fontSize: 10 }}>Full-trajectory coverage</span>
                <span className="mono num">{fmt(data.health.fullTrajectoryCoverage, 0, "%")}</span>
              </div>
            </div>
            {data.health.dimensions.map((dimension) => (
              <MeterRow
                key={dimension.key}
                label={dimension.label}
                value={dimension.score}
                sub={dimension.sampleCount > 0 ? `n=${dimension.sampleCount}` : "no data"}
              />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Cohorts</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>Technical cohorts only · no individual performance scoring</span>
          </div>
          <div className="panel-bd tight">
            {data.cohorts.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Cohort</th>
                    <th>Value</th>
                    <th style={{ textAlign: "right" }}>Runs</th>
                    <th style={{ textAlign: "right" }}>Score</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.map((cohort) => (
                    <tr key={`${cohort.cohortType}-${cohort.cohortKey}`}>
                      <td className="subtle">{cohort.cohortType}</td>
                      <td className="mono">{cohort.cohortKey}</td>
                      <td className="mono num" style={{ textAlign: "right" }}>{cohort.runCount}</td>
                      <td className="mono num" style={{ textAlign: "right" }}>{fmt(cohort.score)}</td>
                      <td style={{ textAlign: "right" }}>
                        {cohort.flagged ? <span className="chip chip-blood"><Ic.Warn style={{ width: 10, height: 10 }} />investigate</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Note>Cohorts appear once runs arrive from more than one environment.</Note>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Learning curve</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>Quality by version</span>
          </div>
          <div className="panel-bd">
            <LearningCurve points={data.learningHistory} />
          </div>
          {data.learningHistory.length > 0 ? (
            <div className="panel-bd tight" style={{ borderTop: "1px solid var(--rule)" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Runs used</th>
                    <th style={{ textAlign: "right" }}>Score</th>
                    <th style={{ textAlign: "right" }}>Δ</th>
                    <th>Origin</th>
                  </tr>
                </thead>
                <tbody>
                  {data.learningHistory.map((point, index) => (
                    <tr key={`${point.version}-${index}`}>
                      <td className="mono">{point.version}</td>
                      <td className="subtle">{point.releasedAt ? new Date(point.releasedAt).toLocaleDateString() : "—"}</td>
                      <td className="mono num" style={{ textAlign: "right" }}>{point.runsUsed?.toLocaleString() ?? "—"}</td>
                      <td className="mono num" style={{ textAlign: "right" }}>{fmt(point.score)}</td>
                      <td style={{ textAlign: "right" }}>{point.delta == null ? <span className="subtle">—</span> : <Delta v={point.delta} />}</td>
                      <td>{point.optimizerGenerated ? <span className="chip chip-moss">improvement</span> : <span className="chip chip-paper">authored</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      <div className="col" style={{ gap: "var(--gutter)" }}>
        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Optimization eligibility</div>
            {data.eligibility.eligible
              ? <span className="chip chip-moss">sufficient evidence</span>
              : <span className="chip chip-brass">needs data</span>}
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(
              [
                ["Runs", data.eligibility.observed.runs, data.eligibility.thresholds.minRuns],
                ["Distinct tasks", data.eligibility.observed.distinctTasks, data.eligibility.thresholds.minDistinctTasks],
                ["Failure examples", data.eligibility.observed.failureExamples, data.eligibility.thresholds.minFailureExamples],
                ["Held-out cases", data.eligibility.observed.heldOutCandidates, data.eligibility.thresholds.minHeldOutCases],
              ] as const
            ).map(([label, observed, required]) => (
              <div key={label} className="row between" style={{ fontSize: 12.5 }}>
                <span className="muted">{label}</span>
                <span className="mono num" style={{ color: observed >= required ? "var(--ink)" : "var(--oxblood)" }}>
                  {observed} / {required}
                </span>
              </div>
            ))}
            {data.eligibility.blockers.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--ink-2)", display: "grid", gap: 4 }}>
                {data.eligibility.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : null}
            <div className="eyebrow" style={{ fontSize: 10, marginTop: 4 }}>Active triggers</div>
            {data.eligibility.triggers.length > 0 ? data.eligibility.triggers.map((finding, index) => (
              <div key={`${finding.trigger}-${index}`} style={{ fontSize: 12, color: "var(--ink-2)" }}>
                <span className={`chip ${finding.severity === "high" ? "chip-blood" : finding.severity === "medium" ? "chip-brass" : "chip-paper"}`} style={{ marginRight: 6 }}>
                  {finding.trigger}
                </span>
                {finding.detail}
              </div>
            )) : <span className="subtle" style={{ fontSize: 12 }}>No triggers are active.</span>}
            <div className="subtle" style={{ fontSize: 11.5 }}>Auto-optimization mode: <span className="mono">{data.autoOptimizationMode}</span></div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { void analyze(); }}
              disabled={busy || Boolean(activeJob) || !data.eligibility.eligible}
              title={data.eligibility.eligible ? undefined : "Minimum evidence thresholds are not met yet."}
            >
              {busy ? <Ic.Spinner className="b-icon" /> : <Ic.Refresh className="b-icon" />}
              {activeJob ? `Optimization ${activeJob.status}…` : "Analyze for improvements"}
            </button>
            {message ? <Note {...(message.tone === "error" ? { tone: "blood" as const } : {})}>{message.text}</Note> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Failure clusters</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>{data.clusters.reduce((sum, cluster) => sum + cluster.runCount, 0)} failure signals</span>
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.clusters.length > 0 ? data.clusters.map((cluster) => (
              <div key={cluster.clusterId} style={{ padding: "10px 12px", border: "1px solid var(--rule)", borderRadius: 4, background: "var(--linen)" }}>
                <div className="row between" style={{ gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>{cluster.label}</span>
                  <span className="mono num" style={{ fontSize: 12 }}>{cluster.runCount}</span>
                </div>
                <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>
                  {cluster.basis} · {cluster.distinctTasks} distinct tasks · {cluster.runtimes.join(", ")} · {cluster.share}% of failures
                </div>
              </div>
            )) : <Note>No failure clusters in the analysis window.</Note>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Optimization jobs</div>
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.jobs.length > 0 ? data.jobs.map((job) => (
              <div key={job.jobId} className="row between" style={{ fontSize: 12, gap: 8 }}>
                <span className="mono subtle">{job.jobId.slice(0, 8)} · {job.trigger}</span>
                <span className={`chip ${job.status === "completed" ? "chip-moss" : job.status === "failed" ? "chip-blood" : "chip-brass"}`} title={job.error ?? undefined}>
                  {job.status}
                </span>
              </div>
            )) : <span className="subtle" style={{ fontSize: 12 }}>No optimization jobs yet.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IMPROVEMENTS
// ---------------------------------------------------------------------------

const REJECTION_LABELS: Record<RejectionReason, string> = {
  "recommendation-incorrect": "Recommendation incorrect",
  "insufficient-evidence": "Insufficient evidence",
  "style-regression": "Style regression",
  "security-concern": "Security concern",
  overfit: "Overfit",
  "duplicate-instruction": "Duplicate instruction",
  "violates-organizational-method": "Violates organizational method",
  "good-idea-wrong-wording": "Good idea, wrong wording",
  "unnecessary-complexity": "Unnecessary complexity",
};

function statusChip(recommendation: SkillImprovementRecommendation) {
  const map: Record<SkillImprovementRecommendation["status"], string> = {
    generated: "chip-paper",
    evaluating: "chip-brass",
    "ready-for-review": "chip-slate",
    approved: "chip-moss",
    rejected: "chip-blood",
    superseded: "chip-paper",
  };
  return <span className={`chip ${map[recommendation.status]}`}>{recommendation.status}</span>;
}

function DiffView({ patch }: { patch: string }) {
  return (
    <pre style={{ margin: 0, padding: 14, fontSize: 12, lineHeight: 1.55, overflowX: "auto", background: "var(--linen)", border: "1px solid var(--rule)", borderRadius: 4 }}>
      {patch.split("\n").map((line, index) => {
        const color = line.startsWith("+") && !line.startsWith("+++")
          ? "var(--moss-deep)"
          : line.startsWith("-") && !line.startsWith("---")
            ? "var(--oxblood-deep)"
            : line.startsWith("@@") ? "var(--slate)" : "var(--ink-2)";
        const background = line.startsWith("+") && !line.startsWith("+++")
          ? "var(--moss-soft)"
          : line.startsWith("-") && !line.startsWith("---") ? "var(--oxblood-soft)" : "transparent";
        return (
          <div key={index} style={{ color, background, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line || " "}</div>
        );
      })}
    </pre>
  );
}

function GateRow({ entry }: { entry: GateCheck }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
      {entry.passed
        ? <Ic.CheckCircle style={{ width: 14, height: 14, color: "var(--moss)", flexShrink: 0, marginTop: 2 }} />
        : <Ic.XCircle style={{ width: 14, height: 14, color: entry.blocking ? "var(--oxblood)" : "var(--brass)", flexShrink: 0, marginTop: 2 }} />}
      <div>
        <div style={{ color: "var(--ink)", fontWeight: 500 }}>
          {entry.label}
          {!entry.blocking ? <span className="subtle" style={{ fontWeight: 400 }}> · advisory</span> : null}
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>{entry.detail}</div>
      </div>
    </div>
  );
}

function Explain({ question, answer }: { question: string; answer: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 3 }}>{question}</div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>{answer}</div>
    </div>
  );
}

function RecommendationDetail({
  recommendation,
  isDevelopment,
  onUpdated,
}: {
  recommendation: SkillImprovementRecommendation;
  isDevelopment: boolean;
  onUpdated: () => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [mode, setMode] = useState<"idle" | "reject" | "edit">("idle");
  const [reasons, setReasons] = useState<RejectionReason[]>([]);
  const [comment, setComment] = useState("");
  const [draft, setDraft] = useState(recommendation.candidateContent);
  const [editDecisions, setEditDecisions] = useState<Record<string, RecommendationEditStatus>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [devAlias, setDevAlias] = useState("");

  const open = recommendation.status === "ready-for-review" || recommendation.status === "evaluating" || recommendation.status === "generated";
  const validation = recommendation.validation;
  const approvalCount = recommendation.approvals.length;
  const partialSelection = Object.values(editDecisions).some((value) => value === "rejected");

  async function submit(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ tone: "ok", text: success });
      setMode("idle");
      onUpdated();
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "The review action failed." });
    } finally {
      setBusy(false);
    }
  }

  const alias = isDevelopment && devAlias.trim() ? { devReviewerAlias: devAlias.trim() } : {};

  return (
    <div className="col" style={{ gap: "var(--gutter)", minWidth: 0 }}>
      <div className={`note ${validation.passed && !recommendation.requiresReevaluation ? "" : "brass"}`}>
        <Ic.Eval className="n-icon" />
        <div className="grow">
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
            {recommendation.status === "ready-for-review"
              ? validation.passed
                ? `Improvement available · ${recommendation.baseVersion} → candidate ${recommendation.candidateVersion ?? ""}`
                : `Candidate ${recommendation.candidateVersion ?? ""} did not pass the validation gate`
              : recommendation.status === "evaluating"
                ? "Candidate is being re-evaluated — the edited artifact must pass validation again before approval."
                : `Recommendation ${recommendation.status}`}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Trigger {recommendation.trigger} · {approvalCount} of {recommendation.requiredApprovals} approvals · Tier {recommendation.skillTier}
            {recommendation.releaseRequestId ? ` · release request ${recommendation.releaseRequestId.slice(0, 12)}` : ""}
          </div>
        </div>
        {statusChip(recommendation)}
      </div>

      <div className="panel">
        <div className="panel-hd"><div className="panel-title">Why this change</div></div>
        <div className="panel-bd" style={{ display: "grid", gap: 14 }}>
          <Explain question="What did we observe?" answer={recommendation.explanation.observed} />
          <Explain question="What pattern did the optimizer infer?" answer={recommendation.explanation.inferredPattern} />
          <Explain question="What is being changed?" answer={recommendation.explanation.change} />
          <Explain question="What evidence says this is better?" answer={recommendation.explanation.evidence} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Proposed change</div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowDiff((value) => !value)}>
              {showDiff ? "Show edits" : "View diff"}
            </button>
          </div>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
          {recommendation.lockedRegions.length > 0 ? (
            <div className="subtle row" style={{ fontSize: 11.5, gap: 6 }}>
              <Ic.Lock style={{ width: 10, height: 10 }} />
              Locked regions untouched: {recommendation.lockedRegions.join(", ")}
            </div>
          ) : null}
          {showDiff ? <DiffView patch={recommendation.proposedPatch} /> : recommendation.edits.map((edit) => {
            const decision = editDecisions[edit.editId] ?? edit.status;
            return (
              <div key={edit.editId} style={{ border: "1px solid var(--rule)", borderRadius: 4, padding: "10px 12px", opacity: decision === "rejected" ? 0.55 : 1 }}>
                <div className="row between" style={{ gap: 8, marginBottom: 6 }}>
                  <span className="subtle" style={{ fontSize: 11.5 }}>
                    <span className="chip chip-paper" style={{ marginRight: 6 }}>{edit.op}</span>
                    {edit.section ?? "(preamble)"} · line {edit.baseStart + 1}
                  </span>
                  {open && recommendation.status === "ready-for-review" ? (
                    <label className="row" style={{ gap: 6, fontSize: 11.5 }}>
                      <input
                        type="checkbox"
                        checked={decision !== "rejected"}
                        onChange={(event) => setEditDecisions((current) => ({ ...current, [edit.editId]: event.target.checked ? "accepted" : "rejected" }))}
                      />
                      include
                    </label>
                  ) : null}
                </div>
                {edit.before ? <DiffView patch={edit.before.split("\n").map((line) => `-${line}`).join("\n")} /> : null}
                {edit.op !== "delete" ? <DiffView patch={edit.after.split("\n").map((line) => `+${line}`).join("\n")} /> : null}
                {edit.rationale ? <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{edit.rationale}</div> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid-2-equal">
        <div className="panel">
          <div className="panel-hd"><div className="panel-title">Expected effect</div></div>
          <div className="panel-bd tight">
            <table className="tbl">
              <tbody>
                <tr>
                  <td>Validation score</td>
                  <td className="mono num" style={{ textAlign: "right" }}>{fmt(validation.baselineScore)} → {fmt(validation.candidateScore)}</td>
                  <td style={{ textAlign: "right" }}><Delta v={validation.delta} /></td>
                </tr>
                {validation.dimensions.map((dimension) => (
                  <tr key={dimension.dimension}>
                    <td>
                      {dimension.dimension}
                      {dimension.critical ? <span className="chip chip-paper" style={{ marginLeft: 6 }}>guardrail</span> : null}
                    </td>
                    <td className="mono num" style={{ textAlign: "right" }}>{fmt(dimension.baseline)} → {fmt(dimension.candidate)}</td>
                    <td style={{ textAlign: "right" }}><Delta v={dimension.lowerIsBetter ? -dimension.delta : dimension.delta} /></td>
                  </tr>
                ))}
                <tr>
                  <td>Latency</td>
                  <td colSpan={2} className="mono num" style={{ textAlign: "right" }}>{validation.latencyDeltaPct == null ? "—" : `${validation.latencyDeltaPct > 0 ? "+" : ""}${validation.latencyDeltaPct}%`}</td>
                </tr>
                <tr>
                  <td>Cost</td>
                  <td colSpan={2} className="mono num" style={{ textAlign: "right" }}>{validation.costDeltaPct == null ? "—" : `${validation.costDeltaPct > 0 ? "+" : ""}${validation.costDeltaPct}%`}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ padding: "10px 14px", fontSize: 12 }} className="muted">
              {validation.interval
                ? <>Estimated improvement {validation.delta >= 0 ? "+" : ""}{validation.delta} points · {Math.round(validation.interval.confidence * 100)}% bootstrap interval {validation.interval.low >= 0 ? "+" : ""}{validation.interval.low} to {validation.interval.high >= 0 ? "+" : ""}{validation.interval.high} · evidence <b style={{ color: "var(--ink)" }}>{validation.evidenceStrength.toUpperCase()}</b></>
                : <>Evidence strength: <b>{validation.evidenceStrength.toUpperCase()}</b> — too few paired cases for an interval.</>}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Validation gate</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>Regression suite {validation.regressionSuite.passed} / {validation.regressionSuite.total}</span>
          </div>
          <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
            {validation.gate.map((entry, index) => <GateRow key={`${entry.key}-${index}`} entry={entry} />)}
          </div>
        </div>
      </div>

      {validation.runtimeMatrix.length > 0 ? (
        <div className="panel">
          <div className="panel-hd"><div className="panel-title">Cross-runtime robustness</div></div>
          <div className="panel-bd tight">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Runtime</th>
                  <th style={{ textAlign: "right" }}>Baseline</th>
                  <th style={{ textAlign: "right" }}>Candidate</th>
                  <th style={{ textAlign: "right" }}>Δ</th>
                  <th style={{ textAlign: "right" }}>Cases</th>
                </tr>
              </thead>
              <tbody>
                {validation.runtimeMatrix.map((row) => (
                  <tr key={row.runtime}>
                    <td className="mono">{row.runtime}</td>
                    <td className="mono num" style={{ textAlign: "right" }}>{fmt(row.baseline)}</td>
                    <td className="mono num" style={{ textAlign: "right" }}>{fmt(row.candidate)}</td>
                    <td style={{ textAlign: "right" }}><Delta v={row.delta} /></td>
                    <td className="mono num subtle" style={{ textAlign: "right" }}>{row.sampleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {recommendation.dependencyImpact && recommendation.dependencyImpact.directDependents + recommendation.dependencyImpact.transitiveDependents > 0 ? (
        <div className="panel">
          <div className="panel-hd"><div className="panel-title">Change impact</div></div>
          <div className="panel-bd" style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
            <div className="row between"><span className="muted">Direct dependents</span><span className="mono num">{recommendation.dependencyImpact.directDependents}</span></div>
            <div className="row between"><span className="muted">Transitive dependents</span><span className="mono num">{recommendation.dependencyImpact.transitiveDependents}</span></div>
            {recommendation.dependencyImpact.suites.map((suite) => (
              <div key={suite.skillId} className="row" style={{ gap: 6 }}>
                {suite.passed == null ? <Ic.Clock style={{ width: 12, height: 12 }} /> : suite.passed ? <Ic.Check style={{ width: 12, height: 12, color: "var(--moss)" }} /> : <Ic.X style={{ width: 12, height: 12, color: "var(--oxblood)" }} />}
                <span className="mono">{suite.skillId}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-hd"><div className="panel-title">Review</div></div>
        <div className="panel-bd" style={{ display: "grid", gap: 12 }}>
          {feedback ? <Note {...(feedback.tone === "error" ? { tone: "blood" as const } : {})}>{feedback.text}</Note> : null}
          {isDevelopment && open ? (
            <label className="row" style={{ gap: 8, fontSize: 11.5 }}>
              <span className="subtle">Dev reviewer alias</span>
              <input value={devAlias} onChange={(event) => setDevAlias(event.target.value)} placeholder="e.g. sme" style={{ height: 26, maxWidth: 160, padding: "0 8px", border: "1px solid var(--rule-2)", borderRadius: 4, background: "var(--panel)", color: "var(--ink)", fontSize: 12 }} />
            </label>
          ) : null}

          {mode === "reject" ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div className="eyebrow" style={{ fontSize: 10 }}>Rejection reasons (used as structured signals for future runs)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6 }}>
                {REJECTION_REASONS.map((reason) => (
                  <label key={reason} className="row" style={{ gap: 6, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={reasons.includes(reason)}
                      onChange={(event) => setReasons((current) => event.target.checked ? [...current, reason] : current.filter((entry) => entry !== reason))}
                    />
                    {REJECTION_LABELS[reason]}
                  </label>
                ))}
              </div>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Optional reviewer note (never fed into skill content)" rows={3} style={{ width: "100%", padding: 8, border: "1px solid var(--rule-2)", borderRadius: 4, background: "var(--panel)", color: "var(--ink)", fontSize: 12.5 }} />
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => setMode("idle")}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy || reasons.length === 0}
                  onClick={() => { void submit(() => reviewImprovement(recommendation.recommendationId, { decision: "reject", reasons, ...(comment.trim() ? { comment } : {}), ...alias }), "Recommendation rejected. The reasons will inform future optimization runs."); }}
                >
                  Confirm rejection
                </button>
              </div>
            </div>
          ) : null}

          {mode === "edit" ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div className="subtle" style={{ fontSize: 11.5 }}>Editing the candidate voids approvals and re-runs the full evaluation. Locked regions must stay unchanged.</div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                rows={18}
                style={{ width: "100%", padding: 12, border: "1px solid var(--rule-2)", borderRadius: 4, background: "var(--panel)", color: "var(--ink)", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12 }}
              />
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => { setDraft(recommendation.candidateContent); setMode("idle"); }}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy || draft === recommendation.candidateContent}
                  onClick={() => { void submit(() => reviewImprovement(recommendation.recommendationId, { decision: "modify", candidateContent: draft, ...alias }), "Candidate updated and queued for re-evaluation."); }}
                >
                  Save and re-evaluate
                </button>
              </div>
            </div>
          ) : null}

          {mode === "idle" && open ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => {
                  void submit(
                    () => recommendation.status === "evaluating"
                      ? reevaluateImprovement(recommendation.recommendationId)
                      : reviewImprovement(recommendation.recommendationId, { decision: "request-more-testing", ...alias }),
                    "Additional evaluation requested.",
                  );
                }}
              >
                Run more tests
              </button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setMode("edit")}>Edit candidate</button>
              {partialSelection ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={busy}
                  onClick={() => { void submit(() => reviewImprovement(recommendation.recommendationId, { decision: "modify", editDecisions, ...alias }), "Selected edits kept; candidate queued for re-evaluation."); }}
                >
                  Apply selected edits
                </button>
              ) : null}
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setMode("reject")}>Reject</button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy || recommendation.status !== "ready-for-review" || !validation.passed || recommendation.requiresReevaluation || partialSelection}
                onClick={() => { void submit(() => reviewImprovement(recommendation.recommendationId, { decision: "approve", ...alias }), "Approval recorded."); }}
              >
                <Ic.Check className="b-icon" />
                Approve for staging
              </button>
            </div>
          ) : null}

          {recommendation.status === "approved" && !recommendation.releaseRequestId ? (
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>Approved — the release has not been staged yet.</span>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => { void submit(() => stageImprovement(recommendation.recommendationId), "Staged to the release rail."); }}>
                Stage release
              </button>
            </div>
          ) : null}

          {recommendation.reviews.length > 0 ? (
            <div className="tl">
              {recommendation.reviews.map((review) => (
                <div className="tl-item" key={review.reviewId}>
                  <span className={`tl-node ${review.decision === "approve" ? "moss" : review.decision === "reject" ? "blood" : "slate"}`} />
                  <div>
                    <div className="tl-pri"><b>{review.reviewer}</b> <span className="muted">{review.decision}</span></div>
                    <div className="tl-sec">
                      {review.reviewerRole}
                      {review.reasons.length > 0 ? ` · ${review.reasons.map((reason) => REJECTION_LABELS[reason]).join(", ")}` : ""}
                      {review.comment ? ` · “${review.comment}”` : ""}
                    </div>
                  </div>
                  <div className="tl-meta">{new Date(review.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="subtle" style={{ fontSize: 11.5 }}>
        Optimization engine: {recommendation.provenance.engineDisplayName} {recommendation.provenance.version}
        {recommendation.provenance.sourceCommit ? ` @ ${recommendation.provenance.sourceCommit.slice(0, 7)}` : ""}
        {" · "}optimizer {recommendation.provenance.optimizerModel} via {recommendation.provenance.optimizerBackend}
        {" · "}config {recommendation.provenance.configHash.slice(0, 12)}
      </div>
    </div>
  );
}

export function ImprovementsTab({
  state,
  isDevelopment,
  onChanged,
}: {
  state: LoadState<SkillImprovementRecommendation[]>;
  isDevelopment: boolean;
  onChanged: () => void;
}) {
  const recommendations = useMemo(() => state.data ?? [], [state.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!state.data) return <Loading state={state} label="improvement recommendations" />;

  const selected = recommendations.find((recommendation) => recommendation.recommendationId === selectedId)
    ?? recommendations.find((recommendation) => recommendation.status === "ready-for-review" || recommendation.status === "evaluating")
    ?? recommendations[0]
    ?? null;

  if (!selected) {
    return (
      <Note>
        No improvement recommendations yet. Savant is learning how this capability performs; once there is enough evidence, SkillOpt candidates will appear here for review. Nothing changes in production without approval.
      </Note>
    );
  }

  return (
    <div className="split wide">
      <RecommendationDetail
        key={`${selected.recommendationId}-${selected.updatedAt}`}
        recommendation={selected}
        isDevelopment={isDevelopment}
        onUpdated={onChanged}
      />
      <div className="col" style={{ gap: "var(--gutter)" }}>
        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Recommendations</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>{recommendations.length}</span>
          </div>
          <div className="panel-bd" style={{ display: "grid", gap: 8 }}>
            {recommendations.map((recommendation) => (
              <button
                type="button"
                key={recommendation.recommendationId}
                onClick={() => setSelectedId(recommendation.recommendationId)}
                style={{
                  textAlign: "left",
                  border: `1px solid ${recommendation.recommendationId === selected.recommendationId ? "var(--ink-3)" : "var(--rule)"}`,
                  borderRadius: 4,
                  background: "var(--linen)",
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <div className="row between" style={{ gap: 8 }}>
                  <span className="mono" style={{ fontSize: 12 }}>{recommendation.baseVersion} → {recommendation.candidateVersion ?? "candidate"}</span>
                  {statusChip(recommendation)}
                </div>
                <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>
                  {new Date(recommendation.createdAt).toLocaleDateString()} · Δ {recommendation.validation.delta >= 0 ? "+" : ""}{recommendation.validation.delta} · {recommendation.validation.evidenceStrength}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-hd"><div className="panel-title">Evidence</div></div>
          <div className="panel-bd" style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
            <div className="row between"><span className="muted">Runs analyzed</span><span className="mono num">{selected.evidence.runCount.toLocaleString()}</span></div>
            <div className="row between"><span className="muted">Failure cases</span><span className="mono num">{selected.evidence.failureCount}</span></div>
            <div className="row between"><span className="muted">Observed in</span><span className="mono num">{selected.evidence.runtimes.length} runtimes</span></div>
            <div className="row between"><span className="muted">Median edit required</span><span className="mono num">{selected.evidence.medianEditRatio == null ? "—" : `${Math.round(selected.evidence.medianEditRatio * 100)}%`}</span></div>
            {selected.evidence.clusters.length > 0 ? (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Clusters: {selected.evidence.clusters.slice(0, 4).join(" · ")}</div>
            ) : null}
            {selected.evidence.exampleRunIds.length > 0 ? (
              <div className="subtle mono" style={{ fontSize: 10.5, marginTop: 4, wordBreak: "break-all" }}>Example runs: {selected.evidence.exampleRunIds.slice(0, 5).join(", ")}</div>
            ) : null}
          </div>
        </div>
        <div className="panel">
          <div className="panel-hd"><div className="panel-title">Objective</div></div>
          <div className="panel-bd" style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>{selected.objective.statement}</div>
        </div>
      </div>
    </div>
  );
}
