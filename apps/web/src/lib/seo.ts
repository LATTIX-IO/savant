import {
  CONTACT,
  DOCS_GUIDES,
  FAQ_ITEMS,
  PRICING,
  PRODUCT_NAME,
  PRODUCT_SUMMARY,
  PRODUCT_TAGLINE,
  PUBLISHER,
  SECURITY_SECTIONS,
  SUPPORTED_GIT_PROVIDERS,
} from "./marketing-content.ts";
import { resolveCanonicalWorkspaceOrigin, type WorkspaceUrlEnv } from "./workspace-url.ts";

export type SeoEnv = WorkspaceUrlEnv;

// ---------------------------------------------------------------------------
// Origin and indexability
// ---------------------------------------------------------------------------

/**
 * The single origin search and answer engines should attribute content to.
 * Canonicals always point here, even on preview deployments, so link equity
 * never splits across *.vercel.app hosts.
 */
export function resolveSiteOrigin(env: SeoEnv = process.env): string {
  return resolveCanonicalWorkspaceOrigin(env);
}

/**
 * Only the production deployment may be indexed. `SAVANT_SEO_INDEXING=0|1`
 * overrides the detection (for example to keep a soft launch dark).
 */
export function isIndexableDeployment(env: SeoEnv = process.env): boolean {
  const override = env.SAVANT_SEO_INDEXING?.trim();

  if (override === "0" || override === "false") return false;
  if (override === "1" || override === "true") return true;

  const vercelEnv = env.VERCEL_ENV?.trim();

  if (vercelEnv) {
    return vercelEnv === "production";
  }

  return env.NODE_ENV === "production";
}

// ---------------------------------------------------------------------------
// Route inventory
// ---------------------------------------------------------------------------

export type PublicRoute = {
  path: "/" | "/docs" | "/catalog" | "/security" | "/signup";
  title: string;
  description: string;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
};

export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    path: "/",
    title: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
    description:
      "Turn expertise into governed capability. Version skills in Git, prove them with evaluations, govern every release, keep every AI surface aligned, and improve skills from real use.",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/docs",
    title: "Docs",
    description:
      "Get started with Savant: connect a repository, evaluate, approve, release, distribute, audit, and improve skills.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    path: "/catalog",
    title: "Skill catalog",
    description:
      "Agent skills from Anthropic, OpenAI, skills.sh, ClawHub and SkillsMP, safety-scanned with NVIDIA SkillSpector and evaluated live by Savant.",
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    path: "/security",
    title: "Security",
    description:
      "How Savant protects governed skills: identity and access, Git provenance, signed releases, immutable audit, tenant isolation, and bounded improvement.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/signup",
    title: "Create your Savant workspace",
    description: "Start a 14-day Savant trial. Sign up and configure your workspace in under a minute.",
    changeFrequency: "monthly",
    priority: 0.5,
  },
];

/**
 * Authenticated surfaces and APIs. Disallowed in robots.txt so crawl budget is
 * not spent on login redirects.
 */
export const CRAWL_DISALLOWED_PREFIXES = [
  "/api",
  "/auth",
  "/o",
  "/dashboard",
  "/skills",
  "/repositories",
  "/evaluations",
  "/releases",
  "/intelligence",
  "/policies",
  "/audit",
  "/connectors",
  "/settings",
] as const;

/**
 * Everything that must never appear in search results or AI answers. Served
 * with `X-Robots-Tag: noindex`. Transactional pages are crawlable (not in
 * robots.txt) on purpose: a crawler has to fetch them to see the noindex.
 */
export const NOINDEX_PATH_PREFIXES = [...CRAWL_DISALLOWED_PREFIXES, "/auth-status", "/onboarding", "/signin"] as const;

