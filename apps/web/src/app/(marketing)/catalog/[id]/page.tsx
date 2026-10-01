import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TRUST_LABEL, VERDICT_HINT, VERDICT_LABEL, popularityLabel } from "@/components/catalog/catalog-labels";
import { EvalLimitationsNote, SafetyBreakdown } from "@/components/catalog/safety-breakdown";
import { SiteFrame } from "@/components/marketing/site-frame";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { getCatalogSkill, type CatalogSkillDetail } from "@/server/hub/catalog-read";

import "../catalog.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

async function load(id: string): Promise<CatalogSkillDetail | null> {
  try {
    const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
    return await getCatalogSkill(getControlPlaneDatabase(), id);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const skill = await load((await params).id);
  if (!skill) return { title: "Skill not found" };
  const description = (skill.description ?? `${skill.name} from ${skill.sourceName}`).slice(0, 160);
  return {
    title: `${skill.name} · Skill catalog`,
    description,
    alternates: { canonical: `/catalog/${skill.id}` },
    openGraph: { title: `${skill.name} · Savant skill catalog`, description, url: `/catalog/${skill.id}` },
  };
}

const pct = (value: number | undefined) => (value === undefined ? "—" : Math.round(value));

export default async function CatalogSkillPage({ params }: { params: Params }) {
  const skill = await load((await params).id);
  if (!skill) notFound();
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);
  const scorecard = skill.evaluation?.scorecard;
  const metrics = skill.evaluation?.metrics;

  return (
    <SiteFrame signedIn={viewer.isAuthenticated} current="catalog">
      <section className="page-hero" aria-labelledby="skill-title">
        <div className="shell">
          <div className="sh-meta">
            <Link href={"/catalog" as Route} className="sh-index">Catalog</Link>
            <span className="sh-label">{skill.sourceName}{skill.publisher ? ` · ${skill.publisher}` : ""}</span>
          </div>
          <h1 id="skill-title" className="display-1" style={{ overflowWrap: "anywhere", fontSize: "clamp(2rem, 5vw, 3.4rem)" }}>{skill.name}</h1>
          {skill.description && <p className="page-lede">{skill.description}</p>}
          <div className="cat-meta" style={{ marginTop: 16, fontSize: 13 }}>
            <span className="cat-badge" data-verdict={skill.verdict}>{VERDICT_LABEL[skill.verdict]}</span>
            <span className="cat-badge" data-trust={skill.trust}>{TRUST_LABEL[skill.trust]}</span>
            {popularityLabel(skill.popularity) && <span>{popularityLabel(skill.popularity)}</span>}
            {skill.alsoOn.length > 0 && <span>also listed on {skill.alsoOn.join(", ")}</span>}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
            <Link href={(viewer.isAuthenticated ? "/dashboard" : "/signup") as Route} className="btn btn-primary">
              {viewer.isAuthenticated ? "Import from your workspace" : "Import into your workspace"}
            </Link>
            {skill.sourceUrl && <a href={skill.sourceUrl} className="btn btn-quiet" target="_blank" rel="noopener noreferrer">View at source</a>}
          </div>
        </div>
      </section>

      <section className="section page-body" aria-label="Skill analysis">
        <div className="shell cat-detail">
          <div style={{ minWidth: 0 }}>
            <div className="cat-panel">
              <h2>Savant verdict: {VERDICT_LABEL[skill.verdict]}</h2>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>{VERDICT_HINT[skill.verdict]}</p>
            </div>

            <div className="cat-panel">
              <h2>Live evaluation</h2>
              {scorecard?.overallScore !== undefined ? (
                <>
                  <div className="cat-scores">
                    <div><strong>{pct(scorecard.overallScore)}</strong>overall</div>
                    <div><strong>{pct(scorecard.qualityScore)}</strong>quality</div>
                    <div><strong>{pct(scorecard.complianceScore)}</strong>compliance</div>
                    <div><strong>{pct(scorecard.groundingScore)}</strong>grounding</div>
                    <div><strong>{pct(scorecard.actionabilityScore)}</strong>actionability</div>
                    <div><strong>{pct(scorecard.efficiencyScore)}</strong>efficiency</div>
                  </div>
                  <div style={{ margin: "0 0 12px" }}><EvalLimitationsNote limitations={skill.evaluation?.limitations} /></div>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)" }}>
                    {scorecard.passCount ?? 0} pass · {scorecard.investigateCount ?? 0} investigate · {scorecard.failCount ?? 0} fail across {scorecard.sampleCount ?? 0} cases.
                    {metrics?.drafted ? ` Jev accepted ${metrics.accepted ?? 0} of ${metrics.drafted} LLM-drafted cases.` : ""}
                    {skill.evaluation?.models?.judge ? ` Drafted and run by ${skill.evaluation.models.generator}, validated and scored by ${skill.evaluation.models.judge}.` : ""}
                  </p>
                  {skill.evaluation?.cases && skill.evaluation.cases.length > 0 && (
                    <ul className="cat-list">
                      {skill.evaluation.cases.filter((item) => item.verdict).slice(0, 8).map((item) => (
                        <li key={item.caseId}>
                          {item.prompt}
                          <small>{item.kind} case · {item.verdict}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-muted)" }}>
                  {skill.evalStatus === "queued" || skill.evalStatus === "running" ? "A live evaluation is running." : skill.evalStatus === "failed" ? `The last live evaluation didn't complete${skill.evalError ? `: ${skill.evalError}` : "."}` : "Not evaluated yet. Workspaces can request a live evaluation."}
                </p>
              )}
            </div>

            <div className="cat-panel">
              <h2>Safety (NVIDIA SkillSpector)</h2>
              {skill.safety && skill.safety.status === "complete" ? (
                <>
                  <div style={{ marginBottom: 12 }}><SafetyBreakdown safety={skill.safety} /></div>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)" }}>{skill.safety.issues.length} pattern{skill.safety.issues.length === 1 ? "" : "s"} found</p>
                  {skill.safety.issues.length > 0 && (
                    <ul className="cat-list">
                      {skill.safety.issues.slice(0, 10).map((issue, index) => (
                        <li key={`${issue.id}-${index}`}>
                          {issue.category}: {issue.title}
                          <small>{issue.severity.toLowerCase()}{issue.file ? ` · ${issue.file}${issue.line ? `:${issue.line}` : ""}` : ""}{issue.explanation ? ` · ${issue.explanation}` : ""}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-muted)" }}>{skill.safety?.status === "unavailable" ? "Safety scanning is temporarily unavailable." : "Scan pending."}</p>
              )}
            </div>

            {skill.findings.length > 0 && (
              <div className="cat-panel">
                <h2>Structure</h2>
                <ul className="cat-list">
                  {skill.findings.map((finding) => (
                    <li key={finding.code}>{finding.title}<small>{finding.detail}</small></li>
                  ))}
                </ul>
              </div>
            )}

            <div className="cat-panel">
              <h2>SKILL.md</h2>
              {skill.skillMd ? <pre className="cat-source">{skill.skillMd}</pre> : <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-muted)" }}>This listing is enumerated but its package hasn&apos;t been fetched yet; it&apos;s queued by popularity.</p>}
            </div>
          </div>

          <aside>
            <div className="cat-panel">
              <h2>Details</h2>
              <dl className="cat-kv">
                <dt>Source</dt><dd>{skill.sourceName}</dd>
                {skill.publisher && <><dt>Publisher</dt><dd>{skill.publisher}</dd></>}
                {skill.repository && <><dt>Repository</dt><dd>{skill.repository}</dd></>}
                {skill.path && <><dt>Path</dt><dd>{skill.path}</dd></>}
                <dt>Version</dt><dd>{skill.version ?? "—"}</dd>
                <dt>License</dt><dd>{skill.license ?? "Not declared"}</dd>
                <dt>Files</dt><dd>{skill.fileCount}</dd>
                <dt>Updated</dt><dd>{new Date(skill.updatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</dd>
              </dl>
            </div>
            <div className="cat-panel">
              <h2>Package</h2>
              <ul className="cat-list">
                {skill.files.slice(0, 40).map((file) => <li key={file.path} style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{file.path}<small>{(file.size / 1024).toFixed(1)} KB</small></li>)}
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </SiteFrame>
  );
}
