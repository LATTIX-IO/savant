"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";

import type {
  AutoOptimizationMode,
  ImprovementQueueItem,
  OptimizationAggressiveness,
  OptimizerProviderId,
  OrganizationIntelligencePayload,
  RetentionClass,
  SkillIntelligenceSettings,
  TelemetryCaptureMode,
} from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { Delta, Tier } from "@/components/savant/primitives";
import {
  createTelemetryIngestToken,
  fetchOrganizationIntelligence,
  updateSkillIntelligenceSettings,
} from "@/lib/control-plane-client";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";

const selectStyle: CSSProperties = {
  height: 30,
  padding: "0 10px",
  border: "1px solid var(--rule-2)",
  borderRadius: 4,
  fontSize: 12.5,
  background: "var(--panel)",
  color: "var(--ink)",
  minWidth: 180,
};

const PROVIDERS: Array<[OptimizerProviderId, string]> = [
  ["azure-openai", "Azure OpenAI"],
  ["openai-enterprise", "OpenAI Enterprise"],
  ["openai-public", "Public OpenAI API"],
  ["anthropic-enterprise", "Anthropic Enterprise"],
  ["anthropic-public", "Public Anthropic API"],
  ["local-approved", "Approved local endpoint"],
  ["local-unknown", "Local unknown endpoints"],
];

function Kpi({ label, value, unit, trend }: { label: string; value: string | number; unit?: string; trend?: string | undefined }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">
        {value}
        {unit ? <span style={{ fontSize: 16, color: "var(--muted)" }}>{unit}</span> : null}
      </div>
      {trend ? <div className="kpi-trend flat">{trend}</div> : null}
    </div>
  );
}

function QueueRow({ item, pathname }: { item: ImprovementQueueItem; pathname: string }) {
  const href = buildTenantAwareAppPath(pathname, `/skills/${encodeURIComponent(item.skillId)}`) as Route;
  return (
    <tr>
      <td>
        <Link href={href} className="tbl-name" style={{ color: "inherit" }}>
          <div className="tbl-name-text">
            <span className="pri">{item.skillName}</span>
            <span className="sec">{item.status} · {item.runCount.toLocaleString()} runs</span>
          </div>
        </Link>
      </td>
      <td><Tier n={item.skillTier} /></td>
      <td style={{ textAlign: "right" }}><Delta v={item.delta} /></td>
      <td>
        {item.validated
          ? <span className="chip chip-moss">validated</span>
          : <span className="chip chip-brass">predicted</span>}
      </td>
      <td className="subtle">{item.evidenceStrength}</td>
      <td className="mono num subtle" style={{ textAlign: "right" }}>{item.priorityScore.toFixed(1)}</td>
    </tr>
  );
}

