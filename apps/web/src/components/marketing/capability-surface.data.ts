export type PlatformPreviewIconKey =
  | "overview"
  | "skills"
  | "repo"
  | "eval"
  | "release"
  | "policy"
  | "audit"
  | "connectors";

export type PlatformPreviewNavItem = {
  icon: PlatformPreviewIconKey;
  label: string;
  count?: string;
  active?: boolean;
};

export type PlatformPreviewNavGroup = {
  label: string;
  items: PlatformPreviewNavItem[];
};

export type PlatformPreviewKpi = {
  label: string;
  value: string;
  unit?: string;
  deltaLabel: string;
  trend: "up" | "down" | "flat";
};

export type PlatformPreviewApproval = {
  skill: string;
  change: string;
  tier: 1 | 2 | 3;
  version: string;
  blocking: string;
  when: string;
};

export type PlatformPreviewRecentChange = {
  skill: string;
  ref: string;
  who: string;
  env: "draft" | "staging" | "production";
  delta: string;
  when: string;
};

export type PlatformPreviewRegression = {
  skill: string;
  metric: string;
  from: string;
  to: string;
  severity: "critical" | "moderate" | "minor";
};

export type PlatformPreviewRepository = {
  provider: "github" | "gitlab" | "azure";
  name: string;
  branch: string;
  skills: number;
  status: "ok" | "attention" | "offline";
  when: string;
};

export type PlatformPreviewAuditEvent = {
  who: string;
  action: string;
  target: string;
  when: string;
  node: "moss" | "brass" | "slate" | "blood";
};

export type PlatformPreviewReleaseQueueItem = {
  skill: string;
  candidateRef: string;
  candidateCommit: string;
  approvals: string;
  route: "draft-to-staging" | "staging-to-production";
  requested: string;
  when: string;
};

export const PLATFORM_PREVIEW_NAV: PlatformPreviewNavGroup[] = [
  {
    label: "Workspace",
    items: [
      { icon: "overview", label: "Overview", active: true },
      { icon: "skills", label: "Skills", count: "9" },
      { icon: "repo", label: "Repositories", count: "5" },
      { icon: "eval", label: "Evaluations", count: "1" },
      { icon: "release", label: "Releases", count: "3" },
    ],
  },
  {
    label: "Governance",
    items: [
      { icon: "policy", label: "Policies", count: "5" },
      { icon: "audit", label: "Audit" },
      { icon: "connectors", label: "Connectors", count: "10" },
    ],
  },
];

export const PLATFORM_PREVIEW_KPIS: PlatformPreviewKpi[] = [
  { label: "Skills in production", value: "147", deltaLabel: "▲ 6 this week", trend: "up" },
  { label: "Eval coverage", value: "94", unit: "%", deltaLabel: "▲ 2.1 pts", trend: "up" },
  { label: "First-pass acceptance", value: "81", unit: "%", deltaLabel: "▲ 0.4 pts", trend: "up" },
  { label: "Release turnaround", value: "2.4", unit: "d", deltaLabel: "▼ 0.6d", trend: "down" },
];

export const PLATFORM_PREVIEW_APPROVALS: PlatformPreviewApproval[] = [
  {
    skill: "Contract Clause Reviewer",
    change: "+12 evals · 2 regressions",
    tier: 1,
    version: "v2.4.0",
    blocking: "security",
    when: "8m ago",
  },
  {
    skill: "PR Summarizer",
    change: "rubric uplift +4.2",
    tier: 2,
    version: "v1.8.3",
    blocking: "owner",
    when: "31m ago",
  },
  {
    skill: "Incident Triage",
    change: "guardrail update",
    tier: 1,
    version: "v3.1.0",
    blocking: "compliance",
    when: "1h ago",
  },
  {
    skill: "RFP Response Drafter",
    change: "first release candidate",
    tier: 2,
    version: "v0.9.0",
    blocking: "owner",
    when: "2h ago",
  },
];

export const PLATFORM_PREVIEW_RECENT_CHANGES: PlatformPreviewRecentChange[] = [
  { skill: "Quarterly Earnings Summary", ref: "8a3cf2", who: "min.park", env: "draft", delta: "+1.8", when: "4m ago" },
  { skill: "SOC 2 Evidence Drafter", ref: "1bea9c", who: "sasha.gw", env: "staging", delta: "+0.4", when: "26m ago" },
  { skill: "Vendor Onboarding Memo", ref: "c0918bd", who: "min.park", env: "draft", delta: "-0.2", when: "1h ago" },
  { skill: "Engineering RFC Reviewer", ref: "a1b9f32", who: "ari.chen", env: "production", delta: "+2.1", when: "3h ago" },
  { skill: "Customer Email Tone Pass", ref: "44d1ab0", who: "renata.m", env: "production", delta: "+0.0", when: "6h ago" },
];

export const PLATFORM_PREVIEW_REGRESSIONS: PlatformPreviewRegression[] = [
  { skill: "Contract Clause Reviewer", metric: "Clause extraction precision", from: "0.94", to: "0.91", severity: "moderate" },
  { skill: "Contract Clause Reviewer", metric: "Tone compliance", from: "0.97", to: "0.95", severity: "minor" },
  { skill: "Incident Triage", metric: "Latency P95", from: "2.8", to: "4.4", severity: "critical" },
];

export const PLATFORM_PREVIEW_REPOSITORIES: PlatformPreviewRepository[] = [
  { provider: "github", name: "wh/skills", branch: "main", skills: 28, status: "ok", when: "12m ago" },
  { provider: "github", name: "wh/legal-skills", branch: "main", skills: 9, status: "ok", when: "1h ago" },
  { provider: "gitlab", name: "research/internal-tools", branch: "trunk", skills: 14, status: "attention", when: "3h ago" },
  { provider: "azure", name: "platform/agent-skills", branch: "main", skills: 18, status: "ok", when: "11m ago" },
  { provider: "github", name: "ops/runbooks", branch: "develop", skills: 6, status: "offline", when: "2d ago" },
];

export const PLATFORM_PREVIEW_AUDIT: PlatformPreviewAuditEvent[] = [
  { who: "ari.chen", action: "promoted", target: "Skill Engineering RFC Reviewer → production", when: "12m ago", node: "moss" },
  { who: "compliance", action: "held approval", target: "Contract Clause Reviewer · v2.4.0-rc.2", when: "44m ago", node: "brass" },
  { who: "sso/okta group sync", action: "added", target: "3 members → legal-readers", when: "1h ago", node: "slate" },
  { who: "jdv", action: "rolled back", target: "Incident Triage → v2.9.4", when: "3h ago", node: "blood" },
];

export const PLATFORM_PREVIEW_RELEASE_QUEUE: PlatformPreviewReleaseQueueItem[] = [
  {
    skill: "Contract Clause Reviewer",
    candidateRef: "v2.4.0-rc.2",
    candidateCommit: "8a3cf2",
    approvals: "2/3 approvals",
    route: "staging-to-production",
    requested: "requested by ari.chen",
    when: "next 2h",
  },
  {
    skill: "RFP Response Drafter",
    candidateRef: "v0.9.0",
    candidateCommit: "c0918bd",
    approvals: "1/2 approvals",
    route: "draft-to-staging",
    requested: "requested by renata.m",
    when: "later today",
  },
];