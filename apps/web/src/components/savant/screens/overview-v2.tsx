"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import type { OverviewKpi, OverviewPayload, SourceOfTruth } from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { useOnboarding } from "@/components/savant/onboarding-context";
import {
  UiV2Button, UiV2EmptyState, UiV2Metric, UiV2Status, UiV2TableViewport,
} from "@/components/savant/ui-v2";
import { getUiV2Kpi, safeUiV2Count, getUiV2RepositoryHealth } from "@/lib/ui-v2-library-model";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import styles from "./ui-v2-pages.module.css";

const kpiKeys: ReadonlyArray<OverviewKpi["key"]> = [
  "skills-in-production", "eval-coverage", "first-pass-acceptance", "release-turnaround",
];
const kpiLabels: Record<OverviewKpi["key"], string> = {
  "skills-in-production": "Skills in production",
  "eval-coverage": "Evaluation coverage",
  "first-pass-acceptance": "First-pass acceptance",
  "release-turnaround": "Release turnaround",
};

export function OverviewV2({ overview, sourceOfTruth }: {
  overview: OverviewPayload; sourceOfTruth?: SourceOfTruth | undefined;
}) {
  const pathname = usePathname() || "/";
  const { show } = useOnboarding();
  const skillsHref = buildTenantAwareAppPath(pathname, "/skills") as Route;
  const repositoryHref = buildTenantAwareAppPath(pathname, "/repositories") as Route;
  const evaluationsHref = buildTenantAwareAppPath(pathname, "/evaluations") as Route;
  const releasesHref = buildTenantAwareAppPath(pathname, "/releases") as Route;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>Overview / Workspace health</div>
          <h1>Operational overview</h1>
          <p>Evidence from this workspace&apos;s control plane. Unavailable signals are not estimated.</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.secondaryLink} href={skillsHref}>Open Library</Link>
          <UiV2Button variant="primary" onClick={show}>Connect repository</UiV2Button>
        </div>
      </div>

      {sourceOfTruth ? <p className={styles.provenance}>Data source: {sourceOfTruth}</p> : null}

      <div className={styles.metrics}>
        <UiV2Metric label="Governed skills" value={safeUiV2Count(overview.counts.skillsUnderGovernance)} />
        <UiV2Metric label="Pending approvals" value={safeUiV2Count(overview.counts.pendingApprovals)} />
        <UiV2Metric label="Regression alerts" value={safeUiV2Count(overview.counts.activeRegressionAlerts)} />
        <UiV2Metric label="Connected repositories" value={safeUiV2Count(overview.counts.connectedRepositories)} />
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}><h2>Quality signals</h2><Link href={evaluationsHref}>View evaluations</Link></div>
        <div className={styles.kpis}>
          {kpiKeys.map(key => {
            const kpi = getUiV2Kpi(overview, key);
            return <div className={styles.kpi} key={key}>
              <UiV2Metric label={kpi?.label || kpiLabels[key]}
                value={kpi ? `${kpi.value}${kpi.unit ?? ""}` : null} />
              <span className={styles.subtext}>{kpi?.deltaLabel || "No recorded trend"}</span>
            </div>;
          })}
        </div>
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Awaiting approval</h2><Link href={skillsHref}>View skills</Link></div>
          {overview.approvals.length === 0 ? (
            <UiV2EmptyState message="No approvals currently pending in this workspace." />
          ) : (
            <UiV2TableViewport label="Pending skill approvals">
              <table className={styles.table}>
                <thead><tr><th>Skill</th><th>Version</th><th>Blocking gate</th><th>Requested</th></tr></thead>
                <tbody>{overview.approvals.map(item => (
                  <tr key={`${item.id}-${item.version}`}>
                    <td><Link className={styles.primaryLink}
                      href={buildTenantAwareAppPath(pathname, `/skills/${encodeURIComponent(item.id)}`) as Route}>
                      {item.skill}</Link><span className={styles.subtext}>{item.change}</span></td>
                    <td className={styles.mono}>{item.version}</td>
                    <td><UiV2Status state="warning" label={item.blocking} /></td>
                    <td>{item.when}</td>
                  </tr>
                ))}</tbody>
              </table>
            </UiV2TableViewport>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Regression alerts</h2><Link href={evaluationsHref}>Investigate</Link></div>
          {overview.regressions.length === 0 ? (
            <UiV2EmptyState message="No regression alerts currently recorded." />
          ) : <ul className={styles.rows}>
            {overview.regressions.map((item, index) => (
              <li key={`${item.skill}-${item.metric}-${index}`}>
                <div><strong>{item.skill}</strong><span className={styles.subtext}>{item.metric} · {item.from}{item.unit ?? ""} → {item.to}{item.unit ?? ""}</span></div>
                <UiV2Status state={item.severity === "critical" ? "failed" : "warning"} label={item.severity} />
              </li>
            ))}
          </ul>}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Source repositories</h2><Link href={repositoryHref}>Manage</Link></div>
          {overview.repositories.length === 0 ? (
            <UiV2EmptyState message="No repositories connected to this workspace." />
          ) : <ul className={styles.rows}>
            {overview.repositories.slice(0, 6).map(item => {
              const health = getUiV2RepositoryHealth(item);
              return <li key={item.id}>
                <div><strong>{item.name}</strong><span className={styles.subtext}>
                  {item.provider} · {item.projection.indexedAt ? "Indexed" : "Not indexed"}
                </span></div>
                <UiV2Status state={health === "ready" ? "ready" : health === "action-required" ? "warning" :
                  health === "indexing" ? "running" : "unavailable"}
                  label={health === "action-required" ? "Attention" : health === "not-indexed" ? "Not indexed" : health} />
              </li>;
            })}
          </ul>}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Recent changes and releases</h2><Link href={releasesHref}>View releases</Link></div>
          {overview.recentChanges.length === 0 && overview.releaseQueue.length === 0 ? (
            <UiV2EmptyState message="No recent changes or queued releases in this workspace." />
          ) : <ul className={styles.rows}>
            {overview.recentChanges.slice(0, 4).map((item, index) => (
              <li key={`change-${index}`}>
                <div><strong>{item.skill}</strong><span className={styles.subtext}>Commit {item.ref} · {item.who}</span></div>
                <span className={styles.mono}>{item.when}</span>
              </li>
            ))}
            {overview.releaseQueue.slice(0, 4).map(item => (
              <li key={`release-${item.id}`}>
                <div><strong>{item.skill}</strong><span className={styles.subtext}>
                  Release to {item.toEnv} · approvals {item.approvalsDone}/{item.approvalsRequired}
                </span></div>
                <UiV2Status state={item.approvalsBlocked ? "warning" : "running"}
                  label={item.approvalsBlocked ? "Blocked" : "In queue"} />
              </li>
            ))}
          </ul>}
        </section>
      </div>
      <p className={styles.help}><Ic.Lock className={styles.icon} aria-hidden="true" />
        The control plane and workspace membership determine access; this screen never authorizes changes.
      </p>
    </div>
  );
}
