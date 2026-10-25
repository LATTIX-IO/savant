"use client";

import { useState } from "react";

export function BillingPortalButton({ workspaceSlug }: { workspaceSlug: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ workspaceSlug }),
      });
      const payload: unknown = await response.json();
      const url = payload && typeof payload === "object" && "url" in payload
        ? (payload as { url?: unknown }).url
        : null;
      if (!response.ok || typeof url !== "string" || !url.startsWith("https://billing.stripe.com/")) {
        throw new Error(response.status === 403 ? "Only a workspace owner or admin can manage billing." : "Billing management is temporarily unavailable.");
      }
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Billing management is temporarily unavailable.");
      setPending(false);
    }
  };

  return <div>
    <button type="button" className="btn btn-primary" onClick={openPortal} disabled={pending}>
      {pending ? "Opening secure billing..." : "Manage subscription and invoices"}
    </button>
    {error && <p role="alert" style={{ color: "var(--danger, #a33)", marginTop: 8 }}>{error}</p>}
  </div>;
}
