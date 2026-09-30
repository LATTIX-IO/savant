"use client";

import { useEffect, useMemo, useState } from "react";

import { createTelemetryIngestToken } from "@/lib/control-plane-client";
import { fetchRouterSummary, type RouterSummary } from "@/lib/git-connections-client";

type ClientKey = "claude-code" | "claude-ai" | "chatgpt" | "vscode" | "gemini" | "cursor";

const CLIENTS: Array<{ key: ClientKey; label: string; runtime: string }> = [
  { key: "claude-code", label: "Claude Code", runtime: "claude" },
  { key: "claude-ai", label: "Claude.ai", runtime: "claude" },
  { key: "chatgpt", label: "ChatGPT", runtime: "chatgpt" },
  { key: "vscode", label: "GitHub Copilot (VS Code)", runtime: "copilot" },
  { key: "gemini", label: "Gemini CLI", runtime: "gemini" },
  { key: "cursor", label: "Cursor", runtime: "cursor" },
];

function setupFor(client: ClientKey, origin: string, token: string): { steps: string[]; code: string | null } {
  const url = `${origin}/api/mcp`;
  const urlWithToken = `${origin}/api/mcp/t/${token}`;
  const auth = `Bearer ${token}`;
  switch (client) {
    case "claude-code":
      return { steps: ["Run this in a terminal (add --scope user to use it in every project):"], code: `claude mcp add --transport http savant ${url} --header "Authorization: ${auth}"` };
    case "claude-ai":
      return { steps: ["Settings → Connectors → Add custom connector.", "Name it Savant and paste this URL (it carries the token, so keep it private):"], code: urlWithToken };
    case "chatgpt":
      return { steps: ["Settings → Apps & Connectors → Advanced settings → turn on Developer mode.", "Create a connector named Savant, set Authentication to “No authentication”, and paste this URL (it carries the token):"], code: urlWithToken };
    case "vscode":
      return { steps: ["Add to .vscode/mcp.json (or your user MCP settings), then use Copilot in Agent mode:"], code: JSON.stringify({ servers: { savant: { type: "http", url, headers: { Authorization: auth } } } }, null, 2) };
    case "gemini":
      return { steps: ["Add to ~/.gemini/settings.json:"], code: JSON.stringify({ mcpServers: { savant: { httpUrl: url, headers: { Authorization: auth } } } }, null, 2) };
    case "cursor":
      return { steps: ["Add to ~/.cursor/mcp.json:"], code: JSON.stringify({ mcpServers: { savant: { url, headers: { Authorization: auth } } } }, null, 2) };
  }
}

/**
 * Connect AI tools to the workspace's governed skills through the Savant
 * skill router (MCP), and watch the live telemetry it records.
 */
