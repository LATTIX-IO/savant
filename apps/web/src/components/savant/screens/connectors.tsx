"use client";

import type {
  ConnectorCategory,
  ConnectorDashboardMetric,
  ConnectorDashboardPayload,
  ConnectorRecord,
  ConnectorStatus,
} from "@savant/types";
import { useEffect, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { fetchConnectorDashboard } from "@/lib/control-plane-client";
import { POSSIBLE_CONNECTORS } from "@/lib/savant-data";

export function ConnectorsScreen() {
  const [dashboard, setDashboard] = useState<ConnectorDashboardPayload | null>(null);
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
        const response = await fetchConnectorDashboard({ signal: controller.signal });

        if (active) {
          setDashboard(response.data);
          setStatus("success");
        }
      } catch (loadError) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Could not load connectors.");
      }
    }

    void loadDashboard();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken]);

  const retry = () => setReloadToken((value) => value + 1);
  const connectors = dashboard?.connectors ?? [];
  const kpis = dashboard?.kpis ?? [];
  const local = connectors.filter((connector) => connector.category === "local");
  const native = connectors.filter((connector) => connector.category === "native");
  const notify = connectors.filter((connector) => connector.category === "notify");
  const bundle = connectors.filter((connector) => connector.category === "bundle");
  const initialLoading = status === "loading" && dashboard === null;
  const showTransientError = status === "error" && dashboard !== null;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/08</span>
            <span className="sep">—</span>
            <span>Connectors</span>
          </div>
          <h1 className="h-display">Distribution</h1>
          <div className="page-head-sub">
            Approved skills are distributed to downstream tools through three modes — managed sync
            agents for local environments, native integrations, and signed bundle exports for
            restricted contexts. This screen now reflects live connector inventory and stays
            read-only until connector mutation flows land.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost">
            <Ic.ExternalLink className="b-icon" />
            Distribution guide
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="Connector install and enable flows are read-only until live mutations exist."
            style={{ opacity: 0.6, cursor: "not-allowed" }}
          >
            <Ic.Plus className="b-icon" />
            Add connector
          </button>
        </div>
      </div>

      {showTransientError ? (
        <div className="note blood" style={{ marginBottom: 16, justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <Ic.XCircle className="n-icon" />
            <span>{error ?? "Could not refresh connectors."}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
            Retry
          </button>
        </div>
      ) : null}

      {initialLoading ? (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-bd">
            <div className="note">
              <Ic.Spinner className="n-icon" />
              <span>Loading connector inventory from the tenant control plane…</span>
            </div>
          </div>
        </div>
      ) : status === "error" && dashboard === null ? (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-bd">
            <div className="note blood" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <Ic.XCircle className="n-icon" />
                <span>{error ?? "Could not load connectors."}</span>
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
              <ConnectorMetricCard key={metric.key} metric={metric} />
            ))}
          </div>

          <ConnectorSection
            eyebrow="Local sync agents"
            sub="Managed agents that authenticate to Savant and pull approved skills into local developer environments."
            category="local"
            connectors={local}
          />
          <ConnectorSection
            eyebrow="Native integrations"
            sub="Direct push to systems that accept Savant releases natively."
            category="native"
            connectors={native}
          />
          <ConnectorSection
            eyebrow="Notifications"
            sub="Release events, approval requests, and rollbacks are surfaced where teams already work."
            category="notify"
            connectors={notify}
          />
          <ConnectorSection
            eyebrow="Bundle export"
            sub="Signed bundles for air-gapped customer environments and manual enterprise workflows."
            category="bundle"
            connectors={bundle}
          />

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Available connectors</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>
                Not yet enabled
              </span>
            </div>
            <div className="panel-bd">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 8,
                }}
              >
                {POSSIBLE_CONNECTORS.map((name) => (
                  <div
                    key={name}
                    style={{
                      padding: "10px 12px",
                      border: "1px dashed var(--rule-2)",
                      borderRadius: 5,
                      background: "var(--linen)",
                      fontSize: 12.5,
                      color: "var(--ink-3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{name}</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled
                      title="Connector enablement is read-only until live install flows exist."
                      style={{ height: 22, padding: "0 7px", fontSize: 11, opacity: 0.6, cursor: "not-allowed" }}
                    >
                      Enable
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="note" style={{ marginTop: 16 }}>
            <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
            <span style={{ fontSize: 11.5 }}>
              Connector install, configuration, and log actions stay disabled until the live mutation and log endpoints are implemented.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ConnectorSection({
  eyebrow,
  sub,
  category,
  connectors,
}: {
  eyebrow: string;
  sub: string;
  category: ConnectorCategory;
  connectors: ConnectorRecord[];
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div className="row between" style={{ marginBottom: 10, alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {eyebrow}
          </div>
          <div className="muted" style={{ fontSize: 12.5, maxWidth: 640 }}>
            {sub}
          </div>
        </div>
        <span className="subtle" style={{ fontSize: 11.5 }}>
          {connectors.length} configured
        </span>
      </div>

      {connectors.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {connectors.map((connector) => (
            <ConnectorCard key={connector.id} connector={connector} />
          ))}
        </div>
      ) : (
        <div className="panel">
          <div className="panel-bd">
            <div className="note brass">
              <Ic.Warn className="n-icon" />
              <span>No {category} connectors are configured for this workspace yet.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectorCard({ connector }: { connector: ConnectorRecord }) {
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ padding: 16, borderBottom: "1px solid var(--rule)" }}>
        <div className="row between" style={{ alignItems: "flex-start", marginBottom: 8 }}>
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <div className="skill-name" style={{ fontSize: 14 }}>
              {connector.name}
            </div>
            <div className="muted mono" style={{ fontSize: 11 }}>
              {connector.kind}
            </div>
          </div>
          <ConnectorStatusChip status={connector.status} />
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
          {connector.scope}
        </div>
      </div>
      <div
        style={{
          padding: "12px 16px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 16px",
        }}
      >
        <ConnStat label="Skills" value={connector.skills} />
        <ConnStat label="Users" value={connector.users} />
        <ConnStat label="Version" value={connector.version} />
        <ConnStat label="Last sync" value={connector.lastSync} />
      </div>
      <div
        style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--rule)",
          background: "var(--linen)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          className="btn btn-sm"
          disabled
          style={{ background: "transparent", border: 0, padding: 0, color: "var(--ink-3)", opacity: 0.6, cursor: "not-allowed" }}
        >
          Configure
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled
          style={{ background: "transparent", border: 0, padding: 0, color: "var(--muted)", opacity: 0.6, cursor: "not-allowed" }}
        >
          <Ic.ExternalLink className="b-icon" />
          Logs
        </button>
      </div>
    </div>
  );
}

function ConnectorStatusChip({ status }: { status: ConnectorStatus }) {
  if (status === "healthy")
    return (
      <span className="chip chip-moss">
        <span className="dot" />
        healthy
      </span>
    );
  if (status === "degraded")
    return (
      <span className="chip chip-brass">
        <Ic.Warn style={{ width: 10, height: 10 }} />
        degraded
      </span>
    );
  if (status === "warning")
    return (
      <span className="chip chip-brass">
        <span className="dot" />
        stale
      </span>
    );
  return (
    <span className="chip chip-blood">
      <Ic.XCircle style={{ width: 10, height: 10 }} />
      offline
    </span>
  );
}

function ConnStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <div className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div className="mono num" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
        {value === "—" ? <span className="subtle">—</span> : value}
      </div>
    </div>
  );
}

function ConnectorMetricCard({ metric }: { metric: ConnectorDashboardMetric }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{metric.label}</div>
      <div className="kpi-value num">{Intl.NumberFormat("en-US").format(metric.value)}</div>
      <div className={metric.trend === "flat" ? "kpi-trend" : `kpi-trend ${metric.trend}`}>
        {metric.trendLabel}
      </div>
    </div>
  );
}
