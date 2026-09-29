import Link from "next/link";

import { SiteFrame } from "@/components/marketing/site-frame";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";

export const metadata = {
  title: "Docs",
  description: "Get started with Savant: connect a repository, evaluate, approve, release, distribute, audit, and improve skills.",
};

const GUIDES = [
  {
    id: "connect",
    title: "Connect a repository",
    body: "Point Savant at the Git repository where your skills live — GitHub, GitLab, Azure DevOps, Bitbucket, or any Git host over SSH or HTTPS. Webhook sync registers each change as a candidate.",
  },
  {
    id: "evaluate",
    title: "Evaluate",
    body: "Check a rubric and a case set into the repository next to each skill. Savant scores every candidate with the model you choose and compares it with the current baseline.",
  },
  {
    id: "approve",
    title: "Approve",
    body: "Approval tiers and required reviewers are defined in policy. Owners, reviewers, and compliance act on one timeline for each candidate.",
  },
  {
    id: "release",
    title: "Release",
    body: "Approved versions are promoted draft → staging → production. Release records are signed and pinned to evaluated content; a regression pins the prior version automatically.",
  },
  {
    id: "distribute",
    title: "Distribute",
    body: "Released skills reach tools through native integrations or the managed sync agent for developer environments, and each surface reports the version it runs.",
  },
  {
    id: "audit",
    title: "Audit",
    body: "Every change, approval, release, and access event is recorded append-only and can be exported to your SIEM.",
  },
  {
    id: "improvement",
    title: "Improve",
    body: "Instrumented runtimes report skill runs. Savant measures outcomes, clusters failures, and proposes bounded improvements. Each candidate is validated against validation, regression, and holdout sets before a person reviews it; approval creates a new Git version that follows your release policy.",
  },
];

export default async function DocsPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);

  return (
    <SiteFrame signedIn={viewer.isAuthenticated} current="docs">
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
