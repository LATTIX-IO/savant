"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { Ic } from "@/components/savant/icons";

type Cycle = "monthly" | "annual";

export function PricingCard({ signedIn }: { signedIn: boolean }) {
  const [cycle, setCycle] = useState<Cycle>("annual");
  const isAnnual = cycle === "annual";
  const unitPrice = isAnnual ? 10 : 1;
  const unitLabel = isAnnual ? "/ user / year" : "/ user / month";
  const monthlyEquivalent = isAnnual ? "Equivalent to $0.83 / user / month" : "Billed every month";
  const ctaHref: Route = signedIn ? "/dashboard" : (`/signup?cycle=${cycle}` as Route);
  const ctaLabel = signedIn ? "Go to dashboard" : "Start 14-day free trial";

  return (
    <div className="pricing-card" id="pricing">
      <div className="pricing-eyebrow">Savant — single tier</div>

      <div className="pricing-cycle" role="group" aria-label="Billing cycle">
        <button
          type="button"
          aria-pressed={cycle === "monthly"}
          onClick={() => setCycle("monthly")}
        >
          Monthly
        </button>
        <button
          type="button"
          aria-pressed={cycle === "annual"}
          onClick={() => setCycle("annual")}
        >
          Annual <span className="savings-chip">save 17%</span>
        </button>
      </div>

      <div className="price-main">
        <span className="price-amount">${unitPrice}</span>
        <span className="price-unit">{unitLabel}</span>
      </div>
      <div className="price-meta">{monthlyEquivalent} · billed in USD</div>

      <ul className="price-includes">
        <Include>Unlimited skills, evaluations, and releases</Include>
        <Include>Unlimited Git repositories and connectors</Include>
        <Include>SSO + SCIM via Auth0 or your IdP</Include>
        <Include>Full audit log retained for 7 years</Include>
        <Include>Email + Slack support, 24h response</Include>
        <Include>14-day free trial, cancel any time</Include>
      </ul>

      <div className="price-cta">
        <Link href={ctaHref} className="btn btn-primary btn-lg">
          <span>{ctaLabel}</span>
          <Ic.ChevR className="b-icon" />
        </Link>
        <a href="mailto:hello@savant.app" className="btn btn-ghost btn-lg">
          Talk to sales for self-hosted
        </a>
      </div>
    </div>
  );
}

function Include({ children }: { children: React.ReactNode }) {
  return (
    <li>
      <Ic.Check style={{ width: 14, height: 14 }} />
      <span>{children}</span>
    </li>
  );
}
