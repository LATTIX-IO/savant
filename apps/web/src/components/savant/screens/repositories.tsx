"use client";

import { useState, type ReactNode } from "react";

import { Ic, ProviderIcon } from "@/components/savant/icons";
import {
  BranchRef,
  CommitRef,
  Facet,
} from "@/components/savant/primitives";
import { useOnboarding } from "@/components/savant/onboarding-context";
import { REPOS, REPO_DETAILS } from "@/lib/savant-data";

type ProviderFilter = "all" | "github" | "gitlab" | "azure" | "bitbucket";

export function RepositoriesScreen() {
  const { show } = useOnboarding();
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [selId, setSelId] = useState<string>(REPOS[0]!.id);

  const sel = REPOS.find((r) => r.id === selId) ?? REPOS[0]!;
  const det = REPO_DETAILS[sel.id] ?? REPO_DETAILS["wh-skills"]!;

  const filtered = providerFilter === "all" ? REPOS : REPOS.filter((r) => r.provider === providerFilter);
  const totalSkills = REPOS.reduce((n, r) => n + r.skills, 0);
  const stale = REPOS.filter((r) => r.status !== "ok").length;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/03</span>
            <span className="sep">—</span>
            <span>Repositories</span>
          </div>
          <h1 className="h-display">Source repositories</h1>
          <div className="page-head-sub">
            Skill content lives in your Git environment. Savant ingests, validates manifests, and
            resolves approved versions back to a commit.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost">
            <Ic.Refresh className="b-icon" />
            Resync all
          </button>
          <button type="button" className="btn btn-primary" onClick={show}>
            <Ic.Plus className="b-icon" />
            Connect repository
          </button>
        </div>
      </div>

      <div className="kpi-strip" style={{ marginBottom: 24 }}>
        <div className="kpi">
          <div className="kpi-label">Connected</div>
          <div className="kpi-value num">{REPOS.length}</div>
          <div className="kpi-trend">across 4 providers</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Skills under management</div>
          <div className="kpi-value num">{totalSkills}</div>
          <div className="kpi-trend up">▲ 6 this week</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Last sync</div>
          <div className="kpi-value num">
            11<span style={{ fontSize: 16, color: "var(--muted)" }}>m</span>
          </div>
          <div className="kpi-trend">webhook · wh/platform</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Needs attention</div>
          <div className="kpi-value num" style={{ color: stale ? "var(--oxblood)" : "var(--ink)" }}>
            {stale}
          </div>
          <div className="kpi-trend down">1 stale · 1 offline</div>
        </div>
      </div>

      <div className="split">
        <div className="col" style={{ gap: 0 }}>
          <div className="filterbar">
            <Facet active={providerFilter === "all"} onClick={() => setProviderFilter("all")}>
              All
            </Facet>
            <Facet active={providerFilter === "github"} onClick={() => setProviderFilter("github")}>
              <Ic.GitHub style={{ width: 11, height: 11 }} /> GitHub
            </Facet>
            <Facet active={providerFilter === "gitlab"} onClick={() => setProviderFilter("gitlab")}>
              <Ic.GitLab style={{ width: 11, height: 11 }} /> GitLab
            </Facet>
            <Facet active={providerFilter === "azure"} onClick={() => setProviderFilter("azure")}>
              <Ic.Azure style={{ width: 11, height: 11 }} /> Azure
            </Facet>
            <Facet active={providerFilter === "bitbucket"} onClick={() => setProviderFilter("bitbucket")}>
              <Ic.Bitbucket style={{ width: 11, height: 11 }} /> Bitbucket
            </Facet>
            <div className="grow" />
            <button type="button" className="btn btn-sm">
              <Ic.Sort className="b-icon" />
              Sort: last sync
            </button>
          </div>
          <div className="panel" style={{ borderRadius: "0 0 6px 6px", borderTop: 0 }}>
            <div className="panel-bd tight">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Provider</th>
                    <th>Default branch</th>
                    <th style={{ textAlign: "right" }}>Skills</th>
                    <th>Last sync</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className={r.id === selId ? "selected" : ""} onClick={() => setSelId(r.id)}>
                      <td>
                        <div className="tbl-name">
                          <ProviderIcon p={r.provider} size={13} />
                          <div className="tbl-name-text">
                            <span className="pri mono" style={{ fontSize: 12.5 }}>
                              {r.name}
                            </span>
                            <span className="sec">{r.provider}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="chip chip-paper">{r.provider}</span>
                      </td>
                      <td>
                        <BranchRef branch={r.branch} />
                      </td>
                      <td className="num" style={{ textAlign: "right", fontWeight: 500 }}>
                        {r.skills}
                      </td>
                      <td className="muted">{r.lastSync}</td>
                      <td>
                        {r.status === "ok" ? (
                          <span className="chip chip-moss">
                            <span className="dot" />
                            in sync
                          </span>
                        ) : r.status === "warn" ? (
                          <span className="chip chip-brass">
                            <span className="dot" />
                            stale
                          </span>
                        ) : (
                          <span className="chip chip-blood">
                            <span className="dot" />
                            offline
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="panel" style={{ position: "sticky", top: 0 }}>
          <div className="panel-hd">
            <div className="panel-title">Repository details</div>
            <button type="button" className="btn btn-sm">
              <Ic.ExternalLink className="b-icon" />
              Open in {sel.provider}
            </button>
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <ProviderIcon p={sel.provider} size={14} />
                <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                  {sel.name}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                {det.description}
              </div>
            </div>

            <div className="divider" />

            <div className="col" style={{ gap: 6 }}>
              <DetailRow label="Default branch">
                <BranchRef branch={sel.branch} />
              </DetailRow>
              <DetailRow label="Sync mode">
                <span className="chip chip-paper">{det.syncMode}</span>
              </DetailRow>
              <DetailRow label="Webhook">
                <span className="chip chip-moss">
                  <span className="dot" />
                  healthy · {sel.lastSync}
                </span>
              </DetailRow>
              <DetailRow label="Tier policy">
                <span style={{ fontSize: 12.5 }}>{det.tierPolicy}</span>
              </DetailRow>
              <DetailRow label="Skills">
                <span className="num" style={{ fontSize: 12.5 }}>
                  {sel.skills}
                </span>
              </DetailRow>
              <DetailRow label="By tier">
                <div className="row" style={{ gap: 6 }}>
                  <span className="chip tier-1">T1 {det.skillsByTier[1]}</span>
                  <span className="chip tier-2">T2 {det.skillsByTier[2]}</span>
                  <span className="chip tier-3">T3 {det.skillsByTier[3]}</span>
                </div>
              </DetailRow>
            </div>

            <div className="divider" />

            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Recent commits
              </div>
              <div className="col" style={{ gap: 8 }}>
                {det.recentCommits.map((c, i) => (
                  <div key={i} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                    <CommitRef commit={c.commit} />
                    <div className="col" style={{ gap: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "var(--ink-2)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.msg}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {c.who} · {c.when}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr",
        alignItems: "center",
        gap: 12,
        padding: "3px 0",
      }}
    >
      <div className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
