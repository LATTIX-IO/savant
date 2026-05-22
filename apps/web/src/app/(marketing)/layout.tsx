import type { ReactNode } from "react";
import "./marketing.css";

import { ScrollRevealObserver } from "@/components/marketing/scroll-reveal";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing">
      <ScrollRevealObserver />
      {children}
    </div>
  );
}
