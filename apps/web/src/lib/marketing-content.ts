// Public marketing copy shared by the rendered pages and every machine-readable
// surface (JSON-LD, llms.txt, llms-full.txt). Keep answers self-contained: answer
// engines quote them verbatim, out of context.

export const PRODUCT_NAME = "Savant";
export const PRODUCT_TAGLINE = "The system of record for organizational skills";
export const PRODUCT_SUMMARY =
  "Savant is the enterprise platform for codifying expertise as governed, measurable, reusable skills. Teams version skills in Git, prove them with evaluations, govern every release under policy, keep every AI surface on the approved version, and improve skills from real use.";

export const PUBLISHER = {
  legalName: "Lattix Technologies Corp.",
  name: "Lattix Technologies",
  url: "https://lattix.io",
} as const;

export const CONTACT = {
  general: "hello@savant.app",
  sales: "sales@savant.app",
  security: "security@savant.app",
  legal: "legal@savant.app",
} as const;

export const PRICING = {
  currency: "USD",
  monthlyPerSeat: 1,
  annualPerSeat: 10,
  trialDays: 14,
  includes: [
    "Unlimited skills",
    "Evaluations",
    "Releases",
    "Repositories",
    "SSO + SCIM",
    "Distribution",
    "Audit",
    "Improvement recommendations",
  ],
} as const;

export const SUPPORTED_GIT_PROVIDERS = [
  "GitHub Cloud and Enterprise",
  "GitLab Cloud and self-managed",
  "Azure DevOps",
  "Bitbucket Cloud and Data Center",
  "Other Git hosts over SSH or HTTPS",
] as const;

export type DocsGuide = { id: string; title: string; body: string };

export const DOCS_GUIDES: DocsGuide[] = [
  {
    id: "connect",
    title: "Connect a repository",
    body: "Point Savant at the Git repository where your skills live — GitHub, GitLab, Azure DevOps, Bitbucket, or any Git host over SSH or HTTPS. Webhook sync registers each change as a candidate.",
  },
  {
    id: "evaluate",
    title: "Evaluate",
    body: "Check a rubric and a case set into the repository next to each skill. Savant scores every candidate with the model you choose and compares it with the current baseline.",
  },
  {
    id: "approve",
    title: "Approve",
    body: "Approval tiers and required reviewers are defined in policy. Owners, reviewers, and compliance act on one timeline for each candidate.",
  },
  {
    id: "release",
    title: "Release",
    body: "Approved versions are promoted draft → staging → production. Release records are signed and pinned to evaluated content; a regression pins the prior version automatically.",
  },
  {
    id: "distribute",
    title: "Distribute",
    body: "Released skills reach tools through native integrations or the managed sync agent for developer environments, and each surface reports the version it runs.",
  },
  {
    id: "audit",
    title: "Audit",
    body: "Every change, approval, release, and access event is recorded append-only and can be exported to your SIEM.",
  },
  {
    id: "improvement",
    title: "Improve",
    body: "Instrumented runtimes report skill runs. Savant measures outcomes, clusters failures, and proposes bounded improvements. Each candidate is validated against validation, regression, and holdout sets before a person reviews it; approval creates a new Git version that follows your release policy.",
  },
];

export type SecuritySection = { id: string; title: string; points: string[] };

export const SECURITY_SECTIONS: SecuritySection[] = [
  {
    id: "identity",
    title: "Identity and access",
    points: [
      "Single sign-on through Auth0 by default, or your own identity provider over OIDC or SAML.",
      "SCIM provisioning keeps members and groups aligned with your directory.",
      "Role-based access control; approval tiers and reviewers are defined in policy.",
    ],
  },
  {
    id: "data",
    title: "Data handling",
    points: [
      "Your Git repository remains the source of truth for skill content.",
      "Savant stores references to commits, evaluation results, release records, and audit events.",
      "Workspaces are tenant-isolated; access is always scoped to one workspace.",
    ],
  },
  {
    id: "provenance",
    title: "Provenance and release control",
    points: [
      "Every skill version resolves to a commit, and every release to evaluated content.",
      "Release records are signed; promotion runs draft → staging → production under policy.",
      "Auto-pin on regression holds the prior version; rollback is one action.",
    ],
  },
  {
    id: "audit",
    title: "Audit",
    points: [
      "Changes, approvals, releases, and access events are recorded append-only.",
      "Audit events can be exported to your SIEM.",
    ],
  },
  {
    id: "improvement",
    title: "Bounded improvement",
    points: [
      "Run telemetry is redacted and pseudonymized before analysis; capture level follows your tenant setting.",
      "The optimization worker holds no database, Git, or release credentials.",
      "Locked sections of a skill cannot be read or changed by the optimizer.",
      "Only authorized people approve a recommendation. There is no autonomous deployment mode.",
    ],
  },
];

export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Does Savant store our skill content?",
    a: "No. Your Git repository is the source of truth. Savant references commits and runs evaluations against them, but prompts, runbooks, and agent workflows stay in your environment.",
  },
  {
    q: "Which Git providers do you support?",
    a: "GitHub Cloud and Enterprise, GitLab Cloud and self-managed, Azure DevOps, Bitbucket Cloud and Data Center, and other Git deployments over SSH or HTTPS.",
  },
  {
    q: "What does an eval suite look like?",
    a: "A rubric and a case set, both checked into the repository. Savant scores each candidate with the model you choose, surfaces regressions against the baseline, and keeps results for the life of the release.",
  },
  {
    q: "Does Savant change skills on its own?",
    a: "No. Savant proposes improvements from run evidence and validates each candidate against the regression suite, but only authorized reviewers approve. An approved change becomes a new Git version and follows your existing release policy.",
  },
  {
    q: "How does authentication work?",
    a: "Auth0 by default, or bring your own identity provider over SAML or OIDC. Group membership drives RBAC, and SCIM keeps it in lockstep with your directory.",
  },
  {
    q: "What happens if a release regresses?",
    a: "Auto-pin on regression is a default policy: the prior version pins immediately, an incident opens, and the skill owner is notified. Manual rollback is one click.",
  },
  {
    q: "Do you offer a free trial?",
    a: "Yes. Every workspace starts with a 14-day trial with all workflows enabled. Cancel during the trial and you are not charged; after it, billing is per seat, monthly or annually.",
  },
];
