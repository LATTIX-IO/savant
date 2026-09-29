import Link from "next/link";

import { SavantLogo } from "@/components/brand/savant-logo";

export function Footer() {
  return (
    <footer className="ft">
      <div className="shell ft-inner">
        <div className="ft-brand">
          <SavantLogo variant="lockup" label="Savant — skills governed, greater outcomes" />
          <p>The system of record for organizational skills.</p>
        </div>
        <nav className="ft-cols" aria-label="Footer">
          <div>
            <h2>Product</h2>
            <ul>
              <li><Link href="/#product">Product</Link></li>
              <li><Link href="/#how-it-works">How it works</Link></li>
              <li><Link href="/#pricing">Pricing</Link></li>
              <li><Link href="/docs">Docs</Link></li>
            </ul>
          </div>
          <div>
            <h2>Trust</h2>
            <ul>
              <li><Link href="/security" data-track="security_link" data-track-placement="footer">Security</Link></li>
              <li><a href="mailto:security@savant.app">Report a vulnerability</a></li>
            </ul>
          </div>
          <div>
            <h2>Company</h2>
            <ul>
              <li><a href="mailto:hello@savant.app">Contact</a></li>
              <li><a href="mailto:sales@savant.app" data-track="sales_cta" data-track-placement="footer">Sales</a></li>
            </ul>
          </div>
          <div>
            <h2>Legal</h2>
            <ul>
              <li><a href="mailto:legal@savant.app?subject=Terms">Terms</a></li>
              <li><a href="mailto:legal@savant.app?subject=Privacy">Privacy</a></li>
              <li><a href="mailto:legal@savant.app?subject=DPA">DPA</a></li>
            </ul>
          </div>
        </nav>
      </div>
      <div className="shell ft-base">
        <span>© {new Date().getFullYear()} Lattix Technologies Corp.</span>
        <span className="ft-status">
          <span className="ft-status-dot" aria-hidden="true" />
          Git-backed · Eval-driven · Audit-ready
        </span>
      </div>
    </footer>
  );
}
