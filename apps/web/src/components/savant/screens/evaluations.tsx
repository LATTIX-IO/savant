"use client";

import type {
  EvaluationDashboardMetric,
  EvaluationDashboardResponse,
  EvaluationRunListItem,
  EvaluationTierCoverageItem,
} from "@savant/types";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { Delta, Facet } from "@/components/savant/primitives";
import {
  ControlPlaneClientError,
  fetchEvaluationDashboard,
} from "@/lib/control-plane-client";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";

type StatusFilter = "all" | "running" | "regressions" | "passing";
type LoadState = "loading" | "ready" | "error";

type RegressionLeader = {
  skillId: string;
  skill: string;
  failedCases: number;
  latestRunId: string;
};

export function EvaluationsScreen() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dashboard, setDashboard] = useState<EvaluationDashboardResponse["data"] | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const pathname = usePathname() || "/";

  useEffect(() => {
    const abortController = new AbortController();

    async function loadDashboard() {
      setLoadState("loading");
      setErrorMessage(null);

      try {
        const response = await fetchEvaluationDashboard({ signal: abortController.signal });

        if (abortController.signal.aborted) {
          return;
        }

        setDashboard(response.data);
        setLoadState("ready");
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setDashboard(null);
        setLoadState("error");
        setErrorMessage(
          error instanceof ControlPlaneClientError
            ? error.message
            : "Unable to load live evaluation runs right now.",
        );
      }
    }

    void loadDashboard();

    return () => {
      abortController.abort();
    };
  }, [reloadToken]);

  const runs = useMemo(
    () => dashboard?.runs ?? [],
    [dashboard],
  );
  const kpis = dashboard?.kpis ?? [];
  const coverageByTier = dashboard?.coverageByTier ?? [];
  const running = useMemo(
    () => runs.filter((run) => run.status === "running"),
    [runs],
  );
  const regressionRuns = useMemo(
    () => runs.filter((run) => isRegressionLikeRun(run)),
    [runs],
  );
  const passingRuns = useMemo(
    () => runs.filter((run) => run.status === "complete"),
    [runs],
  );
  const regressionLeaders = useMemo(
    () => buildRegressionLeaders(runs),
    [runs],
  );

  const filtered = (() => {
    if (statusFilter === "all") return runs;
    if (statusFilter === "running") return running;
    if (statusFilter === "regressions") return regressionRuns;
    if (statusFilter === "passing") return passingRuns;
    return runs;
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
          <button type="button" className="btn btn-ghost" disabled title="Export is not wired to the live control-plane yet.">
            <Ic.ExternalLink className="b-icon" />
            Export report
          </button>
          <button type="button" className="btn btn-primary" disabled title="Run evaluation is not wired to the live control-plane yet.">
            <Ic.Plus className="b-icon" />
            Run evaluation
          </button>
        </div>
      </div>

      {loadState === "loading" && !dashboard ? (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-bd">
            <div className="note">
              <Ic.Spinner className="n-icon" />
              <div className="grow">
                <div style={{ fontSize: 13, fontWeight: 500 }}>Loading live evaluation runs…</div>
                <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                  Pulling indexed runs, coverage, and recent regression signals from the control plane.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : loadState === "error" && !dashboard ? (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-bd">
            <div className="note brass">
              <Ic.Warn className="n-icon" />
              <div className="grow">
                <div style={{ fontSize: 13, fontWeight: 500 }}>Live evaluation data is unavailable.</div>
                <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                  {errorMessage ?? "Unable to load live evaluation runs right now."}
                </div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setReloadToken((current) => current + 1)}>
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="kpi-strip" style={{ marginBottom: 24 }}>
            {kpis.map((metric) => (
              <div key={metric.key} className="kpi">
                <div className="kpi-label">{metric.label}</div>
                <div
                  className="kpi-value num"
                  style={metric.trend === "down" && metric.key === "regressions-24h"
                    ? { color: "var(--oxblood)" }
                    : undefined}
                >
                  {formatMetricValue(metric)}
                </div>
                <div className={`kpi-trend${metric.trend === "flat" ? "" : ` ${metric.trend}`}`}>
                  {metric.trend === "up" ? "▲ " : metric.trend === "down" ? "▼ " : ""}
                  {metric.trendLabel}
                </div>
              </div>
            ))}
          </div>

          {loadState === "error" && errorMessage ? (
            <div className="note brass" style={{ marginBottom: 16 }}>
              <Ic.Warn className="n-icon" />
              <div className="grow" style={{ fontSize: 12.5 }}>
                {errorMessage}
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setReloadToken((current) => current + 1)}>
                Retry
              </button>
            </div>
          ) : null}

          <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
            <div className="col" style={{ gap: 0 }}>
              <div className="filterbar">
                <Facet active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
                  All <span className="f-count">{runs.length}</span>
                </Facet>
                <Facet active={statusFilter === "running"} onClick={() => setStatusFilter("running")}>
                  Running <span className="f-count">{running.length}</span>
                </Facet>
                <Facet active={statusFilter === "regressions"} onClick={() => setStatusFilter("regressions")}>
                  With regressions <span className="f-count">{regressionRuns.length}</span>
                </Facet>
                <Facet active={statusFilter === "passing"} onClick={() => setStatusFilter("passing")}>
                  Passing <span className="f-count">{passingRuns.length}</span>
                </Facet>
                <div className="grow" />
                <button type="button" className="btn btn-sm" disabled title="This view already reflects the live index.">
                  <Ic.Filter className="b-icon" />
                  Live index
                </button>
              </div>
              <div className="panel" style={{ borderRadius: "0 0 6px 6px", borderTop: 0 }}>
                <div className="panel-bd tight">
                  {runs.length === 0 ? (
                    <div className="note" style={{ margin: 12 }}>
                      <Ic.Eval className="n-icon" />
                      <div className="grow">
                        <div style={{ fontSize: 13, fontWeight: 500 }}>No indexed evaluation runs yet.</div>
                        <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                          Once the control plane indexes evaluation results, they will show up here with live coverage and regression summaries.
                        </div>
                      </div>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="note" style={{ margin: 12 }}>
                      <Ic.Filter className="n-icon" />
                      <div className="grow">
                        <div style={{ fontSize: 13, fontWeight: 500 }}>No runs match this filter.</div>
                        <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                          Try a different status filter to inspect the rest of the indexed run history.
                        </div>
                      </div>
                    </div>
                  ) : (
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
                        {filtered.map((run) => {
                          const detailHref = buildTenantAwareAppPath(
                            pathname,
                            `/evaluations/${encodeURIComponent(run.id)}`,
                          ) as Route;

                          return (
                            <tr key={run.id}>
                              <td>
                                <div className="tbl-name-text">
                                  <Link
                                    href={detailHref}
                                    style={{ color: "inherit", textDecoration: "none" }}
                                  >
                                    <span
                                      className="pri"
                                      style={{
                                        textDecoration: "underline",
                                        textDecorationColor: "var(--moss-soft)",
                                        textUnderlineOffset: 3,
                                      }}
                                    >
                                      {run.skill}
                                    </span>
                                  </Link>
                                    <span className="sec mono">T{run.skillTier} · {run.ref} · {formatRunIdentifier(run.id)}</span>
                                </div>
                              </td>
                              <td className="mono" style={{ color: "var(--ink-3)", fontSize: 11.5 }}>
                                {run.dataset}
                              </td>
                              <td className="num" style={{ textAlign: "right" }}>
                                {run.cases}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <span className="num">{run.passed}</span>
                                {run.failed > 0 ? (
                                  <span
                                    className="num"
                                    style={{ color: "var(--oxblood)", marginLeft: 6, fontSize: 11.5 }}
                                  >
                                    −{run.failed}
                                  </span>
                                ) : null}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                {run.delta == null ? (
                                  <span className="subtle mono">baseline</span>
                                ) : (
                                  <Delta v={run.delta} />
                                )}
                              </td>
                              <td>{renderEvaluationStatusChip(run)}</td>
                              <td className="subtle" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                {run.started}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
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
                  {running.length === 0 ? (
                    <div className="note" style={{ margin: 12 }}>
                      <Ic.Check className="n-icon" />
                      <div className="grow">
                        <div style={{ fontSize: 13, fontWeight: 500 }}>No live runs are in progress.</div>
                        <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                          New running evaluations will appear here as soon as the control plane indexes them.
                        </div>
                      </div>
                    </div>
                  ) : running.map((run) => {
                    const completedCases = Math.min(run.cases, run.passed + run.failed);
                    const pct = Math.round((completedCases / Math.max(run.cases, 1)) * 100);
                    const detailHref = buildTenantAwareAppPath(
                      pathname,
                      `/evaluations/${encodeURIComponent(run.id)}`,
                    ) as Route;

                    return (
                      <div key={run.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>
                        <div className="row between" style={{ marginBottom: 6 }}>
                          <Link
                            href={detailHref}
                            className="skill-name"
                            style={{ fontSize: 12.5, textDecoration: "none", color: "var(--ink)" }}
                          >
                            {run.skill}
                          </Link>
                          <span className="mono num subtle" style={{ fontSize: 11.5 }}>
                            {pct}%
                          </span>
                        </div>
                        <div className="mono subtle" style={{ fontSize: 11, marginBottom: 8 }}>
                          {run.ref} · {run.dataset}
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
                            {completedCases}/{run.cases} cases indexed so far
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between" }}>
                    <span className="subtle" style={{ fontSize: 11.5 }}>
                      Live worker queue
                    </span>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {running.length} active
                    </span>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-hd">
                  <div className="panel-title">Coverage by tier</div>
                  <span className="subtle" style={{ fontSize: 11.5 }}>
                    Skills with indexed evaluation activity
                  </span>
                </div>
                <div className="panel-bd">
                  {coverageByTier.map((item) => <CoverageBar key={item.tier} item={item} />)}
                </div>
              </div>

              <div className="panel">
                <div className="panel-hd">
                  <div className="panel-title">Regression-heavy skills · 30d</div>
                </div>
                <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {regressionLeaders.length === 0 ? (
                    <div className="note" style={{ margin: 0 }}>
                      <Ic.Check className="n-icon" />
                      <div className="grow">
                        <div style={{ fontSize: 13, fontWeight: 500 }}>No recent regression-heavy skills.</div>
                        <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                          Once the index captures failed or regressing runs, the noisiest skills will surface here.
                        </div>
                      </div>
                    </div>
                  ) : regressionLeaders.map((leader, index) => {
                    const detailHref = buildTenantAwareAppPath(
                      pathname,
                      `/evaluations/${encodeURIComponent(leader.latestRunId)}`,
                    ) as Route;

                    return (
                      <RegressionLeaderRow
                        key={leader.skillId}
                        href={detailHref}
                        label={leader.skill}
                        failedCases={leader.failedCases}
                        maxFailedCases={regressionLeaders[0]?.failedCases ?? leader.failedCases}
                        last={index === regressionLeaders.length - 1}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function isRegressionLikeRun(run: EvaluationRunListItem) {
  return run.status === "complete-with-regressions" || run.status === "failed";
}

function buildRegressionLeaders(runs: EvaluationRunListItem[]): RegressionLeader[] {
  const thirtyDaysAgo = Date.now() - (1000 * 60 * 60 * 24 * 30);
  const leaders = new Map<string, RegressionLeader & { latestStartedAt: number | null }>();

  for (const run of runs) {
    if (!isRegressionLikeRun(run)) {
      continue;
    }

    const startedAtMs = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
    if (Number.isFinite(startedAtMs) && startedAtMs < thirtyDaysAgo) {
      continue;
    }

    const failedCases = Math.max(run.failed, run.status === "failed" ? 1 : 0);
    const current = leaders.get(run.skillId);

    if (!current) {
      leaders.set(run.skillId, {
        skillId: run.skillId,
        skill: run.skill,
        failedCases,
        latestRunId: run.id,
        latestStartedAt: Number.isFinite(startedAtMs) ? startedAtMs : null,
      });
      continue;
    }

    current.failedCases += failedCases;

    if (current.latestStartedAt == null || (Number.isFinite(startedAtMs) && startedAtMs >= current.latestStartedAt)) {
      current.latestRunId = run.id;
      current.latestStartedAt = Number.isFinite(startedAtMs) ? startedAtMs : current.latestStartedAt;
    }
  }

  return [...leaders.values()]
    .sort((left, right) => right.failedCases - left.failedCases || left.skill.localeCompare(right.skill))
    .slice(0, 5)
    .map((leader) => ({
      skillId: leader.skillId,
      skill: leader.skill,
      failedCases: leader.failedCases,
      latestRunId: leader.latestRunId,
    }));
}

function renderEvaluationStatusChip(run: EvaluationRunListItem) {
  if (run.status === "running") {
    return (
      <span className="chip chip-brass">
        <RunningDot />
        running
      </span>
    );
  }

  if (run.status === "complete-with-regressions") {
    return (
      <span className="chip chip-blood">
        <Ic.Warn style={{ width: 10, height: 10 }} />
        {run.failed} regressions
      </span>
    );
  }

  if (run.status === "failed") {
    return (
      <span className="chip chip-blood">
        <Ic.Warn style={{ width: 10, height: 10 }} />
        failed
      </span>
    );
  }

  if (run.status === "complete-baseline") {
    return <span className="chip chip-paper">baseline set</span>;
  }

  return (
    <span className="chip chip-moss">
      <Ic.Check style={{ width: 10, height: 10 }} />
      passed
    </span>
  );
}

function formatMetricValue(metric: EvaluationDashboardMetric) {
  const decimals = metric.displayDecimals ?? (Number.isInteger(metric.value) ? 0 : 1);
  const formattedNumber = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(metric.value);

  if (!metric.unit) {
    return formattedNumber;
  }

  return (
    <>
      {formattedNumber}
      <span style={{ fontSize: 16, color: "var(--muted)" }}>{metric.unit}</span>
    </>
  );
}

function formatRunIdentifier(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id.slice(0, 8)
    : id;
}

function CoverageBar({ item }: { item: EvaluationTierCoverageItem }) {
  return (
    <div className="bar">
      <div className="bar-label row" style={{ gap: 6 }}>
        <span className={`tier tier-${item.tier}`}>T{item.tier}</span>
        <span style={{ fontSize: 12.5 }}>Tier {item.tier}</span>
        <span className="subtle mono" style={{ fontSize: 11 }}>
          {item.evaluatedSkills}/{item.totalSkills}
        </span>
      </div>
      <div className="bar-track">
        <div className={`bar-fill ${item.coveragePct < 80 ? "warn" : ""}`} style={{ width: `${item.coveragePct}%` }} />
      </div>
      <div className="bar-value">
        {item.coveragePct}
        <span className="muted" style={{ fontSize: 10.5, marginLeft: 2 }}>
          %
        </span>
      </div>
    </div>
  );
}

function RegressionLeaderRow({
  href,
  label,
  failedCases,
  maxFailedCases,
  last,
}: {
  href: Route;
  label: string;
  failedCases: number;
  maxFailedCases: number;
  last?: boolean;
}) {
  const pct = maxFailedCases > 0 ? (failedCases / maxFailedCases) * 100 : 0;

  return (
    <div style={{ padding: "8px 0", borderBottom: last ? 0 : "1px solid var(--rule)" }}>
      <div className="row between" style={{ marginBottom: 5 }}>
        <Link href={href} style={{ fontSize: 12.5, color: "var(--ink-2)", textDecoration: "none" }}>
          {label}
        </Link>
        <span className="mono num subtle" style={{ fontSize: 11.5 }}>
          {failedCases}
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
