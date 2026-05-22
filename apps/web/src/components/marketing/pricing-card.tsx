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
  const monthlyEquivalent = isAnnual
    ? "Equivalent to $0.83 / user / month"
    : "Billed every month";
  const ctaHref: Route = signedIn ? "/dashboard" : (`/signup?cycle=${cycle}` as Route);
  const ctaLabel = signedIn ? "Go to dashboard" : "Start 14-day free trial";

  return (
    <article className="pricing-card" data-reveal>
      <div className="pricing-card-header">
        <div>
          <div className="pricing-eyebrow">Savant — every team plan</div>
          <h3 className="pricing-card-title">One plan. Everything included.</h3>
        </div>
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
      </div>

      <div className="pricing-ledger">
        <div className="pricing-ledger-main">
          <div className="price-main">
            <span className="price-amount">${unitPrice}</span>
            <span className="price-unit">{unitLabel}</span>
          </div>
          <div className="price-meta">
            {monthlyEquivalent} · billed in USD · no platform fee · all core workflows included
          </div>

          <div className="price-cta">
            <Link href={ctaHref} className="btn btn-primary btn-lg">
              <span>{ctaLabel}</span>
              <Ic.ChevR className="b-icon" />
            </Link>
            <p
              style={{
                fontSize: 12,
                color: "var(--subtle)",
                margin: 0,
                fontFamily: "var(--mono)",
              }}
            >
              No credit card required for the trial.
            </p>
          </div>
        </div>

        <div className="pricing-ledger-side">
          <div className="pricing-ledger-note">
            <span className="pricing-ledger-label">Included on day one</span>
            <p>
              Repositories, evaluations, approvals, releases, audit, and
              distribution all ship on the same seat-based plan.
            </p>
          </div>

          <ul className="price-includes">
            <Include>Unlimited skills, evaluations, releases, and repositories</Include>
            <Include>SSO + SCIM via Auth0 or your IdP</Include>
            <Include>Managed sync agents, native integrations, and release hooks</Include>
            <Include>14-day free trial, cancel any time during the trial</Include>
            <Include>Email + Slack support, 24h response</Include>
          </ul>
        </div>
      </div>
    </article>
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
