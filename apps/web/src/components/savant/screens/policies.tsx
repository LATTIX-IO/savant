"use client";

import type {
  PolicyActivityRecord,
  PolicySummary,
  PolicyType,
} from "@savant/types";
import { useEffect, useMemo, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { Facet } from "@/components/savant/primitives";
import { fetchPolicies } from "@/lib/control-plane-client";

type Filter = "all" | PolicyType;

export function PoliciesScreen() {
  const [selId, setSelId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<Filter>("all");
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadPolicies() {
      setStatus("loading");
      setError(null);

      try {
        const response = await fetchPolicies({ signal: controller.signal });

        if (active) {
          setPolicies(response.data);
          setStatus("success");
        }
      } catch (loadError) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Could not load policies.");
      }
    }

    void loadPolicies();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken]);

  const filtered = useMemo(
    () => typeFilter === "all" ? policies : policies.filter((policy) => policy.type === typeFilter),
    [policies, typeFilter],
  );

  const sel = useMemo(
    () => filtered.find((policy) => policy.id === selId) ?? filtered[0] ?? null,
    [filtered, selId],
  );

  const typeCount = (t: PolicyType) => policies.filter((policy) => policy.type === t).length;
  const retry = () => setReloadToken((value) => value + 1);
  const initialLoading = status === "loading" && policies.length === 0;
  const showTransientError = status === "error" && policies.length > 0;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/06</span>
            <span className="sep">—</span>
            <span>Policies</span>
          </div>
          <h1 className="h-display">Governance policies</h1>
          <div className="page-head-sub">
            Codified rules for access, approvals, distribution, and environment promotion. This
            surface now reflects the tenant control plane and stays read-only until policy write
            APIs land.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled
            title="Policy templates become available once policy write flows are live."
            style={{ opacity: 0.6, cursor: "not-allowed" }}
          >
            Policy templates
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="Policy creation is read-only in the current beta."
            style={{ opacity: 0.6, cursor: "not-allowed" }}
          >
            <Ic.Plus className="b-icon" />
            New policy
          </button>
        </div>
      </div>

      <div className="split wide" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
        <div className="col" style={{ gap: 0 }}>
          <div className="filterbar">
            <Facet active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
              All <span className="f-count">{policies.length}</span>
            </Facet>
            <Facet active={typeFilter === "access"} onClick={() => setTypeFilter("access")}>
              Access <span className="f-count">{typeCount("access")}</span>
            </Facet>
            <Facet active={typeFilter === "approval"} onClick={() => setTypeFilter("approval")}>
              Approval <span className="f-count">{typeCount("approval")}</span>
            </Facet>
            <Facet active={typeFilter === "distribution"} onClick={() => setTypeFilter("distribution")}>
              Distribution <span className="f-count">{typeCount("distribution")}</span>
            </Facet>
            <Facet active={typeFilter === "environment"} onClick={() => setTypeFilter("environment")}>
              Environment <span className="f-count">{typeCount("environment")}</span>
            </Facet>
            <div className="grow" />
            <button type="button" className="btn btn-sm">
              <Ic.Sort className="b-icon" />
              Sort: last updated
            </button>
          </div>

          <div className="panel" style={{ borderRadius: "0 0 6px 6px", borderTop: 0 }}>
            <div className="panel-bd" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
              {showTransientError ? (
                <div className="panel-bd" style={{ paddingBottom: 0 }}>
                  <div className="note blood" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <Ic.XCircle className="n-icon" />
                      <span>{error ?? "Could not refresh policies."}</span>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
                      Retry
                    </button>
                  </div>
                </div>
              ) : null}

              {initialLoading ? (
                <div className="panel-bd">
                  <div className="note">
                    <Ic.Spinner className="n-icon" />
                    <span>Loading policies from the tenant control plane…</span>
                  </div>
                </div>
              ) : status === "error" && policies.length === 0 ? (
                <div className="panel-bd">
                  <div className="note blood" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <Ic.XCircle className="n-icon" />
                      <span>{error ?? "Could not load policies."}</span>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
                      Retry
                    </button>
                  </div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="panel-bd">
                  <div className="note brass">
                    <Ic.Warn className="n-icon" />
                    <span>
                      {policies.length === 0
                        ? "No live policies are stored for this workspace yet."
                        : "No policies match the current type filter."}
                    </span>
                  </div>
                </div>
              ) : (
                filtered.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSelId(p.id)}
                    style={{
                      padding: "16px 20px",
                      borderBottom: "1px solid var(--rule)",
                      background: p.id === sel?.id ? "var(--moss-soft)" : "transparent",
                      cursor: "pointer",
                      position: "relative",
                      transition: "background 100ms var(--ease)",
                    }}
                  >
                    {p.id === sel?.id ? (
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 16,
                          bottom: 16,
                          width: 2,
                          background: "var(--moss)",
                          borderRadius: 2,
                        }}
                      />
                    ) : null}
                    <div
                      className="row between"
                      style={{ alignItems: "flex-start", marginBottom: 6 }}
                    >
                      <div
                        className="row"
                        style={{ gap: 10, minWidth: 0, alignItems: "center" }}
                      >
                        <PolicyTypeChip type={p.type} />
                        <span className="skill-name" style={{ fontSize: 13.5 }}>
                          {p.name}
                        </span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        {p.state === "draft" ? (
                          <span className="chip chip-brass">draft</span>
                        ) : (
                          <span className="chip chip-moss">
                            <span className="dot" />
                            active
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                      {p.scope}
                    </div>
                    <div className="row" style={{ gap: 16, fontSize: 11.5 }}>
                      <span>
                        <span className="subtle">Targets</span>{" "}
                        <span className="num" style={{ color: "var(--ink-2)" }}>
                          {p.affects}
                        </span>
                      </span>
                      <span>
                        <span className="subtle">Updated by</span>{" "}
                        <span style={{ color: "var(--ink-2)" }}>{p.appliedBy}</span>
                      </span>
                      <span style={{ marginLeft: "auto" }} className="subtle">
                        Updated {p.updated}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="panel" style={{ position: "sticky", top: 0 }}>
          {sel ? (
            <>
              <div className="panel-hd">
                <div className="row" style={{ gap: 8 }}>
                  <PolicyTypeChip type={sel.type} />
                  <span
                    className="panel-title"
                    style={{ textTransform: "none", letterSpacing: 0, fontSize: 13 }}
                  >
                    {sel.name}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled
                  title="Policy editing is read-only until mutation endpoints land."
                  style={{ opacity: 0.6, cursor: "not-allowed" }}
                >
                  Read only
                </button>
              </div>
              <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>
                    Scope
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{sel.scope}</div>
                </div>

                <div className="row" style={{ gap: 24 }}>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 2 }}>
                      State
                    </div>
                    {sel.state === "draft" ? (
                      <span className="chip chip-brass">draft</span>
                    ) : (
                      <span className="chip chip-moss">
                        <span className="dot" />
                        active
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 2 }}>
                      Targets
                    </div>
                    <div className="mono num" style={{ fontSize: 13 }}>
                      {sel.affects}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 2 }}>
                      Updated by
                    </div>
                    <div style={{ fontSize: 13 }}>{sel.appliedBy}</div>
                  </div>
                </div>

                <div className="divider" />

                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>
                    Rules
                  </div>
                  {sel.rules.length > 0 ? (
                    <div className="col" style={{ gap: 8 }}>
                      {sel.rules.map((rule, index) => (
                        <div
                          key={`${rule.rule}-${index}`}
                          style={{
                            padding: "10px 12px",
                            border: "1px solid var(--rule)",
                            borderRadius: 4,
                            background: "var(--linen)",
                          }}
                        >
                          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 3 }}>
                            {rule.rule}
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.4 }}>
                            {rule.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyPanelState message="No structured rules are attached to this policy yet." />
                  )}
                </div>

                <div className="divider" />

                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    Recent activity
                  </div>
                  {sel.recentActivity.length > 0 ? (
                    <div className="col" style={{ gap: 6 }}>
                      {sel.recentActivity.map((activity, index) => (
                        <PolicyActivityLine
                          key={`${activity.occurredAt}:${activity.action}:${index}`}
                          activity={activity}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyPanelState message="No live policy activity has been recorded for this policy yet." />
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="panel-bd">
              <EmptyPanelState message="Choose a policy to inspect its live rules and recent activity." />
            </div>
          )}
        </div>
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
        <span style={{ fontSize: 11.5 }}>
          Policy editing stays disabled until the live governance write path is implemented.
        </span>
      </div>
    </div>
  );
}

function PolicyTypeChip({ type }: { type: PolicyType }) {
  const map: Record<PolicyType, { cls: string; label: string }> = {
    access: { cls: "chip chip-slate", label: "access" },
    approval: { cls: "chip chip-brass", label: "approval" },
    distribution: { cls: "chip chip-moss", label: "distribution" },
    environment: { cls: "chip chip-paper", label: "environment" },
  };
  const c = map[type] || map.access;
  return <span className={c.cls}>{c.label}</span>;
}

function PolicyActivityLine({ activity }: { activity: PolicyActivityRecord }) {
  const chipClass = activity.status === "blocked"
    ? "chip chip-blood"
    : activity.status === "allowed"
      ? "chip chip-moss"
      : "chip chip-paper";

  return (
    <div className="row" style={{ gap: 10, fontSize: 12, padding: "5px 0" }}>
      <span className="mono subtle" style={{ width: 70 }}>
        {activity.when}
      </span>
      <span className={chipClass} style={{ minWidth: 72, justifyContent: "center" }}>
        {activity.action.toLowerCase()}
      </span>
      <span style={{ color: "var(--ink-2)", minWidth: 0 }}>
        <b style={{ fontWeight: 500 }}>{activity.who}</b> · {activity.detail}
      </span>
    </div>
  );
}

function EmptyPanelState({ message }: { message: string }) {
  return (
    <div className="note">
      <Ic.Warn className="n-icon" />
      <span>{message}</span>
    </div>
  );
}
