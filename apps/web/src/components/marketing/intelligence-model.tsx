import { SavantIcon } from "@/components/brand/savant-icon";

import { SectionHead } from "./section-head";

const TIERS = [
  {
    tier: "Tier 1",
    name: "Standards",
    summary: "Organization-wide rules every skill inherits.",
    items: ["Writing", "Governance", "Security", "Brand", "Evidence"],
    link: "inherited by",
  },
  {
    tier: "Tier 2",
    name: "Expertise",
    summary: "Domain methods owned by the teams who practise them.",
    items: ["Architecture", "Sales", "Research", "Engineering", "Operations"],
    link: "specialized into",
  },
  {
    tier: "Tier 3",
    name: "Workflows",
    summary: "How work actually gets done, for a person, team, or customer.",
    items: ["Personal", "Team", "Role", "Customer", "Context"],
  },
];

export function IntelligenceModel() {
  return (
    <section className="section section-alt" id="intelligence" data-nav="product" aria-labelledby="intel-title">
      <div className="shell">
        <SectionHead id="intel-title" index="03" meta="Organizational intelligence" title="Expertise becomes infrastructure.">
          <p>
            Savant turns organizational methods, standards, and expert workflows into measurable
            capabilities that can be reused across people and AI. Each tier inherits from the one
            above it, so a change to a standard reaches every skill that depends on it.
          </p>
        </SectionHead>

        <div className="im" data-reveal>
          <div className="im-root">
            <SavantIcon size={28} />
            <span>Organization</span>
          </div>

          <ol className="im-tiers">
            {TIERS.map((tier, index) => (
              <li key={tier.name} className="im-tier">
                <div className="im-tier-head">
                  <span className="im-tier-num">{tier.tier}</span>
                  <h3 className="im-tier-name">{tier.name}</h3>
                  <p className="im-tier-summary">{tier.summary}</p>
                </div>
                <ul className="im-items" aria-label={`${tier.name} skills`}>
                  {tier.items.map((item) => (
                    <li key={item}>
                      <span className="im-node" aria-hidden="true" data-tier={index + 1} />
                      {item}
                    </li>
                  ))}
                </ul>
                {tier.link ? (
                  <div className="im-link">
                    <span aria-hidden="true">↓</span> {tier.link}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
