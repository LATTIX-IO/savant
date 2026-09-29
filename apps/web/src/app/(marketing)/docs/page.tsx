import Link from "next/link";

import { SiteFrame } from "@/components/marketing/site-frame";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd, buildDocsJsonLd, resolveSiteOrigin } from "@/lib/seo";
import { buildPublicPageMetadata } from "@/lib/seo-metadata";
import { DOCS_GUIDES } from "@/lib/marketing-content";

export const metadata = buildPublicPageMetadata("/docs");

const GUIDES = DOCS_GUIDES;

export default async function DocsPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);

  const origin = resolveSiteOrigin();

  return (
    <SiteFrame signedIn={viewer.isAuthenticated} current="docs">
      <JsonLd data={buildBreadcrumbJsonLd(origin, [{ name: "Docs", path: "/docs" }])} />
      <JsonLd data={buildDocsJsonLd(origin)} />
      <section className="page-hero" aria-labelledby="docs-title">
        <div className="shell">
          <div className="sh-meta">
            <span className="sh-index">Docs</span>
            <span className="sh-label">Getting started</span>
          </div>
          <h1 id="docs-title" className="display-1">
            From repository to <em>release</em>.
          </h1>
          <p className="page-lede">
            The core concepts behind Savant, in the order your first skill moves through them.
          </p>
        </div>
      </section>

      <section className="section page-body" aria-label="Guides">
        <div className="shell doc">
          <nav className="doc-toc" aria-label="On this page">
            <ul>
              {GUIDES.map((guide) => (
                <li key={guide.id}>
                  <a href={`#${guide.id}`}>{guide.title}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="doc-body">
            {GUIDES.map((guide, index) => (
              <article key={guide.id} id={guide.id} className="doc-section">
                <span className="doc-num">{String(index + 1).padStart(2, "0")}</span>
                <h2 className="display-3">{guide.title}</h2>
                <p>{guide.body}</p>
              </article>
            ))}
            <div className="section-cta">
              <Link
                href={viewer.isAuthenticated ? "/dashboard" : "/signup"}
                className="btn btn-primary btn-lg"
                data-track="cta_click"
                data-track-placement="docs"
              >
                Connect your first repository
              </Link>
            </div>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