export function isNoindexPath(pathname: string): boolean {
  return NOINDEX_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/**
 * Crawlers named explicitly so the policy is legible, and so an edge layer
 * (for example Cloudflare's managed robots.txt) that adds a per-bot Disallow
 * group is visibly contradicting ours. Grouped by what the crawl feeds.
 */
export const AI_CRAWLERS = {
  // Retrieval for live answers and citations (AEO/GEO). Blocking these removes
  // Savant from ChatGPT search, Claude, Perplexity, Copilot, and similar.
  answer: [
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
    "DuckAssistBot",
    "MistralAI-User",
  ],
  // Model training corpora. Allowed so models learn what Savant is.
  training: [
    "GPTBot",
    "ClaudeBot",
    "Google-Extended",
    "Applebot-Extended",
    "Amazonbot",
    "meta-externalagent",
    "CCBot",
  ],
} as const;

/**
 * Cloudflare Content Signals (https://contentsignals.org). Declares that the
 * public marketing content may be used for search, AI answers, and training.
 */
export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=yes";

export function buildRobotsTxt({ origin, indexable }: { origin: string; indexable: boolean }): string {
  if (!indexable) {
    return ["# Non-production deployment: nothing here should be indexed.", "User-agent: *", "Disallow: /", ""].join(
      "\n",
    );
  }

  const rules = ["Allow: /", ...CRAWL_DISALLOWED_PREFIXES.map((prefix) => `Disallow: ${prefix}/`)];
  const aiAgents = [...AI_CRAWLERS.answer, ...AI_CRAWLERS.training];

  return [
    `# ${origin}/robots.txt`,
    "# Public product pages are open to search engines and AI answer engines.",
    "# Workspaces, APIs, and auth flows are private and never indexed.",
    `# Machine-readable product summary: ${origin}/llms.txt`,
    "",
    "User-agent: *",
    `Content-Signal: ${CONTENT_SIGNAL}`,
    ...rules,
    "",
    ...aiAgents.map((agent) => `User-agent: ${agent}`),
    `Content-Signal: ${CONTENT_SIGNAL}`,
    ...rules,
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// llms.txt (https://llmstxt.org)
// ---------------------------------------------------------------------------

function formatPrice(amount: number): string {
  return `$${amount}`;
}

function pricingSentence(): string {
  return `${formatPrice(PRICING.monthlyPerSeat)} per user per month, or ${formatPrice(PRICING.annualPerSeat)} per user per year, billed in ${PRICING.currency} with no platform fee. Every workspace starts with a ${PRICING.trialDays}-day free trial with all workflows enabled.`;
}

export function buildLlmsTxt(origin: string): string {
  const url = (path: string) => `${origin}${path === "/" ? "" : path}`;

  return [
    `# ${PRODUCT_NAME}`,
    "",
    `> ${PRODUCT_SUMMARY}`,
    "",
    `${PRODUCT_NAME} is built by ${PUBLISHER.legalName}. Skill content stays in the customer's own Git repository; ${PRODUCT_NAME} references commits and records evaluations, approvals, releases, and audit events around them.`,
    "",
    "Key facts:",
    `- Category: AI skill governance / agent skill management platform (SaaS).`,
    `- Pricing: ${pricingSentence()}`,
    `- Git providers: ${SUPPORTED_GIT_PROVIDERS.join("; ")}.`,
    "- Identity: Auth0 single sign-on by default, or your own OIDC or SAML provider; SCIM provisioning; role-based access control.",
    "- Improvements are proposed from run evidence and validated, but only authorized people approve them. There is no autonomous deployment mode.",
    "",
    "## Product",
    "",
    `- [Overview](${url("/")}): What ${PRODUCT_NAME} does, the governance lifecycle, pricing, and FAQ.`,
    `- [Docs](${url("/docs")}): Getting started — connect, evaluate, approve, release, distribute, audit, improve.`,
    `- [Security](${url("/security")}): Identity, data handling, provenance, audit, and bounded improvement.`,
    `- [Start a trial](${url("/signup")}): Create a workspace with a ${PRICING.trialDays}-day free trial.`,
    "",
    "## Optional",
    "",
    `- [Full text](${url("/llms-full.txt")}): Every public page's content as plain Markdown.`,
    `- [Contact](mailto:${CONTACT.general}): General questions. Sales: ${CONTACT.sales}. Security reports: ${CONTACT.security}.`,
    "",
  ].join("\n");
}

export function buildLlmsFullTxt(origin: string): string {
  const lines: string[] = [
    `# ${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
    "",
    `> ${PRODUCT_SUMMARY}`,
    "",
    `Source: ${origin}. Publisher: ${PUBLISHER.legalName}.`,
    "",
    "## Pricing",
    "",
    pricingSentence(),
    "",
    "Included in the single plan:",
    ...PRICING.includes.map((item) => `- ${item}`),
    "",
    `## Getting started (${origin}/docs)`,
    "",
  ];

  DOCS_GUIDES.forEach((guide, index) => {
    lines.push(`### ${index + 1}. ${guide.title}`, "", guide.body, "");
  });

  lines.push(`## Security (${origin}/security)`, "");

  for (const section of SECURITY_SECTIONS) {
    lines.push(`### ${section.title}`, "", ...section.points.map((point) => `- ${point}`), "");
  }

  lines.push(
    `Report vulnerabilities to ${CONTACT.security}.`,
    "",
    "## Frequently asked questions",
    "",
  );

  for (const item of FAQ_ITEMS) {
    lines.push(`### ${item.q}`, "", item.a, "");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Structured data (schema.org JSON-LD)
// ---------------------------------------------------------------------------

type JsonLdNode = Record<string, unknown>;

export function buildSiteJsonLd(origin: string): JsonLdNode {
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const softwareId = `${origin}/#software`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: PRODUCT_NAME,
        legalName: PUBLISHER.legalName,
        url: origin,
        logo: {
          "@type": "ImageObject",
          url: `${origin}/brand/savant-logo-light.svg`,
        },
        email: CONTACT.general,
        contactPoint: [
          { "@type": "ContactPoint", contactType: "sales", email: CONTACT.sales },
          { "@type": "ContactPoint", contactType: "customer support", email: CONTACT.general },
          { "@type": "ContactPoint", contactType: "security", email: CONTACT.security },
        ],
        parentOrganization: {
          "@type": "Organization",
          name: PUBLISHER.legalName,
          url: PUBLISHER.url,
        },
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: origin,
        name: PRODUCT_NAME,
        description: PRODUCT_SUMMARY,
        inLanguage: "en",
        publisher: { "@id": organizationId },
      },
      {
        "@type": "SoftwareApplication",
        "@id": softwareId,
        name: PRODUCT_NAME,
        description: PRODUCT_SUMMARY,
        url: origin,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "AI skill governance",
        operatingSystem: "Web",
        publisher: { "@id": organizationId },
        featureList: [
          "Git-backed skill versioning",
          "Evaluation suites with regression detection",
          "Policy-based approvals and signed releases",
          "Distribution to AI tools with version reporting",
          "Append-only audit with SIEM export",
          "Human-approved improvement recommendations",
        ],
        offers: [
          {
            "@type": "Offer",
            name: "Monthly, per seat",
            price: PRICING.monthlyPerSeat,
            priceCurrency: PRICING.currency,
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: PRICING.monthlyPerSeat,
              priceCurrency: PRICING.currency,
              referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitText: "user" },
              billingDuration: "P1M",
            },
            url: `${origin}/signup?cycle=monthly`,
          },
          {
            "@type": "Offer",
            name: "Annual, per seat",
            price: PRICING.annualPerSeat,
            priceCurrency: PRICING.currency,
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: PRICING.annualPerSeat,
              priceCurrency: PRICING.currency,
              referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitText: "user" },
              billingDuration: "P1Y",
            },
            url: `${origin}/signup?cycle=annual`,
          },
        ],
      },
    ],
  };
}

export function buildFaqJsonLd(origin: string): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${origin}/#faq`,
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function buildBreadcrumbJsonLd(origin: string, trail: { name: string; path: string }[]): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: PRODUCT_NAME, path: "/" }, ...trail].map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${origin}${crumb.path === "/" ? "" : crumb.path}`,
    })),
  };
}

export function buildDocsJsonLd(origin: string): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": `${origin}/docs#howto`,
    name: "Get started with Savant",
    description: "Connect a repository, evaluate, approve, release, distribute, audit, and improve governed skills.",
    step: DOCS_GUIDES.map((guide, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: guide.title,
      text: guide.body,
      url: `${origin}/docs#${guide.id}`,
    })),
  };
}

/** JSON for a `<script type="application/ld+json">`, safe against `</script>` breakouts. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// ---------------------------------------------------------------------------
// IndexNow (Bing, Yandex, Seznam, Naver; also fed by Cloudflare Crawler Hints)
// ---------------------------------------------------------------------------

/** IndexNow keys are 8–128 characters of [a-zA-Z0-9-]. */
export function resolveIndexNowKey(env: SeoEnv = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim();

  return key && /^[a-zA-Z0-9-]{8,128}$/.test(key) ? key : null;
}
