import { SiteFrame } from "@/components/marketing/site-frame";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";

export const metadata = {
  title: "Security",
  description:
    "How Savant protects governed skills: identity and access, Git provenance, signed releases, immutable audit, tenant isolation, and bounded improvement.",
};

const SECTIONS = [
  {
    id: "identity",
    title: "Identity and access",
    points: [
      "Single sign-on through Auth0 by default, or your own identity provider over OIDC or SAML.",
      "SCIM provisioning keeps members and groups aligned with your directory.",
      "Role-based access control; approval tiers and reviewers are defined in policy.",
    ],
  },
  {
    id: "data",
    title: "Data handling",
    points: [
      "Your Git repository remains the source of truth for skill content.",
      "Savant stores references to commits, evaluation results, release records, and audit events.",
      "Workspaces are tenant-isolated; access is always scoped to one workspace.",
    ],
  },
  {
    id: "provenance",
    title: "Provenance and release control",
    points: [
      "Every skill version resolves to a commit, and every release to evaluated content.",
      "Release records are signed; promotion runs draft → staging → production under policy.",
      "Auto-pin on regression holds the prior version; rollback is one action.",
    ],
  },
  {
    id: "audit",
    title: "Audit",
    points: [
      "Changes, approvals, releases, and access events are recorded append-only.",
      "Audit events can be exported to your SIEM.",
    ],
  },
  {
    id: "improvement",
    title: "Bounded improvement",
    points: [
      "Run telemetry is redacted and pseudonymized before analysis; capture level follows your tenant setting.",
      "The optimization worker holds no database, Git, or release credentials.",
      "Locked sections of a skill cannot be read or changed by the optimizer.",
      "Only authorized people approve a recommendation. There is no autonomous deployment mode.",
    ],
  },
];

export default async function SecurityPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);

  return (
    <SiteFrame signedIn={viewer.isAuthenticated} current="security">
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
