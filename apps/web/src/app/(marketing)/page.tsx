import Link from "next/link";

import { ControlPlane } from "@/components/marketing/control-plane";
import { DistributionMap } from "@/components/marketing/distribution-map";
import { EnterpriseTrust } from "@/components/marketing/enterprise-trust";
import { FAQ } from "@/components/marketing/faq";
import { FinalCTA } from "@/components/marketing/final-cta";
import { GovernanceRail } from "@/components/marketing/governance-rail";
import { Hero } from "@/components/marketing/hero";
import { ImprovementLoop } from "@/components/marketing/improvement-loop";
import { IntelligenceModel } from "@/components/marketing/intelligence-model";
import { MetricRail } from "@/components/marketing/metric-rail";
import { Pricing } from "@/components/marketing/pricing";
import { ProblemTransition } from "@/components/marketing/problem-transition";
import { SectionHead } from "@/components/marketing/section-head";
import { SiteFrame } from "@/components/marketing/site-frame";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";

export const metadata = {
  title: { absolute: "Savant — The system of record for organizational skills" },
  description:
    "Turn expertise into governed capability. Version skills in Git, prove them with evaluations, govern every release, keep every AI surface aligned, and improve skills from real use.",
};

const PRODUCT_NOTES = [
  { title: "Health from evidence", body: "Skill health is the eval pass rate, not a status someone typed." },
  { title: "Approvals under policy", body: "Reviews route by tier. The queue shows who is blocking and for how long." },
  { title: "Regressions before release", body: "A failing candidate is held automatically and flagged for its owner." },
];

export default async function LandingPage() {
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);
  const signedIn = viewer.isAuthenticated;

  return (
    <SiteFrame signedIn={signedIn}>
      <Hero signedIn={signedIn} />
      <MetricRail />
      <ProblemTransition />

      <section className="section" id="product" data-nav="product" aria-labelledby="product-title">
        <div className="shell">
          <SectionHead id="product-title" index="02" meta="The control plane" title="See the workspace your team actually governs in.">
            <p>
              Repository sync, evaluation outcomes, approval queues, release state, and audit
              evidence in one view. This is the product, recreated with demo data.
            </p>
          </SectionHead>

          <div className="product-grid">
            <div className="product-frame" data-reveal>
              <ControlPlane />
            </div>
            <ol className="product-notes" data-reveal data-reveal-delay="1">
              {PRODUCT_NOTES.map((note, index) => (
                <li key={note.title}>
                  <span className="product-note-num">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{note.title}</h3>
                  <p>{note.body}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="section-cta" data-reveal>
            <Link
              href={signedIn ? "/dashboard" : "/signup"}
              className="btn btn-primary btn-lg"
              data-track="cta_click"
              data-track-placement="product"
            >
              Connect your first repository
            </Link>
            <span className="section-cta-note">Free for 14 days. No credit card.</span>
          </div>
        </div>
      </section>

      <IntelligenceModel />
      <ImprovementLoop />

      <section className="section" id="how-it-works" data-nav="how" aria-labelledby="how-title">
        <div className="shell">
          <SectionHead id="how-title" index="05" meta="Governance lifecycle" title="Six stages. Every event recorded.">
            <p>
              From the commit that wrote a skill to the tool that runs it, each state is observable
              and each transition leaves evidence.
            </p>
          </SectionHead>
          <GovernanceRail />
        </div>
      </section>

      <DistributionMap />
      <EnterpriseTrust />
      <Pricing signedIn={signedIn} />
      <FAQ />
      <FinalCTA signedIn={signedIn} />
    </SiteFrame>
  );
}