function SettingsPanel({ settings, onSaved }: { settings: SkillIntelligenceSettings; onSaved: (next: SkillIntelligenceSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const response = await updateSkillIntelligenceSettings(draft);
      onSaved(response.data);
      setDraft(response.data);
      setStatus({ tone: "ok", text: "Settings saved and recorded in the audit log." });
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : "Could not save settings." });
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, control: React.ReactNode, hint?: string) => (
    <div className="row between" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>{label}</div>
        {hint ? <div className="subtle" style={{ fontSize: 11.5, maxWidth: 320 }}>{hint}</div> : null}
      </div>
      {control}
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-hd">
        <div className="panel-title">Telemetry & optimization policy</div>
        <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={() => { void save(); }}>
          {saving ? <Ic.Spinner className="b-icon" /> : <Ic.Check className="b-icon" />}
          Save
        </button>
      </div>
      <div className="panel-bd" style={{ display: "grid", gap: 14 }}>
        {status ? (
          <div className={`note ${status.tone === "error" ? "blood" : ""}`}>
            {status.tone === "error" ? <Ic.XCircle className="n-icon" /> : <Ic.Check className="n-icon" />}
            <span>{status.text}</span>
          </div>
        ) : null}
        {field("Telemetry mode", (
          <select style={selectStyle} value={draft.telemetryMode} onChange={(event) => setDraft({ ...draft, telemetryMode: event.target.value as TelemetryCaptureMode })}>
            <option value="metrics-only">Metrics only</option>
            <option value="inputs-outputs">Inputs + outputs</option>
            <option value="full-trajectories">Full trajectories</option>
          </select>
        ), "Runs are stored at the lower of what the runtime sends and this mode. Everything is redacted before persistence.")}
        {field("Retention", (
          <div className="row" style={{ gap: 6 }}>
            <select style={{ ...selectStyle, minWidth: 110 }} value={draft.retention} onChange={(event) => setDraft({ ...draft, retention: event.target.value as RetentionClass, retentionCustomDays: event.target.value === "custom" ? draft.retentionCustomDays ?? 180 : null })}>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
              <option value="1y">1 year</option>
              <option value="custom">Custom</option>
            </select>
            {draft.retention === "custom" ? (
              <input type="number" min={1} max={3650} value={draft.retentionCustomDays ?? 180} onChange={(event) => setDraft({ ...draft, retentionCustomDays: Number(event.target.value) })} style={{ ...selectStyle, minWidth: 80, width: 90 }} />
            ) : null}
          </div>
        ))}
        {field("Auto-optimization", (
          <select style={selectStyle} value={draft.autoOptimizationMode} onChange={(event) => setDraft({ ...draft, autoOptimizationMode: event.target.value as AutoOptimizationMode })}>
            <option value="off">Off</option>
            <option value="observe">Observe</option>
            <option value="recommend">Recommend</option>
            <option value="continuous-evaluation">Continuous evaluation</option>
          </select>
        ), "Autonomous production deployment is intentionally not an option. Every candidate needs human approval.")}
        {field("Optimization aggressiveness", (
          <select style={selectStyle} value={draft.aggressiveness} onChange={(event) => setDraft({ ...draft, aggressiveness: event.target.value as OptimizationAggressiveness })}>
            <option value="conservative">Conservative</option>
            <option value="balanced">Balanced</option>
            <option value="exploratory">Exploratory</option>
          </select>
        ), "Tier ceilings still apply: Tier 1 is always conservative, Tier 2 at most balanced.")}
        {field("Minimum evidence", (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {(
              [
                ["minRuns", "runs"],
                ["minDistinctTasks", "tasks"],
                ["minFailureExamples", "failures"],
                ["minHeldOutCases", "held-out"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="col" style={{ gap: 2, fontSize: 10.5 }}>
                <span className="subtle">{label}</span>
                <input
                  type="number"
                  min={1}
                  value={draft.thresholds[key]}
                  onChange={(event) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [key]: Number(event.target.value) } })}
                  style={{ ...selectStyle, minWidth: 64, width: 72 }}
                />
              </label>
            ))}
          </div>
        ), "Tier 1 skills require double these thresholds.")}
        {field("Allowed optimization providers", (
          <div style={{ display: "grid", gap: 4 }}>
            {PROVIDERS.map(([provider, label]) => (
              <label key={provider} className="row" style={{ gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  disabled={provider === "local-unknown"}
                  checked={draft.allowedOptimizerProviders.includes(provider)}
                  onChange={(event) => setDraft({
                    ...draft,
                    allowedOptimizerProviders: event.target.checked
                      ? [...draft.allowedOptimizerProviders, provider]
                      : draft.allowedOptimizerProviders.filter((entry) => entry !== provider),
                  })}
                />
                {label}
              </label>
            ))}
          </div>
        ), "Skill classification narrows this further: confidential skills may only use Azure OpenAI; restricted skills are never optimized.")}
        {field("Optimization telemetry disabled for", (
          <input
            value={draft.optimizationDisabledSkills.join(", ")}
            onChange={(event) => setDraft({ ...draft, optimizationDisabledSkills: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}
            placeholder="skill ids, comma-separated"
            style={{ ...selectStyle, minWidth: 240 }}
          />
        ), "Highly sensitive skills keep outcome metrics only and are never sent to an optimizer.")}
        {field("Retain raw user identity", (
          <label className="row" style={{ gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={draft.retainUserIdentity} onChange={(event) => setDraft({ ...draft, retainUserIdentity: event.target.checked })} />
            {draft.retainUserIdentity ? "Retained (permission-controlled)" : "Pseudonymized"}
          </label>
        ), "Analytics aggregate by skill, version, runtime, and team, not by employee.")}
      </div>
    </div>
  );
}

function IngestTokenPanel() {
  const [label, setLabel] = useState("");
  const [connectorId, setConnectorId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setToken(null);
    try {
      const response = await createTelemetryIngestToken({ label, ...(connectorId.trim() ? { connectorId: connectorId.trim() } : {}) });
      setToken(response.data.token);
      setLabel("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-hd"><div className="panel-title">Telemetry ingest tokens</div></div>
      <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
        <div className="subtle" style={{ fontSize: 11.5 }}>
          Instrumented runtimes post runs to <span className="mono">POST /api/skill-runs</span> with <span className="mono">Authorization: Bearer svt_…</span>. Tokens are tenant-scoped, optionally connector-scoped, and shown once.
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label, e.g. Codex CLI fleet" style={{ ...selectStyle, minWidth: 200 }} />
          <input value={connectorId} onChange={(event) => setConnectorId(event.target.value)} placeholder="Connector id (optional)" style={{ ...selectStyle, minWidth: 160 }} />
          <button type="button" className="btn btn-sm" disabled={busy || !label.trim()} onClick={() => { void create(); }}>
            <Ic.Plus className="b-icon" /> Create token
          </button>
        </div>
        {token ? (
          <div className="note brass">
            <Ic.Lock className="n-icon" />
            <div className="grow">
              <div style={{ fontSize: 12 }}>Copy this token now. It will not be shown again.</div>
              <div className="mono" style={{ fontSize: 11.5, wordBreak: "break-all", marginTop: 4 }}>{token}</div>
            </div>
          </div>
        ) : null}
        {error ? <div className="note blood"><Ic.XCircle className="n-icon" /><span>{error}</span></div> : null}
      </div>
    </div>
  );
}

export function IntelligenceScreen() {
  const pathname = usePathname() || "/";
  const [data, setData] = useState<OrganizationIntelligencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchOrganizationIntelligence({ signal: controller.signal })
      .then((response) => { setData(response.data); setError(null); })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Could not load organizational intelligence.");
        }
      });
    return () => controller.abort();
  }, [reload]);

  if (!data) {
    return (
      <div className="page-inner">
        <div className={`note ${error ? "blood" : ""}`} style={{ marginTop: 24 }}>
          {error ? <Ic.XCircle className="n-icon" /> : <Ic.Spinner className="n-icon" />}
          <span>{error ?? "Loading organizational intelligence…"}</span>
        </div>
      </div>
    );
  }

  const bands: Array<["high" | "medium" | "low", string]> = [["high", "High impact"], ["medium", "Medium"], ["low", "Low"]];

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/05</span>
            <span className="sep">—</span>
            <span>Skill Intelligence</span>
          </div>
          <h1 className="h-display">Organizational capability, getting measurably better.</h1>
          <div className="page-head-sub">
            Savant learns how each skill performs in real use, proposes evidence-backed improvements, and routes every change through human review and the release rail.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => setReload((value) => value + 1)}>
            <Ic.Refresh className="b-icon" />
            Refresh
          </button>
        </div>
      </div>

      <div className="kpi-strip" style={{ marginBottom: 24, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Kpi label="Active skills" value={data.activeSkills} />
        <Kpi label="Runs this month" value={data.runsThisMonth.toLocaleString()} />
        <Kpi label="Eval-covered skills" value={data.evalCoveredSkillsPct ?? "—"} unit={data.evalCoveredSkillsPct == null ? "" : "%"} />
        <Kpi label="Awaiting review" value={data.recommendationsAwaitingReview} trend={`${data.skillsImproving} improving · ${data.skillsDegrading} degrading`} />
        <Kpi label="Sufficient telemetry" value={data.telemetrySufficientPct ?? "—"} unit={data.telemetrySufficientPct == null ? "" : "%"} trend={data.medianQualityImprovement90d != null ? `Median +${data.medianQualityImprovement90d} over 90d` : undefined} />
      </div>

      <div className="grid-2">
        <div className="col" style={{ gap: "var(--gutter)" }}>
          {data.highestOpportunity ? (
            <div className="note">
              <Ic.Eval className="n-icon" />
              <div className="grow">
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>Highest opportunity: {data.highestOpportunity.skillName}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Estimated improvement {data.highestOpportunity.delta >= 0 ? "+" : ""}{data.highestOpportunity.delta} points</div>
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Improvement queue</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>Sorted by impact × confidence × usage</span>
            </div>
            <div className="panel-bd tight">
              {data.queue.length === 0 ? (
                <div className="note"><Ic.Overview className="n-icon" /><span>No recommendations are waiting. Savant keeps observing and will queue candidates when evidence is sufficient.</span></div>
              ) : bands.map(([band, label]) => {
                const items = data.queue.filter((item) => item.band === band);
                if (items.length === 0) return null;
                return (
                  <div key={band}>
                    <div className="eyebrow" style={{ padding: "10px 14px 4px", fontSize: 10 }}>{label}</div>
                    <table className="tbl">
                      <tbody>
                        {items.map((item) => <QueueRow key={item.recommendationId} item={item} pathname={pathname} />)}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              {data.needsData.length > 0 ? (
                <div>
                  <div className="eyebrow" style={{ padding: "10px 14px 4px", fontSize: 10 }}>Needs data</div>
                  <table className="tbl">
                    <tbody>
                      {data.needsData.map((item) => (
                        <tr key={item.skillId}>
                          <td>
                            <Link href={buildTenantAwareAppPath(pathname, `/skills/${encodeURIComponent(item.skillId)}`) as Route} style={{ color: "inherit" }}>
                              {item.skillName}
                            </Link>
                          </td>
                          <td className="mono num subtle" style={{ textAlign: "right" }}>{item.runCount} / {item.minRuns} runs</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>

          <SettingsPanel settings={data.settings} onSaved={(settings) => setData({ ...data, settings })} />
        </div>

        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Telemetry coverage</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>Last 30 days</span>
            </div>
            <div className="panel-bd tight">
              {data.coverage.length > 0 ? (
                <table className="tbl">
                  <tbody>
                    {data.coverage.map((row) => (
                      <tr key={row.runtime}>
                        <td className="mono">{row.runtime.toUpperCase()}</td>
                        <td className="mono num" style={{ textAlign: "right" }}>{row.coveragePct.toFixed(0)}%</td>
                        <td>
                          <span className={`chip ${row.dominantLevel === "full" ? "chip-moss" : row.dominantLevel === "io" ? "chip-brass" : "chip-paper"}`}>
                            {row.dominantLevel === "full" ? "FULL" : row.dominantLevel === "io" ? "PARTIAL" : "OUTCOME ONLY"}
                          </span>
                        </td>
                        <td className="mono num subtle" style={{ textAlign: "right" }}>{row.runCount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="note"><Ic.Overview className="n-icon" /><span>No runs reported in the last 30 days.</span></div>
              )}
            </div>
          </div>

          <IngestTokenPanel />

          <div className="subtle" style={{ fontSize: 11.5 }}>
            Optimization engine: Microsoft SkillOpt (pinned, sandboxed). It can analyze, reflect, and propose bounded candidates. It cannot approve, publish, change permissions, or distribute skills.
          </div>
        </div>
      </div>
    </div>
  );
}
