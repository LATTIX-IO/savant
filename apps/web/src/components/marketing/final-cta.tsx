import Link from "next/link";

import { OrbitSystem } from "@/components/brand/orbit-system";
import { SignalStar } from "@/components/brand/signal-node";

export function FinalCTA({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="fc savant-dark" data-nav="" aria-labelledby="fc-title">
      <svg className="fc-orbit" viewBox="0 0 800 800" aria-hidden="true">
        <g className="fc-orbit-spin">
          <OrbitSystem cx={400} cy={400} r={300} />
        </g>
        <SignalStar cx={400} cy={400} r={46} className="fc-star" />
      </svg>

      <div className="shell fc-inner">
        <h2 id="fc-title" className="display-1 fc-title" data-reveal>
          Stop shipping expertise
          <br />
          on <em>trust</em>.
        </h2>
        <p className="fc-triad" data-reveal data-reveal-delay="1">
          <span>Evaluate it.</span> <span>Govern it.</span> <span>Improve it.</span>
        </p>
        <p className="fc-copy" data-reveal data-reveal-delay="1">
          Put your organization&apos;s expertise under governance. Connect a repository, watch the
          first evaluation run, and ship a signed release in under fifteen minutes.
        </p>
        <div className="fc-actions" data-reveal data-reveal-delay="2">
          {signedIn ? (
            <Link href="/dashboard" className="btn btn-primary btn-lg">
              Open dashboard
            </Link>
          ) : (
            <Link href="/signup" className="btn btn-primary btn-lg" data-track="cta_click" data-track-placement="final">
              Start free
            </Link>
          )}
          <a
            href="mailto:sales@savant.app"
            className="btn btn-outline btn-lg"
            data-track="sales_cta"
            data-track-placement="final"
          >
            Talk to sales
          </a>
        </div>
      </div>
    </section>
  );
}
