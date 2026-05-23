"use client";

import type {
  AuditCategory,
  AuditEventRange,
  AuditEventRecord,
} from "@savant/types";
import { useEffect, useMemo, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { fetchAuditEvents } from "@/lib/control-plane-client";

type Cat = "all" | AuditCategory;
type Range = AuditEventRange;

const CATEGORIES: { id: Cat; label: string }[] = [
  { id: "all", label: "All events" },
  { id: "approval", label: "Approvals" },
  { id: "release", label: "Releases" },
  { id: "evaluation", label: "Evaluations" },
  { id: "access", label: "Access" },
  { id: "version", label: "Versions" },
  { id: "policy", label: "Policies" },
  { id: "repo", label: "Repositories" },
  { id: "review", label: "Reviews" },
];

const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "all", label: "All time" },
];

export function AuditScreen() {
  const [cat, setCat] = useState<Cat>("all");
  const [range, setRange] = useState<Range>("7d");
  const [query, setQuery] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadEvents() {
      setStatus("loading");
      setError(null);

      try {
        const response = await fetchAuditEvents({ range }, { signal: controller.signal });

        if (active) {
          setEvents(response.data);
          setStatus("success");
        }
      } catch (loadError) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Could not load audit events.");
      }
    }

    void loadEvents();

    return () => {
      active = false;
      controller.abort();
    };
  }, [range, reloadToken]);

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (cat !== "all" && e.category !== cat) return false;
        if (query && !(e.who + e.action + e.target).toLowerCase().includes(query.toLowerCase()))
          return false;
        if (actorQuery && !e.who.toLowerCase().includes(actorQuery.toLowerCase()))
          return false;
        return true;
      }),
    [actorQuery, cat, events, query],
  );

  const groups = useMemo(() => {
    const grouped = new Map<string, AuditEventRecord[]>();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    for (const event of filtered) {
      const occurredAt = new Date(event.occurredAt);
      const key = occurredAt >= startOfToday
        ? "Today"
        : occurredAt >= startOfYesterday
          ? "Yesterday"
          : "Earlier";

      const bucket = grouped.get(key) ?? [];
      bucket.push(event);
      grouped.set(key, bucket);
    }

    return Array.from(grouped.entries());
  }, [filtered]);

  const catCount = (id: Cat) =>
    id === "all" ? events.length : events.filter((e) => e.category === id).length;

  const retry = () => setReloadToken((value) => value + 1);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/07</span>
            <span className="sep">—</span>
            <span>Audit</span>
          </div>
          <h1 className="h-display">Audit log</h1>
          <div className="page-head-sub">
            Immutable record of every governance event — approvals, releases, access changes, and
            policy edits. Exportable for compliance review.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost">
            <Ic.ExternalLink className="b-icon" />
            Export CSV
          </button>
          <button type="button" className="btn btn-primary">
            <Ic.ExternalLink className="b-icon" />
            Stream to SIEM
          </button>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Category</div>
            </div>
            <div
              className="panel-bd"
              style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2 }}
            >
              {CATEGORIES.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className="row between"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 4,
                    background: cat === c.id ? "rgba(28,27,24,.06)" : "transparent",
                    fontSize: 12.5,
                    fontWeight: cat === c.id ? 500 : 450,
                    color: cat === c.id ? "var(--ink)" : "var(--ink-3)",
                    cursor: "pointer",
                    transition: "background 100ms var(--ease)",
                  }}
                >
                  <span>{c.label}</span>
                  <span className="num subtle" style={{ fontSize: 11 }}>
                    {catCount(c.id)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Range</div>
            </div>
            <div
              className="panel-bd"
              style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2 }}
            >
              {RANGES.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 4,
                    background: range === r.id ? "rgba(28,27,24,.06)" : "transparent",
                    fontSize: 12.5,
                    fontWeight: range === r.id ? 500 : 450,
                    color: range === r.id ? "var(--ink)" : "var(--ink-3)",
                    cursor: "pointer",
                  }}
                >
                  {r.label}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Actor</div>
            </div>
            <div className="panel-bd" style={{ padding: "8px 10px" }}>
              <input
                value={actorQuery}
                onChange={(event) => setActorQuery(event.target.value)}
                placeholder="user@…"
                style={{
                  width: "100%",
                  height: 28,
                  padding: "0 10px",
                  border: "1px solid var(--rule-2)",
                  borderRadius: 4,
                  fontSize: 12,
                  outline: "none",
                  background: "var(--panel)",
                }}
              />
            </div>
          </div>

          <div className="note">
            <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
            <span style={{ fontSize: 11.5 }}>
              Audit events are immutable and retained for 7 years.
            </span>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="row" style={{ gap: 10 }}>
              <div className="panel-title">Events</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>
                {filtered.length} matching
              </span>
              {status === "loading" ? (
                <span className="subtle" style={{ fontSize: 11.5 }}>
                  refreshing…
                </span>
              ) : null}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <div style={{ position: "relative" }}>
                <Ic.Search
                  style={{
                    width: 11,
                    height: 11,
                    color: "var(--subtle)",
                    position: "absolute",
                    left: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search in events…"
                  style={{
                    height: 26,
                    padding: "0 10px 0 24px",
                    fontSize: 12,
                    border: "1px solid var(--rule-2)",
                    borderRadius: 4,
                    background: "var(--panel)",
                    width: 200,
                    outline: "none",
                  }}
                />
              </div>
            </div>
          </div>
          <div className="panel-bd" style={{ padding: 0 }}>
            {status === "loading" && events.length === 0 ? (
              <div className="panel-bd">
                <div className="note">
                  <Ic.Spinner className="n-icon" />
                  <span>Loading audit events from the tenant control plane…</span>
                </div>
              </div>
            ) : status === "error" && events.length === 0 ? (
              <div className="panel-bd">
                <div className="note blood" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <Ic.XCircle className="n-icon" />
                    <span>{error ?? "Could not load audit events."}</span>
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
                  <span>No audit events match the current filters.</span>
                </div>
              </div>
            ) : (
              groups.map(([groupLabel, groupEvents], groupIndex) => (
                <div key={groupLabel}>
                  <div
                    style={{
                      padding: "10px 20px",
                      background: "var(--linen)",
                      borderBottom: "1px solid var(--rule)",
                      borderTop: groupIndex === 0 ? "none" : "1px solid var(--rule)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span className="eyebrow" style={{ fontSize: 10 }}>
                      {groupLabel}
                    </span>
                    <span className="subtle num mono" style={{ fontSize: 10.5 }}>
                      {groupEvents.length} events
                    </span>
                  </div>
                  <div className="audit-events">
                    {groupEvents.map((event, index) => (
                      <div
                        key={`${event.occurredAt}:${event.action}:${event.target}:${index}`}
                        className="audit-event"
                      >
                        <div className="audit-time">
                          <span className="mono num" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                            {event.time}
                          </span>
                          <span className="subtle" style={{ fontSize: 11 }}>
                            {event.when}
                          </span>
                        </div>
                        <div className={`audit-node tl-node ${event.node}`} />
                        <div>
                          <div style={{ fontSize: 13, color: "var(--ink)" }}>
                            <b style={{ fontWeight: 500 }}>{event.who}</b>{" "}
                            <span className="muted">{event.action.toLowerCase()}</span> {event.target}
                          </div>
                        </div>
                        <span className="chip chip-paper" style={{ marginLeft: "auto" }}>
                          {event.category}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
