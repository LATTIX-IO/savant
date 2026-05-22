import Link from "next/link";

import { Ic } from "@/components/savant/icons";
import { SavantLogo } from "@/components/savant/savant-logo";

export function MarketingNav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="marketing-nav" aria-label="Primary">
      <Link href="/" className="marketing-brand" aria-label="Savant home">
        <SavantLogo className="marketing-brand-logo" />
      </Link>

      <div className="marketing-nav-links">
        <a href="#how-it-works">How it works</a>
        <a href="#pricing">Pricing</a>
        <a href="mailto:hello@savant.app">Contact</a>
      </div>

      <div className="marketing-nav-cta">
        <MarketingNavActions signedIn={signedIn} />
      </div>

      <details className="marketing-nav-mobile">
        <summary aria-label="Open navigation menu">
          <span>Menu</span>
          <span className="marketing-nav-mobile-icon" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </summary>

        <div className="marketing-nav-mobile-panel">
          <div className="marketing-nav-mobile-links">
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="mailto:hello@savant.app">Contact</a>
          </div>

          <div className="marketing-nav-mobile-cta">
            <MarketingNavActions signedIn={signedIn} mobile />
          </div>
        </div>
      </details>
    </nav>
  );
}

function MarketingNavActions({
  signedIn,
  mobile = false,
}: {
  signedIn: boolean;
  mobile?: boolean;
}) {
  const secondaryClassName = mobile ? "btn btn-lg" : "btn btn-sm";
  const primaryClassName = mobile ? "btn btn-primary btn-lg" : "btn btn-primary btn-sm";

  if (signedIn) {
    return (
      <Link href="/dashboard" className={primaryClassName}>
        <span>Dashboard</span>
        <Ic.ChevR className="b-icon" />
      </Link>
    );
  }

  return (
    <>
      <Link href="/signin" className={secondaryClassName}>
        Sign in
      </Link>
      <Link href="/signup" className={primaryClassName}>
        <span>Get started</span>
        <Ic.ChevR className="b-icon" />
      </Link>
    </>
  );
}
