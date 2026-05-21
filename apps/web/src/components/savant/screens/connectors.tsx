"use client";

import { Ic } from "@/components/savant/icons";
import {
  CONNECTORS,
  POSSIBLE_CONNECTORS,
  type Connector,
} from "@/lib/savant-data";

export function ConnectorsScreen() {
  const local = CONNECTORS.filter((c) => c.category === "local");
  const native = CONNECTORS.filter((c) => c.category === "native");
  const notify = CONNECTORS.filter((c) => c.category === "notify");
  const bundle = CONNECTORS.filter((c) => c.category === "bundle");

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
            restricted contexts.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost">
            <Ic.ExternalLink className="b-icon" />
            Distribution guide
          </button>
          <button type="button" className="btn btn-primary">
            <Ic.Plus className="b-icon" />
            Add connector
          </button>
        </div>
      </div>

      <div className="kpi-strip" style={{ marginBottom: 24 }}>
        <div className="kpi">
          <div className="kpi-label">Active connectors</div>
          <div className="kpi-value num">
            {CONNECTORS.filter((c) => c.status !== "warning").length}
          </div>
          <div className="kpi-trend">{CONNECTORS.length} total</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Agents deployed</div>
          <div className="kpi-value num">559</div>
          <div className="kpi-trend up">▲ 38 this week</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Distributions · 24h</div>
          <div className="kpi-value num">
            2.1<span style={{ fontSize: 16, color: "var(--muted)" }}>k</span>
          </div>
          <div className="kpi-trend up">↑ wh/skills</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Issues</div>
          <div className="kpi-value num" style={{ color: "var(--brass)" }}>
            {CONNECTORS.filter((c) => c.status !== "healthy").length}
          </div>
          <div className="kpi-trend">1 stale · 1 degraded</div>
        </div>
      </div>

      <ConnectorSection
        eyebrow="Local sync agents"
        sub="Managed agents that authenticate to Savant and pull approved skills into local developer environments."
        connectors={local}
      />
      <ConnectorSection
        eyebrow="Native integrations"
        sub="Direct push to systems that accept Savant releases natively."
        connectors={native}
      />
      <ConnectorSection
        eyebrow="Notifications"
        sub="Release events, approval requests, and rollbacks are surfaced where teams already work."
        connectors={notify}
      />
      <ConnectorSection
        eyebrow="Bundle export"
        sub="Signed bundles for air-gapped customer environments and manual enterprise workflows."
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
                  style={{ height: 22, padding: "0 7px", fontSize: 11 }}
                >
                  Enable
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectorSection({
  eyebrow,
  sub,
  connectors,
}: {
  eyebrow: string;
  sub: string;
  connectors: Connector[];
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
          {connectors.length} active
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {connectors.map((c) => (
          <ConnectorCard key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

function ConnectorCard({ c }: { c: Connector }) {
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ padding: 16, borderBottom: "1px solid var(--rule)" }}>
        <div className="row between" style={{ alignItems: "flex-start", marginBottom: 8 }}>
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <div className="skill-name" style={{ fontSize: 14 }}>
              {c.name}
            </div>
            <div className="muted mono" style={{ fontSize: 11 }}>
              {c.kind}
            </div>
          </div>
          <ConnectorStatusChip status={c.status} />
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
          {c.scope}
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
        <ConnStat label="Skills" value={c.skills} />
        <ConnStat label="Users" value={c.users} />
        <ConnStat label="Version" value={c.version} />
        <ConnStat label="Last sync" value={c.lastSync} />
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
          style={{ background: "transparent", border: 0, padding: 0, color: "var(--ink-3)" }}
        >
          Configure
        </button>
        <button
          type="button"
          className="btn btn-sm"
          style={{ background: "transparent", border: 0, padding: 0, color: "var(--muted)" }}
        >
          <Ic.ExternalLink className="b-icon" />
          Logs
        </button>
      </div>
    </div>
  );
}

function ConnectorStatusChip({ status }: { status: Connector["status"] }) {
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
