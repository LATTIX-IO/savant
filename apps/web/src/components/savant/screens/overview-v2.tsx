"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  EvaluationDashboardPayload, OverviewPayload, SkillListItem, SourceOfTruth,
} from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { useOnboarding } from "@/components/savant/onboarding-context";
import { useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import {
  UiV2Button, UiV2EmptyState, UiV2Metric, UiV2PageHeader,
  UiV2StateBanner, UiV2Status, UiV2TableViewport,
} from "@/components/savant/ui-v2";
import { fetchEvaluationDashboard, fetchSkillList } from "@/lib/control-plane-client";
import { getUiV2Kpi, safeUiV2Count } from "@/lib/ui-v2-library-model";
import { buildUiV2Attention, medianObservedQuality, observedInFlight } from "@/lib/ui-v2-overview-model";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import styles from "./ui-v2-pages.module.css";

type Evidence = {
  scope: string; phase: "loading" | "ready";
  skills: readonly SkillListItem[] | null; dashboard: EvaluationDashboardPayload | null;
  errors: readonly string[];
};
const EMPTY: Evidence = { scope:"", phase:"loading", skills:null, dashboard:null, errors:[] };

export function OverviewV2({ overview, sourceOfTruth }: {
  overview: OverviewPayload; sourceOfTruth?: SourceOfTruth | undefined;
}) {
  const pathname = usePathname() || "/";
  const scope = useUiV2WorkspaceSlug() ?? "";
  const { show } = useOnboarding();
  const [evidence, setEvidence] = useState<Evidence>(EMPTY);
  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setEvidence({ ...EMPTY, scope });
    });
    void Promise.allSettled([
      fetchSkillList(undefined, { workspaceSlug:scope, signal:controller.signal }),
      fetchEvaluationDashboard({ workspaceSlug:scope, signal:controller.signal }),
    ]).then(results => {
      if (controller.signal.aborted) return;
      const skills = results[0], dashboard = results[1];
      setEvidence({
        scope, phase:"ready",
        skills: skills.status === "fulfilled" ? skills.value.data : null,
        dashboard: dashboard.status === "fulfilled" ? dashboard.value.data : null,
        errors: [
          ...(skills.status === "rejected" ? ["Skill health data is unavailable."] : []),
          ...(dashboard.status === "rejected" ? ["Evaluation activity is unavailable."] : []),
        ],
      });
    });
    return () => controller.abort();
  }, [scope]);
  const live = evidence.scope === scope ? evidence : EMPTY;
  const skillQuality = live.skills ? medianObservedQuality(live.skills) : null;
  const evalCoverage = getUiV2Kpi(overview, "eval-coverage");
  const medianPass = live.dashboard?.kpis.find(metric => metric.key === "median-pass-rate");
  const attention = buildUiV2Attention(overview);
  const inFlight = observedInFlight(live.dashboard?.runs ?? []);
  const skillHref = buildTenantAwareAppPath(pathname, "/skills") as Route;
  const reposHref = buildTenantAwareAppPath(pathname, "/repositories") as Route;
  const evalHref = buildTenantAwareAppPath(pathname, "/evaluations") as Route;
  const releaseHref = buildTenantAwareAppPath(pathname, "/releases") as Route;
  const auditHref = buildTenantAwareAppPath(pathname, "/audit") as Route;
  return <div className={styles.page}>
    <UiV2PageHeader title="Overview" eyebrow="Workspace / operational health"
      description={`${overview.counts.skillsUnderGovernance} governed skills · ${overview.counts.connectedRepositories} connected repositories`}
      actions={<>
        <Link href={skillHref} className={styles.secondaryLink}>Open Library</Link>
        <UiV2Button onClick={show}><Ic.Repo className={styles.icon} aria-hidden="true" />Connect repository</UiV2Button>
        <Link href={evalHref} className={styles.secondaryLink}>New evaluation</Link>
      </>} />
    {sourceOfTruth ? <p className={styles.provenance}>Source: {sourceOfTruth}</p> : null}

    <section className={styles.referenceMetrics} aria-label="Workspace quality measures">
      <div><UiV2Metric label="Governed skills" value={safeUiV2Count(overview.counts.skillsUnderGovernance)} /></div>
      <div><UiV2Metric label="Evaluation coverage" value={evalCoverage ? `${evalCoverage.value}${evalCoverage.unit ?? ""}` : null} /></div>
      <div><UiV2Metric label="Median skill quality" value={skillQuality === null ? null : skillQuality.toFixed(1)} /></div>
      <div><UiV2Metric label="Open regressions" value={safeUiV2Count(overview.counts.activeRegressionAlerts)} /></div>
      <div><UiV2Metric label="Mean provider cost/run" value={null} />
        <small className={styles.subtext}>No qualified cost aggregation source</small></div>
    </section>

    {live.errors.map(error => <UiV2StateBanner key={error} state="unavailable" label={error} />)}

    <div className={styles.referenceColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><h2>Needs attention</h2><Link href={evalHref}>All evaluations</Link></div>
        {attention.length === 0 ? <UiV2EmptyState message="No issues or approvals awaiting action in this workspace." /> :
          <UiV2TableViewport label="Priority attention queue"><table className={styles.table}>
            <thead><tr><th>Priority</th><th>Item</th><th>Decision</th></tr></thead>
            <tbody>{attention.map(item => <tr key={item.id}>
              <td><UiV2Status state={item.priority === "P1" ? "failed" : "warning"} label={item.priority} /></td>
              <td><strong>{item.title}</strong><span className={styles.subtext}>{item.detail}</span></td>
              <td><Link className={styles.primaryLink} href={item.kind === "repository" ? reposHref :
                item.kind === "approval" ? releaseHref : evalHref}>Inspect</Link></td>
            </tr>)}</tbody>
          </table></UiV2TableViewport>}
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><h2>In flight</h2><Link href={evalHref}>All runs</Link></div>
        {live.phase === "loading" ? <p className={styles.message} role="status">Loading evaluation activity…</p> :
          live.dashboard === null ? <UiV2EmptyState message="Evaluation activity unavailable." /> :
          inFlight.length === 0 ? <UiV2EmptyState message="No observed evaluations currently running." /> :
          <ul className={styles.rows}>{inFlight.slice(0, 8).map(run => <li key={run.id}>
            <div><Link className={styles.primaryLink} href={buildTenantAwareAppPath(pathname,
              `/evaluations/${encodeURIComponent(run.id)}`) as Route}>{run.skill}</Link>
              <span className={styles.subtext}>{run.ref} · {run.passed + run.failed}/{run.cases} cases reported</span></div>
            <UiV2Status state="running" label="Running" />
          </li>)}</ul>}
      </section>
    </div>

    <div className={styles.referenceColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><h2>Evaluation coverage by tier</h2><Link href={evalHref}>Suites</Link></div>
        {live.dashboard ? <div className={styles.tierBars}>
          {live.dashboard.coverageByTier.map(tier => <div className={styles.tierBarRow} key={tier.tier}>
            <strong>Tier {tier.tier}</strong>
            <div className={styles.tierBarTrack}><i style={{width:`${Math.max(0,Math.min(100,
              Number.isFinite(tier.coveragePct) ? tier.coveragePct : 0))}%`}} /></div>
            <span>{tier.evaluatedSkills}/{tier.totalSkills}</span>
          </div>)}
          <p className={styles.subtext}>Coverage is not a quality score; historical quality trends need a separate observed source.</p>
          {medianPass && Number.isFinite(medianPass.value) ? <p className={styles.subtext}>
            Median case pass rate: {medianPass.value}{medianPass.unit ?? ""}
          </p> : null}
        </div> : <UiV2EmptyState message="No qualified tier coverage evidence available." />}
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><h2>Activity</h2><Link href={auditHref}>Audit log</Link></div>
        {overview.auditHighlights.length === 0 ? <UiV2EmptyState message="No recorded audit activity." /> :
          <ul className={styles.rows}>{overview.auditHighlights.slice(0, 8).map((event,index) =>
            <li key={index}><div><strong>{event.action}</strong>
              <span className={styles.subtext}>{event.who} · {event.target}</span></div>
              <time className={styles.mono}>{event.when}</time></li>)}</ul>}
      </section>
    </div>

    <section className={styles.panel}>
      <div className={styles.panelHeading}><h2>Skill health</h2><Link href={skillHref}>Open Library</Link></div>
      {live.skills === null ? <UiV2EmptyState message="Authorized skill-health inventory not available." /> :
        live.skills.length === 0 ? <UiV2EmptyState message="No governed skills indexed." /> :
        <UiV2TableViewport label="Observed skill health"><table className={styles.table}>
          <thead><tr><th>Skill</th><th>Tier</th><th>Quality</th><th>Status</th><th>Last eval</th><th>Source revision</th></tr></thead>
          <tbody>{live.skills.slice(0, 25).map(skill => <tr key={skill.skillUuid}>
            <td><Link className={styles.primaryLink} href={buildTenantAwareAppPath(pathname,
              `/skills/${encodeURIComponent(skill.skillUuid)}`) as Route}>{skill.name}</Link></td>
            <td>Tier {skill.tier}</td>
            <td className={styles.mono}>{skill.score !== null && Number.isFinite(skill.score)
              ? skill.score.toFixed(1) : "Not available"}</td>
            <td>{skill.status}</td><td>{skill.lastEval || "Not available"}</td>
            <td className={styles.mono}>{skill.projection.sourceCommitSha ?? "Not indexed"}</td>
          </tr>)}</tbody>
        </table></UiV2TableViewport>}
    </section>
  </div>;
}
