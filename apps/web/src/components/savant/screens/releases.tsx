"use client";

import type {
  ReleaseDashboardMetric,
  ReleaseDashboardPayload,
  ReleaseHistoryItem,
  ReleaseQueueItem,
} from "@savant/types";
import { useEffect, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { CommitRef, EnvPill } from "@/components/savant/primitives";
import { fetchReleaseDashboard } from "@/lib/control-plane-client";
import {
  buildReleaseApprovalVisuals,
  buildReleaseStageVisuals,
  findReleaseBundleSignal,
  normalizeReleaseProgress,
  summarizeReleaseReadiness,
  type ReleaseReadinessState,
} from "@/lib/release-flow";

export function ReleasesScreen() {
  const [dashboard, setDashboard] = useState<ReleaseDashboardPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadDashboard() {
      setStatus("loading");
      setError(null);

      try {
        const response = await fetchReleaseDashboard({ signal: controller.signal });

        if (active) {
          setDashboard(response.data);
          setStatus("success");
        }
      } catch (loadError) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Could not load releases.");
      }
    }

    void loadDashboard();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken]);

  const retry = () => setReloadToken((value) => value + 1);
  const kpis = dashboard?.kpis ?? [];
  const inMotion = dashboard?.inMotion ?? [];
  const history = dashboard?.history ?? [];
  const initialLoading = status === "loading" && dashboard === null;
  const showTransientError = status === "error" && dashboard !== null;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/05</span>
            <span className="sep">—</span>
            <span>Releases</span>
          </div>
          <h1 className="h-display">Release dashboard</h1>
          <div className="page-head-sub">
            Promote candidates through draft, staging, and production. Rollback is always one click
            away — but this screen now reflects the tenant control plane and remains read-only
            until release mutation endpoints land.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip chip-paper">Policy-driven promotions</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="Release creation is read-only until live promotion endpoints exist."
            style={{ opacity: 0.6, cursor: "not-allowed" }}
          >
            <Ic.Plus className="b-icon" />
            New release
          </button>
        </div>
      </div>

      {showTransientError ? (
        <div className="note blood" style={{ marginBottom: 16, justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <Ic.XCircle className="n-icon" />
            <span>{error ?? "Could not refresh releases."}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
            Retry
          </button>
        </div>
      ) : null}

      {initialLoading ? (
        <div className="panel">
          <div className="panel-bd">
            <div className="note">
              <Ic.Spinner className="n-icon" />
              <span>Loading release state from the tenant control plane…</span>
            </div>
          </div>
        </div>
      ) : status === "error" && dashboard === null ? (
        <div className="panel">
          <div className="panel-bd">
            <div className="note blood" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <Ic.XCircle className="n-icon" />
                <span>{error ?? "Could not load releases."}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="kpi-strip" style={{ marginBottom: 24 }}>
            {kpis.map((metric) => (
              <ReleaseMetricCard key={metric.key} metric={metric} />
            ))}
          </div>

          <div className="eyebrow" style={{ marginBottom: 10 }}>
            In motion · {inMotion.length}
          </div>
          {inMotion.length > 0 ? (
            <div className="col" style={{ gap: 14, marginBottom: 32 }}>
              {inMotion.map((release) => (
                <ReleaseCard key={release.id} release={release} />
              ))}
            </div>
          ) : (
            <div className="panel" style={{ marginBottom: 32 }}>
              <div className="panel-bd">
                <div className="note brass">
                  <Ic.Warn className="n-icon" />
                  <span>No release promotions are currently in motion for this workspace.</span>
                </div>
              </div>
            </div>
          )}

          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Recent history
          </div>
          <div className="panel">
            {history.length > 0 ? (
              <div className="panel-bd tight">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Skill</th>
                      <th>Version</th>
                      <th>Environment</th>
                      <th>Released by</th>
                      <th>Outcome</th>
                      <th style={{ textAlign: "right" }}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item, index) => (
                      <ReleaseHistoryRowView key={`${item.ref}:${item.skill}:${index}`} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel-bd">
                <div className="note brass">
                  <Ic.Warn className="n-icon" />
                  <span>No release history is indexed for this workspace yet.</span>
                </div>
              </div>
            )}
          </div>

          <div className="note" style={{ marginTop: 16 }}>
            <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
            <span style={{ fontSize: 11.5 }}>
              Promotion and rollback actions stay disabled until the live release mutation path is implemented.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ReleaseCard({ release }: { release: ReleaseQueueItem }) {
  const readiness = summarizeReleaseReadiness(release.readiness, release.readinessPct);
  const progress = normalizeReleaseProgress(release.readinessPct);
  const stageVisuals = buildReleaseStageVisuals(release);
  const approvalVisuals = buildReleaseApprovalVisuals(release);
  const bundleSignal = findReleaseBundleSignal(release.readiness);
  const blocked = release.approvalsBlocked !== null || readiness.blockedCount > 0;
  const ready = progress === 1 && readiness.pendingCount === 0 && readiness.blockedCount === 0;
  const bundleState: ReleaseReadinessState = bundleSignal?.state ?? (ready ? "passed" : "pending");
  const bundleLabel = bundleState === "passed"
    ? "built"
    : bundleState === "blocked"
      ? "blocked"
      : "awaiting";
  const statusChipClass = blocked
    ? "chip chip-blood"
    : ready
      ? "chip chip-moss"
      : "chip chip-paper";
  const statusChipLabel = blocked ? "blocked" : ready ? "ready" : "pending";

  return (
    <div className="panel">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
          gap: 0,
        }}
      >
        <div style={{ padding: 18, borderRight: "1px solid var(--rule)" }}>
          <div
            className="row between"
            style={{ marginBottom: 14, alignItems: "flex-start", gap: 12 }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                <span className="skill-name" style={{ fontSize: 15 }}>
                  {release.skill}
                </span>
                <CommitRef commit={release.candidateCommit} label={release.candidateRef} />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Submitted by {release.requested} · {release.when}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className={statusChipClass}>{statusChipLabel}</span>
              <button
                type="button"
                className="btn btn-sm"
                disabled
                title="Release actions are read-only until live promotion endpoints exist."
                style={{ opacity: 0.6, cursor: "not-allowed" }}
              >
                Read only
              </button>
            </div>
          </div>

          <div className="release-flow" aria-label={`${release.skill} release path`}>
            <div className="release-flow-track" aria-hidden="true" />
            {stageVisuals.map((stage) => (
              <div key={stage.stage} className={`release-stage-card release-stage-${stage.state}`}>
                <span className="release-stage-status">{stage.statusLabel}</span>
                <span className="release-stage-name">{stage.stage}</span>
                <span className="release-stage-meta">{stage.meta}</span>
              </div>
            ))}
          </div>

          <div className="release-signal-grid">
            <div className="release-signal-card">
              <div className="row between" style={{ marginBottom: 8 }}>
                <div className="eyebrow" style={{ fontSize: 10 }}>
                  Readiness
                </div>
                <span className="mono num subtle" style={{ fontSize: 11.5 }}>
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="release-readiness-bar" aria-hidden="true">
                {(readiness.segments.length > 0
                  ? readiness.segments
                  : [{ label: "No checks yet", meta: "", state: "pending" as const }]).map((segment) => (
                    <span
                      key={segment.label}
                      className={`release-readiness-segment release-readiness-${segment.state}`}
                    />
                ))}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <span className="chip chip-moss">{readiness.passedCount} passing</span>
                <span className="chip chip-paper">{readiness.pendingCount} pending</span>
                {readiness.blockedCount > 0 ? (
                  <span className="chip chip-blood">{readiness.blockedCount} blocked</span>
                ) : null}
              </div>
            </div>

            <div className="release-signal-card">
              <div className="row between" style={{ marginBottom: 8 }}>
                <div className="eyebrow" style={{ fontSize: 10 }}>
                  Promotion route
                </div>
                <span className="mono num subtle" style={{ fontSize: 11.5 }}>
                  {release.targets.length} targets
                </span>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {release.targets.map((target) => (
                  <span key={target} className="chip chip-paper">
                    <Ic.Connectors style={{ width: 10, height: 10 }} />
                    {target}
                  </span>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                {release.fromEnv} → {release.toEnv} promotion fans out to the configured runtime targets once live mutation endpoints are enabled.
              </div>
            </div>
          </div>

          <div>
            <div className="row between" style={{ marginBottom: 8 }}>
              <div className="eyebrow" style={{ fontSize: 10 }}>
                Live checks
              </div>
              <span className="mono num subtle" style={{ fontSize: 11.5 }}>
                {readiness.total}
              </span>
            </div>
            <div className="col" style={{ gap: 0 }}>
              {release.readiness.map((check, index) => (
                <div
                  key={check.label}
                  className="row"
                  style={{
                    padding: "6px 0",
                    borderBottom: index < release.readiness.length - 1 ? "1px solid var(--rule)" : "none",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      color:
                        check.ok === true
                          ? "var(--moss)"
                          : check.ok === false
                            ? "var(--oxblood)"
                            : "var(--brass)",
                      width: 14,
                      height: 14,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {check.ok === true ? (
                      <Ic.CheckCircle style={{ width: 14, height: 14 }} />
                    ) : check.ok === false ? (
                      <Ic.XCircle style={{ width: 14, height: 14 }} />
                    ) : (
                      <Ic.Clock style={{ width: 14, height: 14 }} />
                    )}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{check.label}</span>
                  <span className="subtle" style={{ fontSize: 11.5, marginLeft: "auto" }}>
                    {check.meta}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: 18, background: "var(--linen)" }}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>
              Approvals
            </div>
            <span
              className="mono num"
              style={{
                fontSize: 12,
                color: release.approvalsDone === release.approvalsRequired ? "var(--moss)" : "var(--brass)",
              }}
            >
              {release.approvalsDone} / {release.approvalsRequired}
            </span>
          </div>

          <div className="col" style={{ gap: 8, marginBottom: 18 }}>
            {approvalVisuals.length > 0 ? (
              approvalVisuals.map((approval) => (
                <ApprovalLine
                  key={`${approval.label}-${approval.meta}`}
                  name={approval.label}
                  meta={approval.meta}
                  status={approval.state}
                />
              ))
            ) : (
              <div className="note brass">
                <Ic.Warn className="n-icon" />
                <span>No explicit approvals are configured for this promotion yet.</span>
              </div>
            )}
          </div>

          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>
            Distribution targets
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {release.targets.map((t) => (
              <span
                key={t}
                className="chip chip-paper"
                style={{ background: "var(--panel)" }}
              >
                <Ic.Connectors style={{ width: 10, height: 10 }} />
                {t}
              </span>
            ))}
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "10px 12px",
              border: "1px solid var(--rule)",
              borderRadius: 5,
              background: "var(--panel)",
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <Ic.Lock style={{ width: 12, height: 12, color: "var(--muted)" }} />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Signed bundle</span>
              <span className={`chip ${bundleState === "passed" ? "chip-moss" : bundleState === "blocked" ? "chip-blood" : "chip-paper"}`}>
                {bundleLabel}
              </span>
              <span
                className="mono num subtle"
                style={{ fontSize: 11, marginLeft: "auto" }}
              >
                {bundleSignal?.meta ?? `Commit ${release.candidateCommit.slice(0, 6)}…${release.candidateCommit.slice(-3)}`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalLine({
  name,
  meta,
  status,
}: {
  name: string;
  meta: string;
  status: ReleaseReadinessState;
}) {
  return (
    <div className="row" style={{ gap: 8 }}>
      {status === "passed" ? (
        <Ic.CheckCircle style={{ width: 14, height: 14, color: "var(--moss)" }} />
      ) : status === "blocked" ? (
        <Ic.XCircle style={{ width: 14, height: 14, color: "var(--oxblood)" }} />
      ) : (
        <Ic.Clock style={{ width: 14, height: 14, color: "var(--brass)" }} />
      )}
      <div className="col" style={{ gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12.5 }}>{name}</span>
        <span className="subtle" style={{ fontSize: 11.5 }}>{meta}</span>
      </div>
      <span className="subtle" style={{ fontSize: 11.5, marginLeft: "auto" }}>
        {status === "passed" ? "approved" : status === "blocked" ? "blocked" : "pending"}
      </span>
    </div>
  );
}

function ReleaseMetricCard({ metric }: { metric: ReleaseDashboardMetric }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{metric.label}</div>
      <div className="kpi-value num">
        {metric.value == null
          ? "—"
          : metric.displayDecimals != null
            ? metric.value.toFixed(metric.displayDecimals)
            : Intl.NumberFormat("en-US").format(metric.value)}
        {metric.unit ? <span style={{ fontSize: 16, color: "var(--muted)" }}>{metric.unit}</span> : null}
      </div>
      <div className={metric.trend === "flat" ? "kpi-trend" : `kpi-trend ${metric.trend}`}>
        {metric.trendLabel}
      </div>
    </div>
  );
}

function ReleaseHistoryRowView({ item }: { item: ReleaseHistoryItem }) {
  return (
    <tr>
      <td>
        <span className="skill-name">{item.skill}</span>
      </td>
      <td>
        <span className="mono num" style={{ color: "var(--ink)" }}>
          {item.ref}
        </span>
      </td>
      <td>
        <EnvPill env={item.env} />
      </td>
      <td className="muted">{item.who}</td>
      <td>
        {item.outcome === "released" ? (
          <span className="chip chip-moss">
            <Ic.Check style={{ width: 10, height: 10 }} />
            released
          </span>
        ) : (
          <span className="chip chip-blood">
            <Ic.ArrowDown style={{ width: 10, height: 10 }} />
            rolled back
          </span>
        )}
      </td>
      <td className="subtle" style={{ textAlign: "right" }}>
        {item.when}
      </td>
    </tr>
  );
}
