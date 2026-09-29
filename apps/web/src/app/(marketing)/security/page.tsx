import { SiteFrame } from "@/components/marketing/site-frame";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd, resolveSiteOrigin } from "@/lib/seo";
import { buildPublicPageMetadata } from "@/lib/seo-metadata";
import { SECURITY_SECTIONS } from "@/lib/marketing-content";

export const metadata = buildPublicPageMetadata("/security");

const SECTIONS = SECURITY_SECTIONS;

export default async function SecurityPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);

  const origin = resolveSiteOrigin();

  return (
    <SiteFrame signedIn={viewer.isAuthenticated} current="security">
      <JsonLd data={buildBreadcrumbJsonLd(origin, [{ name: "Security", path: "/security" }])} />
      <section className="page-hero" aria-labelledby="security-title">
        <div className="shell">
          <div className="sh-meta">
            <span className="sh-index">Trust</span>
            <span className="sh-label">Security architecture</span>
          </div>
          <h1 id="security-title" className="display-1">
            Governance you can <em>verify</em>.
          </h1>
          <p className="page-lede">
            Savant is built so every skill can be traced to its source, every release to its
            evidence, and every change to a person who approved it.
          </p>
        </div>
      </section>

      <section className="section page-body" aria-label="Security controls">
        <div className="shell doc">
          <nav className="doc-toc" aria-label="On this page">
            <ul>
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="doc-body">
            {SECTIONS.map((section) => (
              <article key={section.id} id={section.id} className="doc-section">
                <h2 className="display-3">{section.title}</h2>
                <ul className="doc-points">
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
            <article id="report" className="doc-section">
              <h2 className="display-3">Reporting a vulnerability</h2>
              <p>
                Email{" "}
                <a className="text-link" href="mailto:security@savant.app">
                  security@savant.app
                </a>
                . For security questionnaires, a DPA, or architecture reviews during procurement,
                contact{" "}
                <a className="text-link" href="mailto:sales@savant.app" data-track="sales_cta" data-track-placement="security">
                  sales@savant.app
                </a>
                .
              </p>
            </article>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
