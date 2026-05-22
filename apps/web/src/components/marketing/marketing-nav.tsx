/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { isMarketingNavSolid } from "@/lib/marketing-nav-state";

export function MarketingNav({ signedIn }: { signedIn: boolean }) {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const sync = () => setSolid(isMarketingNavSolid(window.scrollY));
    sync();

    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  return (
    <nav className="marketing-nav" data-contrast={solid ? "solid" : "hero"} aria-label="Primary">
      <Link href="/" className="marketing-brand" aria-label="Savant home">
        <span className="savant-logo marketing-brand-logo" aria-hidden="true">
          <img
            className={`savant-logo-image ${solid ? "savant-logo-image-light-surface" : "savant-logo-image-dark-surface"}`}
            src={solid ? "/brand/savant-light.png" : "/brand/savant-dark.png"}
            alt=""
            width={solid ? 612 : 1536}
            height={solid ? 408 : 1024}
            draggable={false}
            decoding="async"
          />
        </span>
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
