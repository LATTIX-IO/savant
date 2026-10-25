import Link from "next/link";

import { SiteFrame } from "@/components/marketing/site-frame";
import { JsonLd } from "@/components/seo/json-ld";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { getSeoGuide, type GuidePath } from "@/lib/seo-guides";
import { buildBreadcrumbJsonLd, buildGuideJsonLd, resolveSiteOrigin } from "@/lib/seo";

/** The same guide data feeds visible answers, structured data, and llms-full.txt. */
export async function SeoGuidePage({ guidePath }: { guidePath: GuidePath }) {
  const guide = getSeoGuide(guidePath);
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);
  const origin = resolveSiteOrigin();

  return (
    <SiteFrame signedIn={viewer.isAuthenticated}>
      <JsonLd data={buildBreadcrumbJsonLd(origin, [{ name: guide.title, path: guide.path }])} />
      <JsonLd data={buildGuideJsonLd(origin, guide)} />
      <section className="page-hero" aria-labelledby="guide-title">
        <div className="shell">
          <div className="sh-meta"><span className="sh-index">Savant</span><span className="sh-label">{guide.eyebrow}</span></div>
          <h1 id="guide-title" className="display-1">{guide.headline}</h1>
          <p className="page-lede">{guide.lede}</p>
          <p className="section-cta-note" style={{ marginTop: 20 }}>Published <time dateTime={guide.published}>{guide.published}</time> · Lattix Technologies Corp.</p>
        </div>
      </section>
      <section className="section page-body" aria-label={guide.title}>
        <div className="shell doc">
          <nav className="doc-toc" aria-label="On this page">
            <ul>
              {guide.sections.map((section) => <li key={section.id}><a href={"#" + section.id}>{section.heading}</a></li>)}
              <li><a href="#questions">Frequently asked questions</a></li>
            </ul>
          </nav>
          <div className="doc-body">
            {guide.sections.map((section) => (
              <article className="doc-section" id={section.id} key={section.id}>
                <h2 className="display-3">{section.heading}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                <ul className="doc-points">{section.bullets.map((point) => <li key={point}>{point}</li>)}</ul>
              </article>
            ))}
            <section className="doc-section" id="questions" aria-labelledby="questions-title">
              <h2 className="display-3" id="questions-title">Frequently asked questions</h2>
              {guide.faq.map((item) => (
                <div key={item.question} style={{ marginTop: 22 }}>
                  <h3 style={{ fontWeight: 600, marginBottom: 8 }}>{item.question}</h3>
                  <p>{item.answer}</p>
                </div>
              ))}
            </section>
            <nav className="doc-section" aria-label="Related guidance">
              <h2 className="display-3">Continue exploring</h2>
              <ul className="doc-points">
                {guide.related.map((related) => <li key={related.path}><Link href={related.path} className="text-link">{related.label}</Link></li>)}
              </ul>
            </nav>
            <div className="section-cta">
              <Link className="btn btn-primary btn-lg" href={viewer.isAuthenticated ? "/dashboard" : "/signup"} data-track="cta_click" data-track-placement="guide">Start with Savant</Link>
              <Link className="link-arrow" href="/docs">Read the documentation</Link>
            </div>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
