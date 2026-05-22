import type { ReactNode } from "react";
import "./marketing.css";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="marketing">{children}</div>;
}
