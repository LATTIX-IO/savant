import Link from "next/link";

import { CapabilitySurface } from "@/components/marketing/capability-surface";
import { DistributionScene } from "@/components/marketing/distribution-scene";
import { HowItWorksRail } from "@/components/marketing/how-it-works-rail";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { PricingCard } from "@/components/marketing/pricing-card";
import { Ic } from "@/components/savant/icons";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";

const HERO_VIDEO_SRC =
  "https://cdn.coverr.co/videos/coverr-old-bible-covered-in-dust-9476/1080p.mp4";

export const metadata = {
  title: "Savant — The system of record for enterprise skills",
  description:
    "Turn expert knowledge into governed, shippable capability. From commit to release, every skill governed, evaluated, and traceable.",
};

export default async function LandingPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);

  return (
    <>
      <MarketingNav signedIn={viewer.isAuthenticated} />

      {/* ───── Hero ───── */}
      <section className="marketing-section hero no-border">
        <div className="hero-media" aria-hidden="true">
          <video
            className="hero-video"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          >
            <source
              media="(prefers-reduced-motion: no-preference)"
              src={HERO_VIDEO_SRC}
              type="video/mp4"
            />
          </video>
        </div>

        <div className="marketing-inner hero-shell">
          <div className="hero-copy">
            <div className="hero-copy-block">
              <div className="marketing-eyebrow hero-anim hero-anim-1">
                The Enterprise System of Record for Skills
              </div>
              <h1 className="hero-anim hero-anim-2">
                Skills, <span className="accent">governed.</span>
                <br />
                From repo to release.
              </h1>
              <p className="hero-sub hero-anim hero-anim-3">
                Savant is the control plane for skill platforms. Codify
                expertise as governed, measurable, reusable skills — with
                auditable provenance from the commit that wrote them to the
                moment they ship.
              </p>
              <div className="hero-ctas hero-anim hero-anim-4">
                {viewer.isAuthenticated ? (
                  <Link href="/dashboard" className="btn btn-primary btn-lg">
                    <span>Go to dashboard</span>
                    <Ic.ChevR className="b-icon" />
                  </Link>
                ) : (
                  <Link href="/signup" className="btn btn-primary btn-lg">
                    <span>Start 14-day free trial</span>
                    <Ic.ChevR className="b-icon" />
                  </Link>
                )}
                <a href="#how-it-works" className="btn btn-ghost btn-lg">
                  See how it works
                </a>
              </div>
              <div className="hero-microproof hero-anim hero-anim-5">
                <span>Git-backed</span>
                <span>Eval-driven</span>
                <span>Policy-controlled</span>
                <span>Audit-ready</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── /01 Stats ───── */}
      <section className="stats-strip">
        <div className="stat">
          <span className="stat-label">Skills under governance</span>
          <span className="stat-value num">
            218<span className="unit">+</span>
          </span>
          <span className="stat-meta">across customer workspaces</span>
        </div>
        <div className="stat">
          <span className="stat-label">Eval coverage</span>
          <span className="stat-value num">
            94<span className="unit">%</span>
          </span>
          <span className="stat-meta">▲ 2.1 pts in the last 30 days</span>
        </div>
        <div className="stat">
          <span className="stat-label">Release turnaround</span>
          <span className="stat-value num">
            2.4<span className="unit">d</span>
          </span>
          <span className="stat-meta">▼ 0.6d vs prior month</span>
        </div>
        <div className="stat">
          <span className="stat-label">Audit retention</span>
          <span className="stat-value num">
            7<span className="unit">yr</span>
          </span>
          <span className="stat-meta">immutable, SIEM-streamable</span>
        </div>
      </section>

      {/* ───── /02 Why — broken vs governed ───── */}
      <section className="marketing-section">
        <div className="section-index">/01 — Why Savant</div>
        <div className="marketing-inner">
          <div className="marketing-eyebrow" data-reveal>
            From scattered to governed
          </div>
          <div className="cap-head" data-reveal data-reveal-delay="1">
            <h2 style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: "clamp(38px, 4.4vw, 64px)", margin: 0, fontWeight: 400, lineHeight: 1.02, letterSpacing: "-0.025em" }}>
              Most teams ship skills on trust. Savant ships them on evidence.
            </h2>
            <p>
              Ad-hoc prompts and runbooks scattered across docs and chat. No
              versioning, no measurement, no breadcrumb when something regresses.
              Savant replaces the trust with a system of record.
            </p>
          </div>

          <div className="contrast-grid">
            <article className="contrast-card broken" data-reveal>
              <span className="stamp">Today — ad-hoc</span>
              <h2>Skill content lives wherever someone put it last.</h2>
              <ul>
                <li>
                  <Ic.XCircle />
                  <span>Prompts in Notion. Runbooks in Slack. Agents in someone&apos;s repo.</span>
                </li>
                <li>
                  <Ic.XCircle />
                  <span>Approvals happen over chat. There&apos;s no system of record.</span>
                </li>
                <li>
                  <Ic.XCircle />
                  <span>Regressions surface as customer complaints, not eval flags.</span>
                </li>
                <li>
                  <Ic.XCircle />
                  <span>Rollback means digging through git history under pressure.</span>
                </li>
              </ul>
            </article>

            <article className="contrast-card solution" data-reveal data-reveal-delay="1">
              <span className="stamp">With Savant — governed</span>
              <h2>Skills live in Git, evaluated on every change, shipped through policy.</h2>
              <ul>
                <li>
                  <Ic.CheckCircle />
                  <span>One repository per team is the source of truth. Webhook-synced.</span>
                </li>
                <li>
                  <Ic.CheckCircle />
                  <span>Approvals routed by tier and codified in policy.yaml, not chat.</span>
                </li>
                <li>
                  <Ic.CheckCircle />
                  <span>Every candidate runs against rubric evals before approval opens.</span>
                </li>
                <li>
                  <Ic.CheckCircle />
                  <span>Auto-pin on regression. One-click rollback. Full audit trail kept 7 years.</span>
                </li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* ───── /03 Capability surface ───── */}
      <section className="marketing-section band-paper">
        <div className="section-index">/02 — Platform</div>
        <div className="marketing-inner">
          <div className="marketing-eyebrow" data-reveal>
            The platform
          </div>
          <div className="cap-head" data-reveal data-reveal-delay="1">
            <h2>
              Six primitives. One coherent surface.
            </h2>
            <p>
              Repositories as the source of truth. Evaluations as the truth-keeper.
              Approvals as the gate. Releases as the moment of commitment. Audit as
              the receipt. Distribution as the reach.
            </p>
          </div>

          <CapabilitySurface />
        </div>
      </section>

      {/* ───── /04 How it works ───── */}
      <section className="marketing-section how-section" id="how-it-works">
        <div className="section-index">/03 — How it works</div>
        <div className="marketing-inner">
          <div className="marketing-eyebrow" data-reveal>
            From commit to release, every state stays observable
          </div>
          <div className="how-head" data-reveal data-reveal-delay="1">
            <h2>
              Five steps. Every event recorded. Every state observable.
            </h2>
          </div>
          <HowItWorksRail />
        </div>
      </section>

      {/* ───── /05 Distribution + policy (dark band) ───── */}
      <section className="marketing-section band-ink">
        <div className="section-index">/04 — Distribution</div>
        <div className="marketing-inner">
          <div className="marketing-eyebrow" data-reveal>
            Distribution + policy
          </div>
          <div className="dist-head" data-reveal data-reveal-delay="1">
            <h2>
              Approved skills flow safely to the agents that consume them.
            </h2>
            <p>
              One approved release. One policy decision. Every tool gets the
              right version, the right guardrails, and a clean rollback path.
            </p>
          </div>

          <DistributionScene />
        </div>
      </section>

      {/* ───── /06 Pricing ───── */}
      <section className="marketing-section pricing-section" id="pricing">
        <div className="section-index">/05 — Pricing</div>
        <div className="marketing-inner">
          <div className="marketing-eyebrow" data-reveal>
            Honest pricing
          </div>
          <div className="pricing-head" data-reveal data-reveal-delay="1">
            <h2>
              One tier, priced per seat.
            </h2>
            <p>
              Savant ships as one seat-based plan right now — every core
              workflow included. Choose monthly or annual, invite the team, and
              run repositories, evaluations, approvals, releases, audit, and
              distribution without a feature-gated matrix.
            </p>
          </div>

          <PricingCard signedIn={viewer.isAuthenticated} />
        </div>
      </section>

      {/* ───── /07 FAQ ───── */}
      <section className="marketing-section faq-section">
        <div className="section-index">/06 — FAQ</div>
        <div className="marketing-inner">
          <div className="faq">
            <div className="faq-side" data-reveal>
              <div className="marketing-eyebrow">Frequently asked</div>
              <h2>Questions that come up a lot.</h2>
              <p>
                Still curious about something? Email{" "}
                <a className="link" href="mailto:hello@savant.app">
                  hello@savant.app
                </a>{" "}
                — we read every note and reply within a day.
              </p>
            </div>
            <div className="faq-list" data-reveal data-reveal-delay="1">
              <FaqItem q="Does Savant store our skill content?">
                No. Your Git repository is the source of truth. Savant references
                commits and runs evaluations against them, but the prompts, runbooks,
                and agent workflows themselves never leave your environment.
              </FaqItem>
              <FaqItem q="Which Git providers do you support?">
                GitHub Cloud and Enterprise, GitLab Cloud and self-managed, Azure
                DevOps, Bitbucket Cloud and Data Center, and other Git deployments
                over SSH or HTTPS.
              </FaqItem>
              <FaqItem q="What does an eval suite look like?">
                A rubric and a case set, both checked into the repo. Savant runs the
                rubric against each candidate using whichever model you point it at,
                surfaces regressions against the baseline, and stores results for the
                life of the release.
              </FaqItem>
              <FaqItem q="How does authentication work?">
                Auth0 by default; bring your own IdP via SAML or OIDC. Group
                membership drives RBAC, and SCIM keeps things in lockstep with your
                directory.
              </FaqItem>
              <FaqItem q="Do you have multiple plans?">
                Not right now. Savant ships as one seat-based plan with the full
                core workflow included — repositories, evaluations, approvals,
                releases, audit, and distribution.
              </FaqItem>
              <FaqItem q="What happens if a release regresses?">
                Auto-pin on regression is a default policy. The prior version pins
                immediately, an incident opens, and the skill owner is paged. Manual
                rollback is one click in the release dashboard.
              </FaqItem>
              <FaqItem q="Do you offer a free trial?">
                Every plan starts with a 14-day trial. Cancel any time during the
                trial and you&apos;re not charged. After the trial, billing is per seat
                per month or per year — you pick the cycle at signup.
              </FaqItem>
            </div>
          </div>
        </div>
      </section>

      {/* ───── /08 Final CTA — climactic ───── */}
      <section className="cta-final">
        <div className="cta-final-grid">
          <div className="cta-final-body" data-reveal>
            <h2>
              Stop shipping skills on trust.
              <span className="accent">Ship them on evidence.</span>
            </h2>
            <p>
              Bring your skill platform under governance today. Connect a repo,
              watch the first evaluation run, and ship a release with full audit
              trail — all in under fifteen minutes.
            </p>
            <div className="cta-final-actions">
              {viewer.isAuthenticated ? (
                <Link href="/dashboard" className="btn btn-primary btn-lg">
                  Open dashboard
                  <Ic.ChevR className="b-icon" />
                </Link>
              ) : (
                <Link href="/signup" className="btn btn-primary btn-lg">
                  Start 14-day free trial
                  <Ic.ChevR className="b-icon" />
                </Link>
              )}
              <a href="mailto:sales@savant.app" className="btn btn-ghost btn-lg">
                Talk to sales
              </a>
            </div>
          </div>

          <div className="cta-final-stamps" data-reveal data-reveal-delay="1">
            <div className="stamp">
              <span className="v">14</span>
              <span className="l">days free</span>
            </div>
            <div className="stamp">
              <span className="v">$1</span>
              <span className="l">per seat / month</span>
            </div>
            <div className="stamp">
              <span className="v">15m</span>
              <span className="l">to first release</span>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Footer ───── */}
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
              The control plane for skill platforms. Built for teams who ship
              governed expertise — not just code.
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

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="faq-item">
      <summary>{q}</summary>
      <p>{children}</p>
    </details>
  );
}
