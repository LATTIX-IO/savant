"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { SkillCreateModal } from "@/components/savant/skill-create-modal";
import {
  BranchRef,
  CommitRef,
  EnvPill,
  Facet,
  RepoChip,
  Sparkline,
  Tier,
} from "@/components/savant/primitives";
import { SKILLS, type Skill } from "@/lib/savant-data";

type TierFilter = "all" | "1" | "2" | "3";
type StatusFilter = "all" | "production" | "staging" | "draft" | "candidate";

export function CatalogScreen() {
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string>(SKILLS[0]!.id);
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    let list: Skill[] = SKILLS;
    if (tierFilter !== "all") list = list.filter((s) => s.tier === Number(tierFilter));
    if (statusFilter === "production") list = list.filter((s) => s.channel === "production");
    if (statusFilter === "staging") list = list.filter((s) => s.channel === "staging");
    if (statusFilter === "draft") list = list.filter((s) => s.channel === "draft");
    if (statusFilter === "candidate") list = list.filter((s) => s.status.startsWith("candidate"));
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.owner.toLowerCase().includes(q) ||
          s.team.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tierFilter, statusFilter, query]);

  const selected = SKILLS.find((s) => s.id === focusId) || filtered[0] || SKILLS[0];

  const tierCount = (t: 1 | 2 | 3) => SKILLS.filter((s) => s.tier === t).length;
  const statusCount = (k: StatusFilter) => {
    if (k === "production") return SKILLS.filter((s) => s.channel === "production").length;
    if (k === "staging") return SKILLS.filter((s) => s.channel === "staging").length;
    if (k === "draft") return SKILLS.filter((s) => s.channel === "draft").length;
    if (k === "candidate") return SKILLS.filter((s) => s.status.startsWith("candidate")).length;
    return SKILLS.length;
  };

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/01</span>
            <span className="sep">—</span>
            <span>Catalog</span>
          </div>
          <h1 className="h-display">Skills</h1>
          <div className="page-head-sub">
            Every governed skill, with provenance back to its source repository. Browse, filter,
            or open a skill to inspect its evaluation history.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost">
            <Ic.Sort className="b-icon" />
            Export catalog
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Ic.Plus className="b-icon" />
            New skill
          </button>
        </div>
      </div>

      <div className="split" style={{ alignItems: "flex-start" }}>
        <div className="col" style={{ gap: 0 }}>
          <div className="filterbar">
            <div className="row" style={{ gap: 6 }}>
              <Facet active={tierFilter === "all"} onClick={() => setTierFilter("all")}>
                All <span className="f-count">{SKILLS.length}</span>
              </Facet>
              <Facet active={tierFilter === "1"} onClick={() => setTierFilter("1")}>
                Tier 1 <span className="f-count">{tierCount(1)}</span>
              </Facet>
              <Facet active={tierFilter === "2"} onClick={() => setTierFilter("2")}>
                Tier 2 <span className="f-count">{tierCount(2)}</span>
              </Facet>
              <Facet active={tierFilter === "3"} onClick={() => setTierFilter("3")}>
                Tier 3 <span className="f-count">{tierCount(3)}</span>
              </Facet>
            </div>
            <div className="facet-divider" />
            <div className="row" style={{ gap: 6 }}>
              <Facet active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
                All channels
              </Facet>
              <Facet active={statusFilter === "production"} onClick={() => setStatusFilter("production")}>
                Production <span className="f-count">{statusCount("production")}</span>
              </Facet>
              <Facet active={statusFilter === "staging"} onClick={() => setStatusFilter("staging")}>
                Staging <span className="f-count">{statusCount("staging")}</span>
              </Facet>
              <Facet active={statusFilter === "draft"} onClick={() => setStatusFilter("draft")}>
                Draft <span className="f-count">{statusCount("draft")}</span>
              </Facet>
              <Facet active={statusFilter === "candidate"} onClick={() => setStatusFilter("candidate")}>
                Has candidate <span className="f-count">{statusCount("candidate")}</span>
              </Facet>
            </div>
            <div className="grow" />
            <div style={{ position: "relative" }}>
              <Ic.Search
                style={{
                  width: 12,
                  height: 12,
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
                placeholder="Search skills, owners, teams…"
                style={{
                  height: 26,
                  padding: "0 10px 0 26px",
                  fontSize: 12,
                  border: "1px solid var(--rule-2)",
                  borderRadius: 4,
                  background: "var(--panel)",
                  width: 220,
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div className="panel" style={{ borderRadius: "0 0 6px 6px", borderTop: 0 }}>
            <div className="panel-bd tight">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: "30%" }}>Skill</th>
                    <th>Tier</th>
                    <th>Source</th>
                    <th>Version</th>
                    <th>Channel</th>
                    <th>Owner</th>
                    <th style={{ textAlign: "right" }}>Score</th>
                    <th style={{ textAlign: "right" }}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      className={s.id === selected?.id ? "selected" : ""}
                      onClick={() => setFocusId(s.id)}
                    >
                      <td>
                        <div className="tbl-name">
                          <div className="tbl-name-text">
                            <span className="pri">{s.name}</span>
                            <span className="sec">{s.team}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Tier n={s.tier} />
                      </td>
                      <td>
                        <RepoChip provider={s.repoProvider} name={s.repo} />
                      </td>
                      <td>
                        {s.ref !== "—" ? (
                          <span className="mono num" style={{ color: "var(--ink-3)" }}>
                            {s.ref}
                          </span>
                        ) : (
                          <span className="subtle mono">—</span>
                        )}
                      </td>
                      <td>
                        <EnvPill env={s.channel} />
                      </td>
                      <td className="muted" style={{ fontSize: 12.5 }}>
                        {s.owner}
                      </td>
                      <td className="mono num" style={{ textAlign: "right", color: "var(--ink)" }}>
                        {s.score == null ? <span className="subtle">—</span> : s.score.toFixed(1)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Sparkline data={s.trend} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {selected ? <CatalogPreview skill={selected} /> : null}
      </div>

      <SkillCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CatalogPreview({ skill }: { skill: Skill }) {
  return (
    <div className="panel" style={{ position: "sticky", top: 0 }}>
      <div className="panel-hd">
        <div className="panel-title">Preview</div>
        <button type="button" className="icon-btn">
          <Ic.More style={{ width: 14, height: 14 }} />
        </button>
      </div>
      <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <Tier n={skill.tier} />
            <EnvPill env={skill.channel} />
          </div>
          <div className="h1" style={{ fontSize: 18 }}>
            {skill.name}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.45 }}>
            {skill.description}
          </div>
        </div>

        <div className="divider" />

        <div className="col" style={{ gap: 6 }}>
          <PreviewRow label="Source">
            <RepoChip provider={skill.repoProvider} name={skill.repo} />
          </PreviewRow>
          <PreviewRow label="Branch">
            {skill.branch !== "—" ? <BranchRef branch={skill.branch} /> : <span className="subtle">—</span>}
          </PreviewRow>
          <PreviewRow label="Production">
            {skill.ref !== "—" ? (
              <CommitRef commit={skill.commit} label={skill.ref} />
            ) : (
              <span className="subtle">No production version</span>
            )}
          </PreviewRow>
          {skill.candidateRef !== "—" && (
            <PreviewRow label="Candidate">
              <CommitRef commit={skill.candidateCommit} label={skill.candidateRef} />
            </PreviewRow>
          )}
          <PreviewRow label="Owner">
            <div className="row" style={{ gap: 6 }}>
              <span className="avatar sm">{skill.owner.slice(0, 2).toUpperCase()}</span>
              <span style={{ fontSize: 12.5 }}>{skill.owner}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>
                · {skill.team}
              </span>
            </div>
          </PreviewRow>
          <PreviewRow label="Access">
            <span className="ref">
              <Ic.Lock className="ref-icon" /> {skill.accessGroup}
            </span>
          </PreviewRow>
          <PreviewRow label="Versions">
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {skill.versionCount} on record
            </span>
          </PreviewRow>
        </div>

        <div className="divider" />

        {skill.trend.length > 0 && skill.score != null ? (
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Score trend · last 10 evals
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="h-display" style={{ fontSize: 32 }}>
                {skill.score.toFixed(1)}
              </div>
              <Sparkline data={skill.trend} w={120} h={36} />
            </div>
          </div>
        ) : (
          <div className="note">
            <Ic.Clock className="n-icon" />
            <span>
              No evaluation history yet. Candidate <span className="mono">{skill.candidateRef}</span>{" "}
              is the first release.
            </span>
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <Link href={`/skills/${skill.id}`} className="btn btn-primary grow">
            <span>Open skill</span>
            <Ic.ChevR className="b-icon" />
          </Link>
          <button type="button" className="btn btn-ghost">
            <Ic.ExternalLink className="b-icon" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "78px 1fr",
        alignItems: "center",
        gap: 12,
        padding: "4px 0",
      }}
    >
      <div className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
