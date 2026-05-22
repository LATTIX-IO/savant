import Link from "next/link";

import { Ic } from "@/components/savant/icons";

export function MarketingNav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="marketing-nav" aria-label="Primary">
      <Link href="/" className="marketing-brand" aria-label="Savant home">
        <span className="marketing-brand-mark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="var(--ink)" strokeWidth="1.5" />
            <path d="M7 12h10M7 8h10M7 16h6" stroke="var(--moss)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        Savant
      </Link>

      <div className="marketing-nav-links">
        <a href="#how-it-works">How it works</a>
        <a href="#pricing">Pricing</a>
        <a href="mailto:hello@savant.app">Contact</a>
      </div>

      <div className="marketing-nav-cta">
        {signedIn ? (
          <Link href="/dashboard" className="btn btn-primary btn-sm">
            <span>Dashboard</span>
            <Ic.ChevR className="b-icon" />
          </Link>
        ) : (
          <>
            {/* Auth0 mounts /api/auth/login outside Next's route registry, so a
                plain anchor avoids a typed-routes mismatch and matches the
                hard-navigation behavior the OAuth dance expects anyway. */}
            <a href="/api/auth/login" className="btn btn-sm">
              Sign in
            </a>
            <Link href="/signup" className="btn btn-primary btn-sm">
              <span>Get started</span>
              <Ic.ChevR className="b-icon" />
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
