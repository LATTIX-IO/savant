"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Ic } from "@/components/savant/icons";
import type { AuthViewer } from "@/lib/auth0-session";

type Cycle = "monthly" | "annual";
type Step = 0 | 1 | 2;

const STEPS: Array<{ title: string; sub: string }> = [
  { title: "Identity", sub: "Confirm who you are" },
  { title: "Workspace", sub: "Name and URL slug" },
  { title: "Billing", sub: "Seats and cycle" },
];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export function OnboardingWizard({
  viewer,
  initialCycle,
  initialSeats,
  wasCancelled,
}: {
  viewer: AuthViewer;
  initialCycle: Cycle;
  initialSeats: number;
  wasCancelled: boolean;
}) {
  const [step, setStep] = useState<Step>(viewer.isAuthenticated ? 1 : 0);
  const [workspaceName, setWorkspaceName] = useState(
    viewer.isAuthenticated
      ? viewer.displayName.replace(/\s+/g, " ").trim() + "'s workspace"
      : "",
  );
  const [workspaceSlug, setWorkspaceSlug] = useState(
    viewer.isAuthenticated ? slugify(viewer.displayName) : "",
  );
  const [seats, setSeats] = useState<number>(initialSeats);
  const [cycle, setCycle] = useState<Cycle>(initialCycle);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugTouched = useMemo(() => workspaceSlug !== slugify(workspaceName), [workspaceName, workspaceSlug]);

  const onNameChange = (next: string) => {
    setWorkspaceName(next);
    if (!slugTouched) {
      setWorkspaceSlug(slugify(next));
    }
  };

  const unitPrice = cycle === "annual" ? 10 : 1;
  const subtotal = unitPrice * seats;
  const cycleLabel = cycle === "annual" ? "year" : "month";

  const next = () => setStep((s) => (Math.min(2, s + 1) as Step));
  const back = () => setStep((s) => (Math.max(0, s - 1) as Step));

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cycle,
          seats,
          workspaceName: workspaceName.trim(),
          workspaceSlug: workspaceSlug.trim() || slugify(workspaceName),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Checkout failed (${res.status})`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        throw new Error("Stripe did not return a checkout URL.");
      }
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="wizard-page">
      <aside className="wizard-aside">
        <div>
          <div
            className="marketing-eyebrow"
            style={{ marginBottom: 14, color: "var(--muted)" }}
          >
            /02 — Get started
          </div>
          <h2>Two minutes from here to a running workspace.</h2>
          <p>
            Connect your Git repository after you finish billing. Your first eval
            run is on us — no payment until the 14-day trial ends.
          </p>
        </div>

        <ol className="wizard-steps">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className={`wizard-step ${i < step ? "done" : i === step ? "active" : "upcoming"}`}
            >
              <span className="wizard-num">
                {i < step ? <Ic.Check style={{ width: 11, height: 11 }} /> : i + 1}
              </span>
              <div>
                <div className="t">{s.title}</div>
                <div className="s">{s.sub}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="note" style={{ marginTop: "auto" }}>
          <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
          <span style={{ fontSize: 11.5 }}>
            Payment handled by Stripe. Cancel anytime during the 14-day trial and you
            won&apos;t be charged.
          </span>
        </div>
      </aside>

      <main className="wizard-main">
        {wasCancelled ? (
          <div className="note brass">
            <Ic.Warn className="n-icon" />
            <span>
              Stripe checkout was cancelled. Your selections are still here when you&apos;re ready.
            </span>
          </div>
        ) : null}

        {step === 0 && (
          <>
            <div>
              <div className="marketing-eyebrow">Step 1 of 3</div>
              <h1>Confirm your identity.</h1>
              <p style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1.65, maxWidth: 540, marginTop: 10 }}>
                Savant uses Auth0 for sign-in. After signup, your workspace is tied to
                this account.
              </p>
            </div>

            <div className="wizard-billing">
              <div className="wizard-billing-row">
                <span>Email</span>
                <span className="num">{viewer.email ?? "—"}</span>
              </div>
              <div className="wizard-billing-row">
                <span>Display name</span>
                <span>{viewer.displayName}</span>
              </div>
            </div>

            <div className="wizard-foot">
              <Link href="/" className="btn btn-ghost">
                Cancel
              </Link>
              <div className="row" style={{ gap: 8 }}>
                {!viewer.isAuthenticated ? (
                  <a href="/api/auth/login?screen_hint=signup&returnTo=/onboarding" className="btn btn-primary">
                    Sign in with Auth0
                    <Ic.ChevR className="b-icon" />
                  </a>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={next}>
                    Continue
                    <Ic.ChevR className="b-icon" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <div className="marketing-eyebrow">Step 2 of 3</div>
              <h1>Name your workspace.</h1>
              <p style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1.65, maxWidth: 540, marginTop: 10 }}>
                The name shows in the top bar and on release bundles. The slug is your
                subdomain — you can change it later from Settings.
              </p>
            </div>

            <div className="wizard-form">
              <div className="field">
                <label className="field-label" htmlFor="ws-name">Workspace name</label>
                <input
                  id="ws-name"
                  value={workspaceName}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder="Wexler &amp; Hahn"
                  autoFocus
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ws-slug">Workspace URL</label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    id="ws-slug"
                    value={workspaceSlug}
                    onChange={(e) => setWorkspaceSlug(slugify(e.target.value))}
                    placeholder="wexler-hahn"
                    style={{ maxWidth: 280, fontFamily: "var(--mono)" }}
                  />
                  <span className="mono muted" style={{ fontSize: 13 }}>
                    .savant.app
                  </span>
                </div>
                <div className="field-help">
                  Lowercase letters, numbers, and hyphens. Must be unique.
                </div>
              </div>
            </div>

            <div className="wizard-foot">
              <button type="button" className="btn btn-ghost" onClick={back}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!workspaceName.trim() || !workspaceSlug.trim()}
                onClick={next}
              >
                Continue
                <Ic.ChevR className="b-icon" />
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <div className="marketing-eyebrow">Step 3 of 3</div>
              <h1>Billing.</h1>
              <p style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1.65, maxWidth: 540, marginTop: 10 }}>
                14-day trial — you won&apos;t be charged until {trialEndsAt()}.
                You can add or remove seats anytime; we&apos;ll prorate.
              </p>
            </div>

            <div className="wizard-form">
              <div className="field">
                <label className="field-label" htmlFor="seats">Seats</label>
                <input
                  id="seats"
                  type="number"
                  min={1}
                  max={500}
                  value={seats}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setSeats(Number.isFinite(n) && n > 0 ? Math.min(500, Math.floor(n)) : 1);
                  }}
                  style={{ maxWidth: 140, fontFamily: "var(--mono)" }}
                />
                <div className="field-help">Members with edit / approve permissions.</div>
              </div>

              <div className="field">
                <span className="field-label">Billing cycle</span>
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

              <div className="wizard-billing">
                <div className="wizard-billing-row">
                  <span>{seats} seats × ${unitPrice} / seat / {cycleLabel}</span>
                  <span className="num">${subtotal.toFixed(2)}</span>
                </div>
                <div className="wizard-billing-row">
                  <span>14-day trial credit</span>
                  <span className="num">−${subtotal.toFixed(2)}</span>
                </div>
                <div className="wizard-billing-row total">
                  <span>Due today</span>
                  <span className="num">$0.00</span>
                </div>
                <div className="wizard-billing-row" style={{ fontSize: 12, color: "var(--subtle)" }}>
                  <span>Then ${subtotal.toFixed(2)} / {cycleLabel} starting {trialEndsAt()}</span>
                  <span />
                </div>
              </div>

              {error ? (
                <div className="note blood">
                  <Ic.Warn className="n-icon" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>

            <div className="wizard-foot">
              <button type="button" className="btn btn-ghost" onClick={back} disabled={submitting}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? (
                  <>
                    <Ic.Spinner className="b-icon" style={{ animation: "spin 0.9s linear infinite" }} />
                    Redirecting…
                  </>
                ) : (
                  <>
                    Continue to Stripe
                    <Ic.ChevR className="b-icon" />
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function trialEndsAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
