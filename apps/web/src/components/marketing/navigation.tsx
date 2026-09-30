"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SavantLogo } from "@/components/brand/savant-logo";
import { isMarketingNavSolid } from "@/lib/marketing-nav-state";

export type NavKey = "product" | "how" | "catalog" | "security" | "pricing" | "docs";

const NAV_ITEMS: { key: NavKey; label: string; href: Route }[] = [
  { key: "product", label: "Product", href: "/#product" },
  { key: "how", label: "How it works", href: "/#how-it-works" },
  { key: "catalog", label: "Catalog", href: "/catalog" },
  { key: "security", label: "Security", href: "/security" },
  { key: "pricing", label: "Pricing", href: "/#pricing" },
  { key: "docs", label: "Docs", href: "/docs" },
];

/**
 * Sticky primary navigation. Transparent over the hero, a translucent Cloud
 * surface with a hairline rule once scrolled. On the landing page the active
 * item follows the section in view (`[data-nav]` on each section); other pages
 * pin it with `current`.
 */
export function Navigation({ signedIn, current }: { signedIn: boolean; current?: NavKey | undefined }) {
  const [solid, setSolid] = useState(false);
  const [spied, setSpied] = useState<NavKey | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const sync = () => setSolid(isMarketingNavSolid(window.scrollY));
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  useEffect(() => {
    if (current || typeof IntersectionObserver === "undefined") return undefined;

    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-nav]"));
    if (sections.length === 0) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setSpied(((entry.target as HTMLElement).dataset.nav || null) as NavKey | null);
          }
        }
      },
      // A thin band across the middle of the viewport decides the active section.
      { rootMargin: "-45% 0px -54% 0px" },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [current]);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const active = current ?? spied;

  return (
    <header className="site-nav" data-solid={solid || open ? "true" : "false"}>
      <nav className="nav-inner" aria-label="Primary">
        <Link href="/" className="nav-brand" aria-label="Savant home">
          <SavantLogo variant="wordmark" label="Savant" />
        </Link>

        <ul className="nav-links">
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active === item.key ? (current ? "page" : "location") : undefined}
                data-track={item.key === "security" ? "security_link" : undefined}
                data-track-placement="nav"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="nav-actions">
          <NavActions signedIn={signedIn} />
        </div>

        <div className="nav-mobile-actions">
          {signedIn ? null : (
            <Link href="/signup" className="btn btn-primary btn-sm" data-track="cta_click" data-track-placement="nav_mobile">
              Start free
            </Link>
          )}
          <button
            ref={triggerRef}
            type="button"
            className="nav-menu-trigger"
            aria-expanded={open}
            aria-controls="nav-mobile-panel"
            onClick={() => setOpen((value) => !value)}
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <span className="nav-menu-glyph" aria-hidden="true" data-open={open}>
              <span />
              <span />
            </span>
          </button>
        </div>
      </nav>

      <div
        id="nav-mobile-panel"
        ref={panelRef}
        className="nav-mobile-panel"
        hidden={!open}
      >
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active === item.key ? (current ? "page" : "location") : undefined}
                onClick={() => setOpen(false)}
                data-track={item.key === "security" ? "security_link" : undefined}
                data-track-placement="nav_mobile"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="nav-mobile-cta">
          <NavActions signedIn={signedIn} large />
        </div>
      </div>
    </header>
  );
}

function NavActions({ signedIn, large = false }: { signedIn: boolean; large?: boolean }) {
  const size = large ? "btn-lg" : "btn-sm";

  if (signedIn) {
    return (
      <Link href="/dashboard" className={`btn btn-primary ${size}`}>
        Dashboard
      </Link>
    );
  }

  return (
    <>
      <Link href="/signin" className={`btn btn-quiet ${size}`}>
        Sign in
      </Link>
      <Link href="/signup" className={`btn btn-primary ${size}`} data-track="cta_click" data-track-placement="nav">
        Start free
      </Link>
    </>
  );
}
