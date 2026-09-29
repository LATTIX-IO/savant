import type { ReactNode } from "react";

import "@/styles/tokens.css";
import "./site.css";

import { displayFont } from "@/styles/fonts";

import { Footer } from "./footer";
import { MarketingAnalytics } from "./marketing-analytics";
import { Navigation, type NavKey } from "./navigation";

/**
 * Shell for public marketing pages (landing, security, docs): identity tokens,
 * the display face, navigation, footer, and conversion instrumentation.
 */
export function SiteFrame({
  signedIn,
  current,
  children,
}: {
  signedIn: boolean;
  current?: NavKey | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`savant-theme site ${displayFont.variable}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Navigation signedIn={signedIn} current={current} />
      <main id="main">{children}</main>
      <Footer />
      <MarketingAnalytics />
    </div>
  );
}
