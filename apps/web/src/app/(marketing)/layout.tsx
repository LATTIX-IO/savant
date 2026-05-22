import type { ReactNode } from "react";
import "./marketing.css";

import { ScrollRevealObserver } from "@/components/marketing/scroll-reveal";
import { TweaksProvider } from "@/components/savant/tweaks-context";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <TweaksProvider>
      <div className="marketing">
        <ScrollRevealObserver />
        {children}
      </div>
    </TweaksProvider>
  );
}
