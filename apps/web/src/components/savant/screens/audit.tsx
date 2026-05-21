"use client";

import { useMemo, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { AUDIT_FULL, type AuditCategory, type AuditEvent } from "@/lib/savant-data";

type Cat = "all" | AuditCategory;
type Range = "24h" | "7d" | "30d" | "90d" | "all";

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

  const filtered = useMemo(
    () =>
      AUDIT_FULL.filter((e) => {
        if (cat !== "all" && e.category !== cat) return false;
        if (query && !(e.who + e.action + e.target).toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      }),
    [cat, query],
  );

  const groups: Record<string, AuditEvent[]> = {};
  filtered.forEach((e) => {
    const isToday =
      e.when.includes("m ago") ||
      e.when.includes("h ago") ||
      e.when === "Now" ||
      e.when === "5h ago" ||
      e.when === "6h ago" ||
      e.when === "9h ago";
    const key = isToday ? "Today" : e.when.includes("1d") ? "Yesterday" : "Earlier";
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  const catCount = (id: Cat) =>
    id === "all" ? AUDIT_FULL.length : AUDIT_FULL.filter((e) => e.category === id).length;

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
                    cursor: "default",
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
                    cursor: "default",
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
            {Object.keys(groups).map((g, gi) => {
              const events = groups[g] ?? [];
              return (
              <div key={g}>
                <div
                  style={{
                    padding: "10px 20px",
                    background: "var(--linen)",
                    borderBottom: "1px solid var(--rule)",
                    borderTop: gi === 0 ? "none" : "1px solid var(--rule)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span className="eyebrow" style={{ fontSize: 10 }}>
                    {g}
                  </span>
                  <span className="subtle num mono" style={{ fontSize: 10.5 }}>
                    {events.length} events
                  </span>
                </div>
                <div className="audit-events">
                  {events.map((e, i) => (
                    <div key={i} className="audit-event">
                      <div className="audit-time">
                        <span className="mono num" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {e.time}
                        </span>
                        <span className="subtle" style={{ fontSize: 11 }}>
                          {e.when}
                        </span>
                      </div>
                      <div className={`audit-node tl-node ${e.node}`} />
                      <div>
                        <div style={{ fontSize: 13, color: "var(--ink)" }}>
                          <b style={{ fontWeight: 500 }}>{e.who}</b>{" "}
                          <span className="muted">{e.action.toLowerCase()}</span> {e.target}
                        </div>
                      </div>
                      <span className="chip chip-paper" style={{ marginLeft: "auto" }}>
                        {e.category}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
