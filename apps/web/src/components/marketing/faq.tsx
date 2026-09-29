import type { ReactNode } from "react";

const ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: "Does Savant store our skill content?",
    a: "No. Your Git repository is the source of truth. Savant references commits and runs evaluations against them, but prompts, runbooks, and agent workflows stay in your environment.",
  },
  {
    q: "Which Git providers do you support?",
    a: "GitHub Cloud and Enterprise, GitLab Cloud and self-managed, Azure DevOps, Bitbucket Cloud and Data Center, and other Git deployments over SSH or HTTPS.",
  },
  {
    q: "What does an eval suite look like?",
    a: "A rubric and a case set, both checked into the repository. Savant scores each candidate with the model you choose, surfaces regressions against the baseline, and keeps results for the life of the release.",
  },
  {
    q: "Does Savant change skills on its own?",
    a: "No. Savant proposes improvements from run evidence and validates each candidate against the regression suite, but only authorized reviewers approve. An approved change becomes a new Git version and follows your existing release policy.",
  },
  {
    q: "How does authentication work?",
    a: "Auth0 by default, or bring your own identity provider over SAML or OIDC. Group membership drives RBAC, and SCIM keeps it in lockstep with your directory.",
  },
  {
    q: "What happens if a release regresses?",
    a: "Auto-pin on regression is a default policy: the prior version pins immediately, an incident opens, and the skill owner is notified. Manual rollback is one click.",
  },
  {
    q: "Do you offer a free trial?",
    a: "Yes. Every workspace starts with a 14-day trial with all workflows enabled. Cancel during the trial and you are not charged; after it, billing is per seat, monthly or annually.",
  },
];

export function FAQ() {
  return (
    <section className="section section-alt" id="faq" data-nav="pricing" aria-labelledby="faq-title">
      <div className="shell faq">
        <div className="faq-side" data-reveal>
          <div className="sh-meta">
            <span className="sh-index">09</span>
            <span className="sh-label">Questions</span>
          </div>
          <h2 id="faq-title" className="display-3">
            What teams ask before they connect a repository.
          </h2>
          <p>
            Something else? Email{" "}
            <a className="text-link" href="mailto:hello@savant.app">
              hello@savant.app
            </a>
            . We reply within a day.
          </p>
        </div>
        <div className="faq-list" data-reveal data-reveal-delay="1">
          {ITEMS.map((item) => (
            <details key={item.q} className="faq-item" data-track="faq_expand" data-track-question={item.q}>
              <summary>
                <span>{item.q}</span>
                <span className="faq-glyph" aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
