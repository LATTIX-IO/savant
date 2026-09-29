"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { trackMarketingEvent } from "@/lib/marketing-analytics";
import { PRICING } from "@/lib/marketing-content";

type Cycle = "monthly" | "annual";

const INCLUDES = PRICING.includes;

export function Pricing({ signedIn }: { signedIn: boolean }) {
  const [cycle, setCycle] = useState<Cycle>("annual");
  const annual = cycle === "annual";
  const href: Route = signedIn ? "/dashboard" : (`/signup?cycle=${cycle}` as Route);

  const choose = (next: Cycle) => {
    if (next === cycle) return;
    setCycle(next);
    trackMarketingEvent("pricing_toggle", { cycle: next });
  };

  return (
    <section className="section" id="pricing" data-nav="pricing" aria-labelledby="pricing-title">
      <div className="shell pr">
        <div className="pr-main" data-reveal>
          <div className="sh-meta">
            <span className="sh-index">08</span>
            <span className="sh-label">Pricing</span>
          </div>
          <h2 id="pricing-title" className="pr-title">
            One platform.
            <br />
            One plan.
          </h2>

          <div className="pricing-cycle pr-cycle" role="group" aria-label="Billing cycle">
            <button type="button" aria-pressed={cycle === "monthly"} onClick={() => choose("monthly")}>
              Monthly
            </button>
            <button type="button" aria-pressed={cycle === "annual"} onClick={() => choose("annual")}>
              Annual <span className="savings-chip">save 17%</span>
            </button>
          </div>

          <div className="pr-price">
            <span className="pr-amount num">${annual ? 10 : 1}</span>
            <span className="pr-unit">user / {annual ? "year" : "month"}</span>
          </div>
          <p className="pr-meta">
            {annual ? "Equivalent to $0.83 per user per month. " : "Billed monthly. "}
            Billed in USD. No platform fee.
          </p>

          <p className="pr-lede">Everything required to govern organizational skills.</p>

          <ul className="pr-includes">
            {INCLUDES.map((item) => (
              <li key={item}>
                <span className="pr-check" aria-hidden="true">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className="pr-cta">
            <Link
              href={href}
              className="btn btn-primary btn-lg"
              data-track="pricing_cta"
              data-track-placement="pricing"
              data-track-cycle={cycle}
            >
              {signedIn ? "Go to dashboard" : "Start 14-day trial"}
            </Link>
            <span className="pr-fine">No credit card required</span>
          </div>
        </div>

        <aside className="pr-side" aria-label="Procurement and deployment" data-reveal data-reveal-delay="1">
          <div className="pr-side-block">
            <h3>Procurement</h3>
            <p>
              Annual invoicing, security questionnaires, and a DPA are available for teams buying
              through procurement.
            </p>
          </div>
          <div className="pr-side-block">
            <h3>Deployment</h3>
            <p>
              Savant runs as a managed, tenant-isolated service. Skill content stays in your Git.
              For dedicated or self-hosted requirements, talk to us.
            </p>
          </div>
          <div className="pr-side-block">
            <h3>Trial</h3>
            <p>14 days with every workflow enabled. Cancel during the trial and you are not charged.</p>
          </div>
          <a
            href="mailto:sales@savant.app?subject=Savant%20procurement"
            className="link-arrow"
            data-track="sales_cta"
            data-track-placement="pricing"
          >
            Talk to sales
          </a>
        </aside>
      </div>
    </section>
  );
}
