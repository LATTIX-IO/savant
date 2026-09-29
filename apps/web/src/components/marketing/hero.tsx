import Link from "next/link";

import { HeroSystem } from "./hero-system";

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="hero" data-nav="" aria-labelledby="hero-title">
      <div className="shell hero-grid">
        <div className="hero-copy">
          <p className="hero-eyebrow">The system of record for organizational skills</p>
          <h1 id="hero-title" className="display-1 hero-title">
            Turn expertise into
            <br />
            <em>governed</em> capability.
          </h1>
          <p className="hero-sub">
            Codify expertise as versioned skills, prove they work, govern every release, and keep
            every AI surface aligned.
          </p>
          <div className="hero-ctas">
            {signedIn ? (
              <Link href="/dashboard" className="btn btn-primary btn-lg">
                Go to dashboard
              </Link>
            ) : (
              <Link
                href="/signup"
                className="btn btn-primary btn-lg"
                data-track="hero_primary_cta"
                data-track-placement="hero"
              >
                Start free
              </Link>
            )}
            <a href="#how-it-works" className="link-arrow" data-track="hero_secondary_cta">
              See how Savant works
            </a>
          </div>
          <ul className="hero-proof" aria-label="Foundations">
            <li>Git-backed</li>
            <li>Eval-driven</li>
            <li>SSO-controlled</li>
            <li>Audit-ready</li>
          </ul>
        </div>

        <div className="hero-visual">
          <HeroSystem />
        </div>
      </div>
    </section>
  );
}