export function SkillRouterScreen() {
  const [origin, setOrigin] = useState("https://savantskills.app");
  const [client, setClient] = useState<ClientKey>("claude-code");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "default" | "error"; text: string } | null>(null);
  const [summary, setSummary] = useState<RouterSummary | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setOrigin(window.location.origin), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => fetchRouterSummary().then((response) => {
      if (active) setSummary(response.data);
    }).catch(() => undefined);
    void load();
    const interval = setInterval(() => void load(), 15_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const setup = useMemo(() => setupFor(client, origin, token ?? "svt_YOUR_TOKEN"), [client, origin, token]);

  async function createToken() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await createTelemetryIngestToken({ label: `Skill router · ${CLIENTS.find((entry) => entry.key === client)?.label ?? client}` });
      setToken(response.data.token);
      setMessage({ tone: "default", text: "Token created. It's shown once — the setup below now includes it. Store it like a password." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The token couldn't be created (admins only)." });
    } finally {
      setBusy(false);
    }
  }

  const totalRuns = summary?.byRuntime.reduce((sum, row) => sum + row.runs, 0) ?? 0;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/06</span>
            <span className="sep">—</span>
            <span>Skill router</span>
          </div>
          <h1 className="h-display">Skill router</h1>
          <div className="page-head-sub">
            Connect ChatGPT, Claude, GitHub Copilot, Gemini and Cursor to this workspace&apos;s governed skills over MCP. The router picks the right
            skill for each task (Jev chooses among your skills), serves the approved SKILL.md at its indexed commit, and records every use as a live
            run — the primary telemetry for skill health and SkillOpt. Evaluations remain the fallback where there&apos;s no live data yet.
          </div>
        </div>
      </div>

      <div className="split wide">
        <div className="col" style={{ gap: "var(--gutter)", minWidth: 0 }}>
          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Connect a tool</div>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void createToken()}>
                {busy ? "Creating…" : token ? "Create another token" : "Create connection token"}
              </button>
            </div>
            <div className="panel-bd col" style={{ gap: 12 }}>
              {message && <div className={`note ${message.tone === "error" ? "blood" : ""}`}><span style={{ fontSize: 12.5 }}>{message.text}</span></div>}
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {CLIENTS.map((entry) => (
                  <button key={entry.key} type="button" className={`btn btn-sm ${client === entry.key ? "btn-primary" : "btn-ghost"}`} onClick={() => setClient(entry.key)}>{entry.label}</button>
                ))}
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
                {!token && <li>Create a connection token (admins). Each tool can have its own, so you can revoke one without the others.</li>}
                {setup.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {setup.code && (
                <div style={{ position: "relative" }}>
                  <pre className="mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, margin: 0, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 }}>{setup.code}</pre>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ position: "absolute", top: 6, right: 6 }}
                    onClick={() => {
                      void navigator.clipboard.writeText(setup.code ?? "").then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
              <span className="subtle" style={{ fontSize: 12 }}>
                Then ask the assistant to do a task. It calls <span className="mono">find_skill</span>, loads the governed skill with <span className="mono">load_skill</span>,
                follows it, and reports the result with <span className="mono">report_skill_outcome</span>. Runs appear on the right within seconds.
              </span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Recent live runs</div></div>
            <div className="panel-bd tight" style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr><th>Skill</th><th style={{ width: 110 }}>Runtime</th><th style={{ width: 120 }}>Outcome</th><th style={{ width: 160 }}>When</th></tr>
                </thead>
                <tbody>
                  {(summary?.recent.length ?? 0) === 0 && <tr><td colSpan={4} className="subtle">No routed runs yet.</td></tr>}
                  {summary?.recent.map((run) => (
                    <tr key={run.run_id}>
                      <td><span className="mono" style={{ fontSize: 12 }}>{run.skill_id}</span>{run.model && <div className="subtle" style={{ fontSize: 11 }}>{run.model}</div>}</td>
                      <td>{run.runtime}</td>
                      <td>{run.task_outcome ?? "in progress"}{run.human_accepted === true ? " · accepted" : run.human_accepted === false ? " · rejected" : ""}</td>
                      <td className="subtle" style={{ fontSize: 12 }}>{new Date(run.started_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Live telemetry · 30 days</div></div>
            <div className="panel-bd col" style={{ gap: 8, fontSize: 12.5 }}>
              <span><strong style={{ fontSize: 18 }}>{totalRuns}</strong> routed runs across {summary?.governedSkills ?? "—"} governed skills</span>
              {summary?.byRuntime.map((row) => <span key={row.runtime}>{row.runtime}: {row.runs}</span>)}
              <span className="subtle">
                Outcomes: {summary ? `${summary.outcomes.succeeded ?? 0} succeeded · ${summary.outcomes.failed ?? 0} failed · ${summary.outcomes.unknown ?? 0} partial` : "—"}
              </span>
              {summary?.routing.map((row) => (
                <span key={row.method} className="subtle">Routing ({row.method}): {row.matched} of {row.decisions} tasks matched a skill</span>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-hd"><div className="panel-title">How it works</div></div>
            <div className="panel-bd col" style={{ gap: 6, fontSize: 12.5 }}>
              <span><strong>find_skill</strong> — Jev picks the governed skill that fits the task (or none).</span>
              <span><strong>load_skill</strong> — serves the approved SKILL.md pinned to its indexed commit and starts a tracked run.</span>
              <span><strong>report_skill_outcome</strong> — records success, acceptance and rating for health and SkillOpt.</span>
              <span className="subtle">Runs are attributed to the client (Claude, ChatGPT, Copilot, Gemini, Cursor) and stored under the workspace&apos;s telemetry policy and redaction.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
