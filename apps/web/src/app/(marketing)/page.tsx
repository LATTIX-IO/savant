import Link from "next/link";

import { Ic } from "@/components/savant/icons";
import { ProvenanceRail } from "@/components/savant/primitives";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { PricingCard } from "@/components/marketing/pricing-card";
import { MarketingNav } from "@/components/marketing/marketing-nav";

export const metadata = {
  title: "Savant — Skills, governed",
  description:
    "The control plane for skill platforms. Codify expertise as governed, measurable, reusable skills with auditable provenance from repo to release.",
};

export default async function LandingPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);

  return (
    <>
      <MarketingNav signedIn={viewer.isAuthenticated} />

      <section className="marketing-section hero">
        <div className="marketing-inner">
          <div className="hero-grid">
            <div>
              <div className="marketing-eyebrow">/00 — Savant Platform</div>
              <h1>
                Skills, <em>governed.</em>
                <br />
                From repo to release.
              </h1>
              <p className="hero-sub">
                Savant is the control plane for skill platforms. Codify expertise as
                governed, measurable, reusable skills — with auditable provenance from
                the commit that wrote them to the moment they ship.
              </p>
              <div className="hero-ctas">
                {viewer.isAuthenticated ? (
                  <Link href="/dashboard" className="btn btn-primary btn-lg">
                    <span>Go to dashboard</span>
                    <Ic.ChevR className="b-icon" />
                  </Link>
                ) : (
                  <Link href="/signup" className="btn btn-primary btn-lg">
                    <span>Start free</span>
                    <Ic.ChevR className="b-icon" />
                  </Link>
                )}
                <Link href="#how-it-works" className="btn btn-ghost btn-lg">
                  See how it works
                </Link>
              </div>
            </div>

            <div className="hero-side">
              <div className="marketing-eyebrow" style={{ marginBottom: 12 }}>
                Provenance rail
              </div>
              <ProvenanceRail
                steps={[
                  {
                    label: "Repository",
                    value: "wh/legal-skills",
                    meta: <span className="mono subtle">github · main</span>,
                    state: "ok",
                  },
                  {
                    label: "Reference",
                    value: "v2.4.0-rc.2",
                    meta: <span className="mono subtle">8a31cf2</span>,
                    state: "ok",
                  },
                  {
                    label: "Evaluation",
                    value: "248 cases · 6 flagged",
                    meta: <span className="muted">94% pass</span>,
                    state: "warn",
                  },
                  {
                    label: "Approval",
                    value: "2 of 3 approved",
                    meta: <span className="muted">awaiting compliance</span>,
                    state: "now",
                  },
                  {
                    label: "Release",
                    value: "Staged · v2.3.7",
                    meta: <span className="muted">pinned 2d</span>,
                    state: "ok",
                  },
                ]}
              />
              <div className="hero-side-cap">
                <span>commit → release</span>
                <span>fully auditable</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stats-strip">
        <div className="stat">
          <div className="stat-value">218</div>
          <div className="stat-label">Skills under governance</div>
        </div>
        <div className="stat">
          <div className="stat-value">94%</div>
          <div className="stat-label">Eval coverage</div>
        </div>
        <div className="stat">
          <div className="stat-value">2.4d</div>
          <div className="stat-label">Release turnaround</div>
        </div>
        <div className="stat">
          <div className="stat-value">7yr</div>
          <div className="stat-label">Audit retention</div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-inner">
          <div className="marketing-eyebrow">/01 — Why Savant</div>
          <div className="problem-solution">
            <div className="panel-narrative">
              <h2>Skills are scattered, evaluated by hand, and shipped on trust.</h2>
              <p>
                Teams hand-roll prompts, runbooks, and agent workflows across repos,
                Notion docs, and Slack threads. Nothing is versioned. Nothing is measured.
                When something regresses in production, there&apos;s no breadcrumb back to
                the change that caused it.
              </p>
              <ul>
                <li>No standard place for skill content to live</li>
                <li>Approvals happen over chat, not in a system of record</li>
                <li>Regressions surface as customer complaints, not eval flags</li>
                <li>No clean rollback path when a release goes sideways</li>
              </ul>
            </div>
            <div className="panel-narrative solution">
              <h2>Savant is the system of record for governed skills.</h2>
              <p>
                Your Git repository is the source of truth. Savant ingests skill content,
                runs evaluation suites against every candidate, routes approvals to the
                right reviewers, and ships signed bundles to the agents and IDEs that
                consume them — with provenance from commit to release.
              </p>
              <ul>
                <li>Every skill versioned, tiered, and traceable to a commit</li>
                <li>Approvals codified as policy, enforced at release time</li>
                <li>Evaluations on every candidate; regressions surface immediately</li>
                <li>One-click rollback; full audit trail kept for 7 years</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-inner">
          <div className="marketing-eyebrow">/02 — The Platform</div>
          <div className="features-head">
            <h2>Everything a governed skill platform needs, in one calm surface.</h2>
            <p>
              Six primitives working together: repositories as the source of truth,
              evaluations as the truth-keeper, approvals as the gate, releases as the
              moment of commitment, audit as the receipt, connectors as the reach.
            </p>
          </div>

          <div className="feature-grid">
            <Feature
              icon={<Ic.Repo style={{ width: 16, height: 16 }} />}
              title="Source repositories"
              body="Connect GitHub, GitLab, Azure DevOps, or Bitbucket. Savant treats your repo as the source of truth — never copies skill content, only references it."
            />
            <Feature
              icon={<Ic.Eval style={{ width: 16, height: 16 }} />}
              title="Evaluations"
              body="Every candidate runs against a rubric the moment it lands. Regressions are flagged before the approval round even starts."
            />
            <Feature
              icon={<Ic.Policy style={{ width: 16, height: 16 }} />}
              title="Approvals & policy"
              body="Tier-based policies decide who approves what. Owner, security, compliance — codified once, enforced everywhere."
            />
            <Feature
              icon={<Ic.Release style={{ width: 16, height: 16 }} />}
              title="Releases"
              body="Promote candidates through draft, staging, and production with a single, observable lifecycle rail. Rollback is one click."
            />
            <Feature
              icon={<Ic.Audit style={{ width: 16, height: 16 }} />}
              title="Audit"
              body="Immutable record of every governance event — approvals, releases, access changes, policy edits — exportable for compliance review."
            />
            <Feature
              icon={<Ic.Connectors style={{ width: 16, height: 16 }} />}
              title="Distribution"
              body="Approved skills flow to local sync agents, native integrations, notifications, and signed bundles for air-gapped environments."
            />
          </div>
        </div>
      </section>

      <section className="marketing-section" id="how-it-works">
        <div className="marketing-inner">
          <div className="marketing-eyebrow">/03 — How it works</div>
          <div className="steps-head">
            <h2>The provenance rail you saw above? That&apos;s the whole product.</h2>
          </div>
          <div className="steps">
            <Step
              n="01"
              title="Connect"
              body="Point Savant at your skill repository. Webhook sync keeps everything live."
            />
            <Step
              n="02"
              title="Evaluate"
              body="Candidates run against rubric-based evals. Regressions surface immediately."
            />
            <Step
              n="03"
              title="Approve"
              body="Owners, reviewers, and compliance act in a single approval timeline."
            />
            <Step
              n="04"
              title="Release"
              body="Promote through draft → staging → production. Signed bundles built automatically."
            />
            <Step
              n="05"
              title="Audit"
              body="Every event recorded immutably. Stream to SIEM. Retained for seven years."
            />
          </div>
        </div>
      </section>

      <section className="marketing-section pricing">
        <div className="marketing-inner">
          <div className="marketing-eyebrow">/04 — Pricing</div>
          <div className="features-head" style={{ marginBottom: 32 }}>
            <h2>One tier. Per seat. Annual saves you 17%.</h2>
            <p>
              No platform fee, no per-skill metering, no enterprise upcharge for SSO.
              Pay for the people who use the system; everything else is included.
            </p>
          </div>
          <PricingCard signedIn={viewer.isAuthenticated} />
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-inner">
          <div className="marketing-eyebrow">/05 — FAQ</div>
          <div className="faq">
            <div className="faq-side">
              <h2>Questions that come up a lot.</h2>
              <p>
                Still curious about something? Email{" "}
                <a className="link" href="mailto:hello@savant.app">
                  hello@savant.app
                </a>{" "}
                — we read every note and reply within a day.
              </p>
            </div>
            <div className="faq-list">
              <FaqItem q="Does Savant store our skill content?">
                No. Your Git repository is the source of truth. Savant references commits
                and runs evaluations against them, but the prompts, runbooks, and agent
                workflows themselves never leave your environment.
              </FaqItem>
              <FaqItem q="Which Git providers do you support?">
                GitHub Cloud and Enterprise, GitLab Cloud and self-managed, Azure DevOps,
                Bitbucket Cloud and Data Center, and any self-hosted Git over SSH or HTTPS.
              </FaqItem>
              <FaqItem q="What does an eval suite look like?">
                A rubric and a case set, both checked into the repo. Savant runs the rubric
                against each candidate using whichever model you point it at, surfaces
                regressions against the baseline, and stores results alongside the
                candidate for the life of the release.
              </FaqItem>
              <FaqItem q="How does authentication work?">
                Auth0 by default; bring your own IdP via SAML or OIDC. Group membership
                drives RBAC, and SCIM keeps things in lockstep with your directory.
              </FaqItem>
              <FaqItem q="Can we self-host?">
                Yes. The Enterprise plan ships a self-hosted control plane with the same
                feature set. Talk to us if you need on-prem or air-gapped.
              </FaqItem>
              <FaqItem q="What happens if a release regresses?">
                Auto-pin on regression is a default policy. The prior version pins
                immediately, an incident opens, and the skill owner is paged. Manual
                rollback is one click in the release dashboard.
              </FaqItem>
              <FaqItem q="Do you offer a free trial?">
                Every paid plan starts with a 14-day trial. Cancel any time during the
                trial and you&apos;re not charged. After the trial, billing is per seat per
                month or per year — you pick the cycle at signup.
              </FaqItem>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <div className="cta-banner-inner">
          <div>
            <h2>Bring your skill platform under governance today.</h2>
            <p>
              Connect a repo, watch the first evaluation run, and ship a release with
              full audit trail — all in under fifteen minutes.
            </p>
          </div>
          <div className="cta-banner-actions">
            {viewer.isAuthenticated ? (
              <Link href="/dashboard" className="btn btn-primary btn-lg">
                Open dashboard
                <Ic.ChevR className="b-icon" />
              </Link>
            ) : (
              <Link href="/signup" className="btn btn-primary btn-lg">
                Start free
                <Ic.ChevR className="b-icon" />
              </Link>
            )}
            <a href="mailto:hello@savant.app" className="btn btn-ghost btn-lg">
              Talk to sales
            </a>
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-footer-inner">
          <div className="brand-block">
            <span className="marketing-brand">
              <span className="marketing-brand-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="var(--ink)" strokeWidth="1.5" />
                  <path d="M7 12h10M7 8h10M7 16h6" stroke="var(--moss)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              Savant
            </span>
            <p>
              The control plane for skill platforms. Built for teams who ship governed
              expertise — not just code.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><a href="#how-it-works">How it works</a></li>
              <li><a href="#pricing">Pricing</a></li>
              <li><Link href="/signup">Sign up</Link></li>
            </ul>
          </div>
          <div>
            <h4>Company</h4>
            <ul>
              <li><a href="mailto:hello@savant.app">Contact</a></li>
              <li><a href="mailto:hello@savant.app">Careers</a></li>
              <li><a href="mailto:security@savant.app">Security</a></li>
            </ul>
          </div>
          <div>
            <h4>Legal</h4>
            <ul>
              <li><a href="#">Terms</a></li>
              <li><a href="#">Privacy</a></li>
              <li><a href="#">DPA</a></li>
            </ul>
          </div>
        </div>
        <div className="marketing-footer-base">
          <span>© {new Date().getFullYear()} Savant Platform, Inc.</span>
          <span className="mono">v1.0 · {new Date().toISOString().slice(0, 10)}</span>
        </div>
      </footer>
    </>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="feature">
      <span className="feature-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="step">
      <span className="step-num">/{n}</span>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="faq-item">
      <summary>{q}</summary>
      <p>{children}</p>
    </details>
  );
}
