import Link from "next/link";

import { SectionHead } from "./section-head";

const GROUPS = [
  {
    name: "Identity",
    controls: [
      { name: "SSO — OIDC and SAML", detail: "Auth0 by default, or bring your own identity provider." },
      { name: "SCIM provisioning", detail: "Membership and groups stay in lockstep with your directory." },
      { name: "RBAC + policy controls", detail: "Roles and approval tiers codified in policy, not chat." },
    ],
  },
  {
    name: "Provenance",
    controls: [
      { name: "Git provenance", detail: "Every version resolves to a commit in your own repository." },
      { name: "Signed releases", detail: "Release records are signed and pinned to evaluated content." },
      { name: "Immutable audit history", detail: "Append-only events for every change, approval, and rollout." },
    ],
  },
  {
    name: "Operations",
    controls: [
      { name: "Rollback", detail: "Auto-pin on regression; one-click return to a prior release." },
      { name: "SIEM export", detail: "Stream audit events to the tools your security team runs." },
      { name: "Tenant isolation", detail: "Each workspace is isolated, and skill content stays in your Git." },
    ],
  },
];

export function EnterpriseTrust() {
  return (
    <section className="section section-alt" id="security" data-nav="security" aria-labelledby="trust-title">
      <div className="shell">
        <SectionHead
          id="trust-title"
          index="07"
          meta="Built for enterprise control"
          title={
            <>
              Governance isn&apos;t an enterprise add-on.
              <br />
              It&apos;s the <em>product</em>.
            </>
          }
        >
          <p>
            Identity, permissions, provenance, policy, audit, and rollback are part of every plan,
            because a skill you can&apos;t trace is a skill you can&apos;t ship.
          </p>
        </SectionHead>

        <div className="tm" data-reveal>
          {GROUPS.map((group) => (
            <div key={group.name} className="tm-group">
              <h3 className="tm-group-name">{group.name}</h3>
              <ul>
                {group.controls.map((control) => (
                  <li key={control.name}>
                    <span className="tm-check" aria-hidden="true" />
                    <span className="tm-name">{control.name}</span>
                    <span className="tm-detail">{control.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="section-cta section-cta-quiet">
          <Link href="/security" className="link-arrow" data-track="security_link" data-track-placement="trust">
            Review Savant security architecture
          </Link>
        </div>
      </div>
    </section>
  );
}
