"use client";

import Link from "next/link";
import Script from "next/script";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { validateOnboardingDraftInput, type BillingCycle } from "@/lib/onboarding";
import {
  formatWorkspaceUrlForDisplay,
  formatWorkspaceUrlPrefixForDisplay,
} from "@/lib/workspace-url";

type StepId = "workspace" | "billing";

const STEPS: Array<{ id: StepId; title: string; sub: string }> = [
  { id: "workspace", title: "Workspace", sub: "Name and URL path" },
  { id: "billing", title: "Billing", sub: "Seats and cycle" },
];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export function OnboardingWizard({
  initialCycle,
  initialSeats,
  initialWorkspaceName,
  initialWorkspaceSlug,
  initialOnboardingSessionId,
  canPersistDraft,
  hasPersistedDraft,
  isSandbox,
  wasCancelled,
  viewerEmail,
  stripePricingTableId,
  stripePublishableKey,
}: {
  initialCycle: BillingCycle;
  initialSeats: number;
  initialWorkspaceName: string;
  initialWorkspaceSlug: string;
  initialOnboardingSessionId: string | null;
  canPersistDraft: boolean;
  hasPersistedDraft: boolean;
  isSandbox: boolean;
  wasCancelled: boolean;
  viewerEmail: string | null;
  stripePricingTableId: string | null;
  stripePublishableKey: string | null;
}) {
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState(initialWorkspaceName);
  const [workspaceSlug, setWorkspaceSlug] = useState(initialWorkspaceSlug);
  const [seats, setSeats] = useState<number>(initialSeats);
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);
  const [onboardingSessionId, setOnboardingSessionId] = useState<string | null>(initialOnboardingSessionId);
  const [submitting, setSubmitting] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    hasPersistedDraft ? "saved" : "idle",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSavedPayloadRef = useRef<string | null>(
    hasPersistedDraft
      ? JSON.stringify({
          workspaceName: initialWorkspaceName,
          workspaceSlug: initialWorkspaceSlug,
          cycle: initialCycle,
          seats: initialSeats,
        })
      : null,
  );

  const slugTouched = useMemo(() => workspaceSlug !== slugify(workspaceName), [workspaceName, workspaceSlug]);
  const validatedDraft = useMemo(
    () => validateOnboardingDraftInput({ workspaceName, workspaceSlug, cycle, seats }),
    [cycle, seats, workspaceName, workspaceSlug],
  );
  const currentStep = STEPS[step] ?? STEPS[0]!;
  const currentStepId = currentStep.id;
  const workspaceUrlPrefix = formatWorkspaceUrlPrefixForDisplay();
  const workspaceUrlPreview = formatWorkspaceUrlForDisplay(workspaceSlug.trim() || "workspace");
  const useNativePricingTable = Boolean(
    !isSandbox
    && canPersistDraft
    && stripePricingTableId
    && stripePublishableKey,
  );
  const canRenderPricingTable = Boolean(useNativePricingTable && onboardingSessionId);

  const onNameChange = (next: string) => {
    setWorkspaceName(next);
    if (!slugTouched) {
      setWorkspaceSlug(slugify(next));
    }
  };

  const unitPrice = cycle === "annual" ? 10 : 1;
  const subtotal = unitPrice * seats;
  const cycleLabel = cycle === "annual" ? "year" : "month";

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const persistDraft = useCallback(async (signal?: AbortSignal) => {
    if (!validatedDraft.ok || !canPersistDraft) {
      return onboardingSessionId;
    }

    const payload = JSON.stringify(validatedDraft.value);
    const response = await fetch("/api/onboarding/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: payload,
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new Error(data.error?.message || `Unable to save onboarding progress (${response.status}).`);
    }

    const data = (await response.json().catch(() => ({}))) as {
      data?: { id?: string | undefined };
    };
    const nextSessionId = typeof data.data?.id === "string" ? data.data.id : onboardingSessionId;
    lastSavedPayloadRef.current = payload;
    setSaveState("saved");
    setOnboardingSessionId(nextSessionId ?? null);
    return nextSessionId ?? null;
  }, [canPersistDraft, onboardingSessionId, validatedDraft]);

  useEffect(() => {
    if (!canPersistDraft || !validatedDraft.ok) {
      return undefined;
    }

    const payload = JSON.stringify(validatedDraft.value);
    if (lastSavedPayloadRef.current === payload) {
      return undefined;
    }

    const controller = new AbortController();
    setSaveState("saving");
    setSaveError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        await persistDraft(controller.signal);
      } catch (saveFailure) {
        if (!controller.signal.aborted) {
          setSaveState("error");
          setSaveError(
            saveFailure instanceof Error
              ? saveFailure.message
              : "Unable to save onboarding progress.",
          );
        }
      }
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [canPersistDraft, persistDraft, validatedDraft]);

  const saveMessage = canPersistDraft
    ? saveState === "saving"
      ? "Saving workspace details…"
      : saveState === "saved"
        ? "Workspace details saved."
        : saveError
    : null;

  const submit = async () => {
    setError(null);
    setSubmitting(true);

    if (!validatedDraft.ok) {
      setError(validatedDraft.message);
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validatedDraft.value),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(data.error?.message || `Checkout failed (${res.status})`);
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

  const continueToBilling = async () => {
    setError(null);

    if (!validatedDraft.ok) {
      setError(validatedDraft.message);
      return;
    }

    if (!useNativePricingTable || !canPersistDraft) {
      next();
      return;
    }

    setContinuing(true);
    setSaveState("saving");
    setSaveError(null);

    try {
      const sessionId = await persistDraft();
      if (!sessionId) {
        throw new Error("Unable to prepare checkout right now. Please try again.");
      }

      next();
    } catch (saveFailure) {
      const message = saveFailure instanceof Error
        ? saveFailure.message
        : "Unable to prepare checkout right now. Please try again.";
      setSaveState("error");
      setSaveError(message);
      setError(message);
    } finally {
      setContinuing(false);
    }
  };

  const pricingTableElement = useMemo(() => {
    if (!stripePricingTableId || !stripePublishableKey || !onboardingSessionId) {
      return null;
    }

    return createElement("stripe-pricing-table", {
      "pricing-table-id": stripePricingTableId,
      "publishable-key": stripePublishableKey,
      "client-reference-id": onboardingSessionId,
      ...(viewerEmail ? { "customer-email": viewerEmail } : {}),
    });
  }, [onboardingSessionId, stripePricingTableId, stripePublishableKey, viewerEmail]);

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

        {isSandbox ? (
          <div className="note" style={{ marginTop: "auto" }}>
            <Ic.Clock className="n-icon" style={{ color: "var(--moss)" }} />
            <span style={{ fontSize: 11.5 }}>
              Local sandbox mode is on. Login and checkout are simulated so you can click through onboarding without external calls.
            </span>
          </div>
        ) : (
          <div className="note" style={{ marginTop: "auto" }}>
            <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
            <span style={{ fontSize: 11.5 }}>
              Secure payment is handled during checkout. Cancel anytime during the 14-day trial and you
              won&apos;t be charged.
            </span>
          </div>
        )}
      </aside>

      <main className="wizard-main">
        {isSandbox ? (
          <div className="note">
            <Ic.Clock className="n-icon" />
            <span>
              Local sandbox mode is active. We&apos;ll simulate login and hosted checkout so you can test the full onboarding flow in local development.
            </span>
          </div>
        ) : null}

        {wasCancelled ? (
          <div className="note brass">
            <Ic.Warn className="n-icon" />
            <span>
              Checkout was cancelled. Your selections are still here when you&apos;re ready.
            </span>
          </div>
        ) : null}

        {currentStepId === "workspace" && (
          <>
            <div>
              <div className="marketing-eyebrow">Step {step + 1} of {STEPS.length}</div>
              <h1>Name your workspace.</h1>
              <p style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1.65, maxWidth: 540, marginTop: 10 }}>
                The name shows in the top bar and on release bundles. The slug becomes the
                path segment in your Savant workspace URL, and you can change it later from Settings.
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
                <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="mono muted" style={{ fontSize: 13 }}>
                    {workspaceUrlPrefix}
                  </span>
                  <input
                    id="ws-slug"
                    value={workspaceSlug}
                    onChange={(e) => setWorkspaceSlug(slugify(e.target.value))}
                    placeholder="wexler-hahn"
                    style={{ maxWidth: 220, fontFamily: "var(--mono)" }}
                  />
                </div>
                <div className="field-help">
                  Lowercase letters, numbers, and hyphens. We&apos;ll reserve {workspaceUrlPreview} for this workspace.
                </div>
              </div>

              {saveMessage ? (
                <div className="field-help" style={{ color: saveState === "error" ? "var(--oxblood)" : "var(--subtle)" }}>
                  {saveMessage}
                </div>
              ) : null}
            </div>

            <div className="wizard-foot">
              <Link href="/" className="btn btn-ghost">
                Cancel
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!workspaceName.trim() || !workspaceSlug.trim() || continuing}
                onClick={continueToBilling}
              >
                {continuing ? (
                  <>
                    <Ic.Spinner className="b-icon" style={{ animation: "spin 0.9s linear infinite" }} />
                    Preparing checkout…
                  </>
                ) : (
                  <>
                    Continue
                    <Ic.ChevR className="b-icon" />
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {currentStepId === "billing" && (
          <>
            <div>
              <div className="marketing-eyebrow">Step {step + 1} of {STEPS.length}</div>
              <h1>{useNativePricingTable ? "Choose your plan." : "Billing."}</h1>
              <p style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1.65, maxWidth: 540, marginTop: 10 }}>
                {useNativePricingTable
                  ? "Billing is handled securely below so you can move straight into a native hosted checkout flow. Your workspace details stay attached while you complete checkout."
                  : `14-day trial — you won't be charged until ${trialEndsAt()}. You can add or remove seats anytime; we'll prorate.`}
              </p>
            </div>

            <div className="wizard-form">
              {useNativePricingTable ? (
                <>
                  <div className="note">
                    <Ic.Check className="n-icon" />
                    <span>
                      Workspace <strong>{workspaceName.trim() || "Workspace"}</strong> will be provisioned at {workspaceUrlPreview} after checkout completes.
                    </span>
                  </div>
                  {!canRenderPricingTable ? (
                    <div className="note brass">
                      <Ic.Clock className="n-icon" />
                      <span>
                        We&apos;re still preparing your workspace record for billing. If this doesn&apos;t load in a moment, go back and continue again.
                      </span>
                    </div>
                  ) : (
                    <>
                      <Script src="https://js.stripe.com/v3/pricing-table.js" strategy="afterInteractive" />
                      <div style={{ width: "100%", minHeight: 400 }}>
                        {pricingTableElement}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
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
                </>
              )}

              {error ? (
                <div className="note blood">
                  <Ic.Warn className="n-icon" />
                  <span>{error}</span>
                </div>
              ) : null}

              {saveMessage ? (
                <div className="field-help" style={{ color: saveState === "error" ? "var(--oxblood)" : "var(--subtle)" }}>
                  {saveMessage}
                </div>
              ) : null}
            </div>

            <div className="wizard-foot">
              <button type="button" className="btn btn-ghost" onClick={back} disabled={submitting}>
                Back
              </button>
              {useNativePricingTable ? null : (
                <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                  {submitting ? (
                    <>
                      <Ic.Spinner className="b-icon" style={{ animation: "spin 0.9s linear infinite" }} />
                      {isSandbox ? "Finalizing sandbox checkout…" : "Redirecting…"}
                    </>
                  ) : (
                    <>
                      {isSandbox ? "Complete sandbox checkout" : "Continue to Checkout"}
                      <Ic.ChevR className="b-icon" />
                    </>
                  )}
                </button>
              )}
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
