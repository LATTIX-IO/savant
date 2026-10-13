"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { RepositoryListItem, SkillListItem } from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { useOnboarding } from "@/components/savant/onboarding-context";
import { SkillCreateModal } from "@/components/savant/skill-create-modal";
import {
  UiV2Button, UiV2EmptyState, UiV2Metric, UiV2Status, UiV2TableViewport,
} from "@/components/savant/ui-v2";
import { useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import { fetchRepositoryList, fetchSkillList } from "@/lib/control-plane-client";
import { buildSkillDetailPath } from "@/lib/skill-paths";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import {
  filterUiV2Repositories, filterUiV2Skills, getUiV2RepositoryHealth,
  safeUiV2Count, uiV2ProvenanceNote, type LibrarySection, type LibraryStage,
} from "@/lib/ui-v2-library-model";
import styles from "./ui-v2-pages.module.css";

type SourceState<T> =
  | { scope: string; phase: "loading"; data: null; error: null }
  | { scope: string; phase: "ready"; data: readonly T[]; error: null }
  | { scope: string; phase: "error"; data: null; error: string };
const initialSkills: SourceState<SkillListItem> = { scope: "", phase: "loading", data: null, error: null };
const initialRepositories: SourceState<RepositoryListItem> = { scope: "", phase: "loading", data: null, error: null };

export function LibraryV2() {
  const scope = useUiV2WorkspaceSlug() ?? "";
  const pathname = usePathname() || "/";
  const { show, latestConnectedRepository } = useOnboarding();
  const [section, setSection] = useState<LibrarySection>("skills");
  const [term, setTerm] = useState("");
  const [stage, setStage] = useState<LibraryStage>("all");
  const [skills, setSkills] = useState<SourceState<SkillListItem>>(initialSkills);
  const [repositories, setRepositories] = useState<SourceState<RepositoryListItem>>(initialRepositories);
  const [retry, setRetry] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const lastConnectedAt = latestConnectedRepository?.at ?? 0;

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) setSkills({ scope, phase: "loading", data: null, error: null }); });
    void fetchSkillList(undefined, { workspaceSlug: scope, signal: controller.signal })
      .then(response => {
        if (active) setSkills({ scope, phase: "ready", data: response.data, error: null });
      }).catch(error => {
        if (active && !controller.signal.aborted) setSkills({
          scope, phase: "error", data: null,
          error: error instanceof Error ? error.message : "Skill inventory unavailable.",
        });
      });
    return () => { active = false; controller.abort(); };
  }, [scope, retry, lastConnectedAt]);

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) setRepositories({ scope, phase: "loading", data: null, error: null }); });
    void fetchRepositoryList({ workspaceSlug: scope, signal: controller.signal })
      .then(response => {
        if (active) setRepositories({ scope, phase: "ready", data: response.data, error: null });
      }).catch(error => {
        if (active && !controller.signal.aborted) setRepositories({
          scope, phase: "error", data: null,
          error: error instanceof Error ? error.message : "Repository inventory unavailable.",
        });
      });
    return () => { active = false; controller.abort(); };
  }, [scope, retry, lastConnectedAt]);

  // A late response from a previous tenant must never appear in the next tenant's UI.
  const skillState = skills.scope === scope ? skills : initialSkills;
  const repoState = repositories.scope === scope ? repositories : initialRepositories;
  const filteredSkills = useMemo(
    () => filterUiV2Skills(skillState.data ?? [], term, stage),
    [skillState.data, term, stage],
  );
  const filteredRepositories = useMemo(
    () => filterUiV2Repositories(repoState.data ?? [], term),
    [repoState.data, term],
  );
  const detailHref = buildTenantAwareAppPath(pathname, "/repositories") as Route;
  const marketplaceHref = buildTenantAwareAppPath(pathname, "/catalog") as Route;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>Library / Governed assets</div>
          <h1>Library</h1>
          <p>Search governed skills and connected source repositories from your workspace.</p>
        </div>
        <div className={styles.actions}>
          <UiV2Button variant="tertiary" onClick={() => setRetry(x => x + 1)}>
            <Ic.Refresh className={styles.icon} aria-hidden="true" />Refresh
          </UiV2Button>
          <UiV2Button onClick={show}>Connect repository</UiV2Button>
          <UiV2Button variant="primary" onClick={() => setCreateOpen(true)}>New skill</UiV2Button>
        </div>
      </div>

      <div className={styles.metrics}>
        <UiV2Metric label="Governed skills" value={skillState.phase === "ready" ? safeUiV2Count(skillState.data?.length) : null} />
        <UiV2Metric label="Connected repositories" value={repoState.phase === "ready" ? safeUiV2Count(repoState.data?.length) : null} />
        <UiV2Metric label="Repositories indexed" value={repoState.phase === "ready"
          ? repoState.data?.filter(repo => getUiV2RepositoryHealth(repo) === "ready").length
          : null} />
      </div>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Library sections">
          <button id="sv2-skills-tab" type="button" role="tab" aria-controls="sv2-library-list"
            aria-selected={section === "skills"} onClick={() => setSection("skills")}>Skills</button>
          <button id="sv2-repos-tab" type="button" role="tab" aria-controls="sv2-library-list"
            aria-selected={section === "repositories"} onClick={() => setSection("repositories")}>Repositories</button>
        </div>
        <label className={styles.search}>
          <span className={styles.visuallyHidden}>Search {section}</span>
          <Ic.Search className={styles.icon} aria-hidden="true" />
          <input type="search" autoComplete="off" value={term}
            placeholder={section === "skills" ? "Search skills, teams, owners…" : "Search repositories…"}
            onChange={e => setTerm(e.target.value)} />
        </label>
        {section === "skills" ? (
          <label className={styles.filter}>
            <span className={styles.visuallyHidden}>Filter skills by channel</span>
            <select value={stage} onChange={e => setStage(e.target.value as LibraryStage)}>
              <option value="all">All channels</option>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="draft">Draft</option>
              <option value="candidate">Candidates</option>
            </select>
          </label>
        ) : null}
      </div>

      <section id="sv2-library-list" className={styles.panel} role="tabpanel"
        aria-labelledby={section === "skills" ? "sv2-skills-tab" : "sv2-repos-tab"}>
        {section === "skills" ? (
          skillState.phase === "loading" ? <p className={styles.message} role="status">Loading workspace skills…</p> :
          skillState.phase === "error" ? (
            <div className={styles.error} role="alert">
              <span>Could not load skills: {skillState.error}</span>
              <UiV2Button onClick={() => setRetry(x => x + 1)}>Retry</UiV2Button>
            </div>
          ) : filteredSkills.length === 0 ? (
            <UiV2EmptyState message={term || stage !== "all"
              ? "No skills match these filters." : "No indexed skills in this workspace. Connect and sync a repository to begin."} />
          ) : (
            <UiV2TableViewport label="Workspace governed skills">
              <table className={styles.table}>
                <thead><tr><th>Skill</th><th>Tier</th><th>Repository</th><th>Channel</th><th>Source revision</th><th>Evaluation score</th></tr></thead>
                <tbody>{filteredSkills.map(skill => (
                  <tr key={skill.skillUuid}>
                    <td>
                      <Link href={buildSkillDetailPath(pathname, skill) as Route} className={styles.primaryLink}>
                        {skill.name}
                      </Link>
                      <span className={styles.subtext}>{skill.team} · {skill.owner}</span>
                    </td>
                    <td>Tier {skill.tier}</td>
                    <td>{skill.repo}</td>
                    <td><span className={styles.mono}>{skill.channel}</span></td>
                    <td className={styles.mono}>{skill.projection.sourceCommitSha || "Not indexed"}</td>
                    <td className={styles.mono}>{skill.score !== null && Number.isFinite(skill.score)
                      ? skill.score.toFixed(1) : "Not available"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </UiV2TableViewport>
          )
        ) : (
          repoState.phase === "loading" ? <p className={styles.message} role="status">Loading workspace repositories…</p> :
          repoState.phase === "error" ? (
            <div className={styles.error} role="alert">
              <span>Could not load repositories: {repoState.error}</span>
              <UiV2Button onClick={() => setRetry(x => x + 1)}>Retry</UiV2Button>
            </div>
          ) : filteredRepositories.length === 0 ? (
            <UiV2EmptyState message={term
              ? "No repositories match your search." : "No repositories connected. Use Connect repository to get started."} />
          ) : (
            <UiV2TableViewport label="Connected repositories">
              <table className={styles.table}>
                <thead><tr><th>Repository</th><th>Provider</th><th>Index state</th><th>Indexed assets</th><th>Provenance</th><th>Action</th></tr></thead>
                <tbody>{filteredRepositories.map(repository => {
                  const health = getUiV2RepositoryHealth(repository);
                  return <tr key={repository.id}>
                    <td><strong>{repository.name}</strong><span className={styles.subtext}>{repository.branch}</span></td>
                    <td>{repository.provider}</td>
                    <td><UiV2Status state={health === "ready" ? "ready" : health === "action-required" ? "warning" : health === "indexing" ? "running" : "unavailable"}
                      label={health === "not-indexed" ? "Not indexed" : health === "indexing" ? "Indexing" :
                        health === "action-required" ? "Review connection" : "Indexed"} /></td>
                    <td className={styles.mono}>{safeUiV2Count(repository.skills) ?? "Not available"}</td>
                    <td className={styles.mono}>{uiV2ProvenanceNote(repository)}</td>
                    <td><Link href={detailHref} className={styles.primaryLink}>Manage</Link></td>
                  </tr>;
                })}</tbody>
              </table>
            </UiV2TableViewport>
          )
        )}
      </section>

      <p className={styles.help}>
        Repository synchronization and assessment remain available under <Link href={detailHref}>Repositories</Link>.
        Public marketplace items are under <Link href={marketplaceHref}>Marketplace</Link>.
      </p>
      <SkillCreateModal open={createOpen} onClose={() => setCreateOpen(false)}
        onApplied={() => setRetry(x => x + 1)} />
    </div>
  );
}
