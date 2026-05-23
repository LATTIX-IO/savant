"use client";

import { useEffect, useState } from "react";

import type { OnboardingStatusView } from "@/lib/onboarding";
import { Ic } from "@/components/savant/icons";
import { buildTenantAppPath } from "@/lib/tenant-paths";
import { formatWorkspaceUrlForDisplay } from "@/lib/workspace-url";

export function OnboardingSuccessState({
  initialStatus,
  isSandbox,
  sessionId,
}: {
  initialStatus: OnboardingStatusView;
  isSandbox: boolean;
  sessionId: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [loadingNote, setLoadingNote] = useState<string | null>(null);

  useEffect(() => {
    if (status.isTerminal) {
      return undefined;
    }

    let cancelled = false;

    const refreshStatus = async () => {
      try {
        const response = await fetch(`/api/onboarding/status?session_id=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Status check failed (${response.status})`);
        }

        const payload = (await response.json()) as { data?: OnboardingStatusView };
        if (!cancelled && payload.data) {
          setStatus(payload.data);
          setLoadingNote(null);
        }
      } catch {
        if (!cancelled) {
          setLoadingNote("Still waiting for the provisioning signal. You can safely keep this tab open.");
        }
      }
    };

    refreshStatus();
    const intervalId = window.setInterval(refreshStatus, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [sessionId, status.isTerminal]);

  const icon = status.status === "ready"
    ? <Ic.Check style={{ width: 22, height: 22 }} />
    : status.status === "failed" || status.status === "canceled"
      ? <Ic.Warn style={{ width: 22, height: 22 }} />
      : <Ic.Spinner style={{ width: 22, height: 22, animation: "spin 0.9s linear infinite" }} />;

  const iconBackground = status.status === "ready"
    ? "var(--moss-soft)"
    : status.status === "failed" || status.status === "canceled"
      ? "color-mix(in srgb, var(--oxblood) 12%, white)"
      : "var(--linen)";

  const iconColor = status.status === "ready"
    ? "var(--moss-deep)"
    : status.status === "failed" || status.status === "canceled"
      ? "var(--oxblood)"
      : "var(--ink-2)";
  const workspaceUrl = formatWorkspaceUrlForDisplay(status.workspaceSlug);
  const dashboardHref = buildTenantAppPath(status.workspaceSlug, "/dashboard");

  return (
    <div className="signup-redirect">
      <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 18, alignItems: "center" }}>
        <span
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: iconBackground,
            color: iconColor,
            display: "grid",
            placeItems: "center",
          }}
        >
          {icon}
        </span>
        <h1>{status.heading}</h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-3)", maxWidth: 480, textAlign: "center" }}>
          {status.body}
        </p>
        <code
          className="ref"
          style={{ background: "var(--linen)", padding: "4px 10px", fontSize: 12 }}
        >
          {workspaceUrl}
        </code>

        {isSandbox ? (
          <div className="note" style={{ maxWidth: 440 }}>
            <Ic.Clock className="n-icon" />
            <span>
              Local sandbox mode simulated login and checkout for this onboarding run. No external checkout was created.
            </span>
          </div>
        ) : null}

        {loadingNote ? (
          <div className="note" style={{ maxWidth: 440 }}>
            <Ic.Clock className="n-icon" />
            <span>{loadingNote}</span>
          </div>
        ) : null}

        {status.canEnterDashboard ? (
          <a href={dashboardHref} className="btn btn-primary btn-lg" style={{ marginTop: 6 }}>
            Open dashboard
            <Ic.ChevR className="b-icon" />
          </a>
        ) : (
          <a href="/onboarding" className="btn btn-ghost btn-lg" style={{ marginTop: 6 }}>
            Return to onboarding
            <Ic.ChevR className="b-icon" />
          </a>
        )}
      </div>
    </div>
  );
}
