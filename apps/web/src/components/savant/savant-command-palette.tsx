"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import type { EvaluationRunListItem, SkillListItem } from "@savant/types";

import { fetchEvaluationDashboard, fetchSkillList } from "@/lib/control-plane-client";
import { buildTenantAppPath } from "@/lib/tenant-paths";
import { getUiV2Navigation } from "@/lib/ui-v2-shell-model";
import type { SavantShellCounts } from "@/lib/shell-state";
import { UiV2Dialog, UiV2StateBanner } from "@/components/savant/ui-v2";
import styles from "./savant-command-palette.module.css";

export type PaletteIntent = "all" | "workbench" | "runs";
type Evidence = { scope: string; skills: readonly SkillListItem[];
  runs: readonly EvaluationRunListItem[]; errors: readonly string[]; loading: boolean };
const INITIAL: Evidence = { scope: "", skills: [], runs: [], errors: [], loading: true };

export function SavantCommandPalette({ open, intent, onClose, workspaceSlug, counts, governanceEnabled }: {
  open: boolean; intent: PaletteIntent; onClose: () => void;
  workspaceSlug: string; counts: SavantShellCounts; governanceEnabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<Evidence>(INITIAL);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setQuery("");
        setEvidence({ ...INITIAL, scope: workspaceSlug });
      }
    });
    void Promise.allSettled([
      fetchSkillList(undefined, { workspaceSlug, signal: controller.signal }),
      fetchEvaluationDashboard({ workspaceSlug, signal: controller.signal }),
    ]).then(outcomes => {
      if (controller.signal.aborted) return;
      const skills = outcomes[0];
      const runs = outcomes[1];
      setEvidence({
        scope: workspaceSlug, loading: false,
        skills: skills.status === "fulfilled" ? skills.value.data : [],
        runs: runs.status === "fulfilled" ? runs.value.data.runs : [],
        errors: [
          ...(skills.status === "rejected" ? ["Skill inventory is unavailable."] : []),
          ...(runs.status === "rejected" ? ["Evaluation run inventory is unavailable."] : []),
        ],
      });
    });
    return () => controller.abort();
  }, [open, workspaceSlug]);

  const data = evidence.scope === workspaceSlug ? evidence : INITIAL;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (name: string) => name.toLocaleLowerCase().includes(normalizedQuery);
  const navigation = intent === "all"
    ? getUiV2Navigation(workspaceSlug, "/dashboard", counts, governanceEnabled)
      .filter(item => matches(item.label)).slice(0, 16) : [];
  const skills = intent !== "runs" ? data.skills.filter(item =>
    matches(item.name) || matches(item.repo) || matches(item.owner)).slice(0, 12) : [];
  const runs = intent !== "workbench" ? data.runs.filter(item =>
    matches(item.skill) || matches(item.id)).slice(0, 12) : [];
  const heading = intent === "workbench" ? "Choose a skill to edit" :
    intent === "runs" ? "Open an observed evaluation" : "Search Savant";
  const onKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = Array.from(resultsRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
    if (!links.length) return;
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    links[(current + delta + links.length) % links.length]?.focus();
    event.preventDefault();
  };
  const closeAndFollow = () => { onClose(); };
  return <UiV2Dialog id="savant-command" title={heading} open={open} onClose={onClose}>
    <div onKeyDown={onKeys} className={styles.palette}>
      <label className={styles.searchLabel} htmlFor="savant-command-input">
        Search authorized routes, skills and evaluation runs
      </label>
      <input id="savant-command-input" type="search" className={styles.search} value={query}
        onChange={event => setQuery(event.target.value)} autoComplete="off"
        placeholder="Search by name or evaluation ID" />
      <div ref={resultsRef} className={styles.results} aria-live="polite">
        {intent === "all" && navigation.length > 0 ? <section aria-label="Pages">
          <h3>Pages</h3>
          {navigation.map(item => <Link key={item.id} href={item.href as Route} onClick={closeAndFollow}>
            <span>{item.label}</span><small>Open section</small>
          </Link>)}
        </section> : null}
        {data.loading ? <p className={styles.notice} role="status">Loading permitted workspace results…</p> : null}
        {data.errors.map(error => <UiV2StateBanner key={error} state="unavailable" label={error} />)}
        {skills.length > 0 ? <section aria-label="Indexed skills">
          <h3>Indexed skills</h3>
          {skills.map(item => <Link key={item.skillUuid}
            href={buildTenantAppPath(workspaceSlug, `/skills/${encodeURIComponent(item.skillUuid)}`) as Route}
            onClick={closeAndFollow}>
            <span>{item.name}</span><small>{item.repo} · {item.channel}</small>
          </Link>)}
        </section> : null}
        {runs.length > 0 ? <section aria-label="Evaluation runs">
          <h3>Evaluation runs</h3>
          {runs.map(item => <Link key={item.id}
            href={buildTenantAppPath(workspaceSlug, `/evaluations/${encodeURIComponent(item.id)}`) as Route}
            onClick={closeAndFollow}>
            <span>{item.skill}</span><small>{item.id} · {item.status}</small>
          </Link>)}
        </section> : null}
        {!data.loading && navigation.length === 0 && skills.length === 0 && runs.length === 0
          ? <p role="status" className={styles.notice}>No authorized results. Try another search or open an existing section.</p> : null}
        {intent !== "all" ? <Link className={styles.fallback}
          href={buildTenantAppPath(workspaceSlug, intent === "workbench" ? "/skills" : "/evaluations") as Route}
          onClick={closeAndFollow}>
          Browse {intent === "workbench" ? "Library" : "Evaluations"} instead
        </Link> : null}
      </div>
    </div>
  </UiV2Dialog>;
}
