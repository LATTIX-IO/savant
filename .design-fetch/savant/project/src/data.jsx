// data.jsx — sample governance/skill data used across screens.
// Conservative copy in the operational/calm tone called for by the spec.

const ORG = {
  name: "Wexler & Hahn",
  short: "W&H",
  env: "production",
  user: { name: "Priya Aronson", role: "Platform admin", initials: "PA" },
};

const REPOS = [
  { id: "wh-skills",     provider: "github",   name: "wh/skills",                branch: "main",     skills: 28, lastSync: "12m ago", status: "ok" },
  { id: "wh-rev",        provider: "github",   name: "wh/legal-skills",          branch: "main",     skills:  9, lastSync: "1h ago",  status: "ok" },
  { id: "wh-research",   provider: "gitlab",   name: "research/internal-tools",  branch: "trunk",    skills: 14, lastSync: "3h ago",  status: "warn" },
  { id: "wh-platform",   provider: "azure",    name: "platform/agent-skills",    branch: "main",     skills: 18, lastSync: "11m ago", status: "ok" },
  { id: "wh-bb",         provider: "bitbucket",name: "ops/runbooks",             branch: "develop",  skills:  6, lastSync: "2d ago",  status: "stale" },
];

const APPROVALS = [
  { id: "a1", skill: "Contract Clause Reviewer",  tier: "T1", version: "2.4.0", change: "+12 evals · 2 regressions", who: "ari.chen",   when: "8m ago",  blocking: "security" },
  { id: "a2", skill: "PR Summarizer",             tier: "T2", version: "1.8.3", change: "rubric uplift +4.2",        who: "kalia.b",    when: "31m ago", blocking: "owner" },
  { id: "a3", skill: "Incident Triage",           tier: "T1", version: "3.1.0", change: "guardrails update",         who: "jdv",        when: "1h ago",  blocking: "compliance" },
  { id: "a4", skill: "RFP Response Drafter",      tier: "T2", version: "0.9.0", change: "first release candidate",   who: "renata.m",   when: "2h ago",  blocking: "owner" },
];

const RECENT_CHANGES = [
  { skill: "Quarterly Earnings Summary",  ref: "8a31cf2", who: "min.park",  when: "4m ago",  delta: "+1.8", env: "draft" },
  { skill: "SOC 2 Evidence Drafter",      ref: "1bea90e", who: "sasha.gw",  when: "26m ago", delta: "+0.4", env: "staging" },
  { skill: "Vendor Onboarding Memo",      ref: "c0918dd", who: "min.park",  when: "1h ago",  delta: "-0.2", env: "draft" },
  { skill: "Engineering RFC Reviewer",    ref: "a13f9c2", who: "ari.chen",  when: "3h ago",  delta: "+2.1", env: "production" },
  { skill: "Customer Email Tone Pass",    ref: "44dd1ab", who: "renata.m",  when: "6h ago",  delta: "flat", env: "production" },
];

const REGRESSIONS = [
  { skill: "Contract Clause Reviewer", metric: "Clause-extraction precision", from: 0.94, to: 0.91, severity: "moderate" },
  { skill: "Contract Clause Reviewer", metric: "Tone compliance",             from: 0.97, to: 0.95, severity: "minor" },
  { skill: "Incident Triage",          metric: "Latency P95",                 from: 2.8,  to: 4.4,  severity: "critical", unit: "s" },
];

const SKILLS = [
  {
    id: "skl_ccr", name: "Contract Clause Reviewer",
    description: "Reviews vendor contracts for non-standard clauses and flags departures from the master playbook.",
    tier: 1, owner: "ari.chen", team: "Legal Ops",
    repo: "wh/legal-skills", repoProvider: "github",
    ref: "v2.3.7", commit: "a13f9c2", branch: "main",
    candidateRef: "v2.4.0-rc.2", candidateCommit: "8a31cf2",
    versionCount: 18, prodEnv: "production", channel: "production",
    score: 91.4, trend: [86, 87, 88, 90, 89, 91, 91, 92, 91, 91.4],
    accessGroup: "legal-readers", lastEval: "12m ago",
    status: "candidate-awaiting-approval",
  },
  {
    id: "skl_prs", name: "PR Summarizer",
    description: "Summarizes pull requests with risk analysis, dependency notes, and reviewer suggestions.",
    tier: 2, owner: "kalia.b", team: "Developer Productivity",
    repo: "wh/skills", repoProvider: "github",
    ref: "v1.8.2", commit: "44dd1ab", branch: "main",
    candidateRef: "v1.8.3-rc.1", candidateCommit: "c918aef",
    versionCount: 42, prodEnv: "production", channel: "production",
    score: 88.0, trend: [80, 82, 81, 84, 86, 87, 88, 88, 88, 88],
    accessGroup: "engineering-all", lastEval: "31m ago",
    status: "production",
  },
  {
    id: "skl_itr", name: "Incident Triage",
    description: "Triages alerts, suggests runbook steps, and drafts the customer-facing status update.",
    tier: 1, owner: "jdv", team: "SRE",
    repo: "platform/agent-skills", repoProvider: "azure",
    ref: "v3.0.1", commit: "5fa12bb", branch: "main",
    candidateRef: "v3.1.0-rc.4", candidateCommit: "9d2c14e",
    versionCount: 27, prodEnv: "production", channel: "production",
    score: 93.2, trend: [88, 89, 90, 91, 92, 93, 93, 92, 93, 93.2],
    accessGroup: "sre-oncall", lastEval: "1h ago",
    status: "candidate-running-evals",
  },
  {
    id: "skl_rfp", name: "RFP Response Drafter",
    description: "Drafts first-pass RFP responses using prior accepted bids and the security questionnaire library.",
    tier: 2, owner: "renata.m", team: "Sales Engineering",
    repo: "wh/skills", repoProvider: "github",
    ref: "—", commit: "—", branch: "—",
    candidateRef: "v0.9.0", candidateCommit: "01a8cba",
    versionCount: 4, prodEnv: "—", channel: "draft",
    score: null, trend: [],
    accessGroup: "se-team", lastEval: "—",
    status: "first-release",
  },
  {
    id: "skl_soc", name: "SOC 2 Evidence Drafter",
    description: "Drafts SOC 2 control evidence from system logs and policy documents.",
    tier: 1, owner: "sasha.gw", team: "Security & Compliance",
    repo: "wh/skills", repoProvider: "github",
    ref: "v1.2.0", commit: "1bea90e", branch: "main",
    candidateRef: "—", candidateCommit: "—",
    versionCount: 12, prodEnv: "staging", channel: "staging",
    score: 89.7, trend: [85, 86, 87, 88, 88, 89, 89, 90, 90, 89.7],
    accessGroup: "security-readers", lastEval: "26m ago",
    status: "staging",
  },
  {
    id: "skl_qer", name: "Quarterly Earnings Summary",
    description: "Generates internal pre-read summaries from earnings transcripts and KPI dashboards.",
    tier: 2, owner: "min.park", team: "Finance",
    repo: "wh/skills", repoProvider: "github",
    ref: "v0.5.2", commit: "8a31cf2", branch: "main",
    candidateRef: "v0.5.3-rc.1", candidateCommit: "f02ee14",
    versionCount: 6, prodEnv: "staging", channel: "staging",
    score: 82.3, trend: [76, 77, 78, 78, 79, 80, 81, 82, 82, 82.3],
    accessGroup: "finance-bp", lastEval: "4m ago",
    status: "candidate-running-evals",
  },
  {
    id: "skl_erfc", name: "Engineering RFC Reviewer",
    description: "Reviews RFCs for missing risk sections, unstated dependencies, and rollout gaps.",
    tier: 1, owner: "ari.chen", team: "Engineering",
    repo: "wh/skills", repoProvider: "github",
    ref: "v2.0.0", commit: "a13f9c2", branch: "main",
    candidateRef: "—", candidateCommit: "—",
    versionCount: 19, prodEnv: "production", channel: "production",
    score: 94.1, trend: [88, 89, 90, 91, 92, 92, 93, 94, 94, 94.1],
    accessGroup: "eng-leads", lastEval: "3h ago",
    status: "production",
  },
  {
    id: "skl_cet", name: "Customer Email Tone Pass",
    description: "Reviews outbound customer emails for tone, clarity, and policy compliance.",
    tier: 3, owner: "renata.m", team: "Customer Success",
    repo: "wh/skills", repoProvider: "github",
    ref: "v1.0.4", commit: "44dd1ab", branch: "main",
    candidateRef: "—", candidateCommit: "—",
    versionCount: 8, prodEnv: "production", channel: "production",
    score: 76.5, trend: [74, 75, 75, 76, 76, 76, 76, 76, 76, 76.5],
    accessGroup: "cs-team", lastEval: "6h ago",
    status: "production",
  },
  {
    id: "skl_von", name: "Vendor Onboarding Memo",
    description: "Drafts vendor onboarding memos covering data flows, SOC 2 scope, and renewal terms.",
    tier: 3, owner: "min.park", team: "Procurement",
    repo: "wh/legal-skills", repoProvider: "github",
    ref: "v0.4.1", commit: "c0918dd", branch: "main",
    candidateRef: "—", candidateCommit: "—",
    versionCount: 3, prodEnv: "draft", channel: "draft",
    score: 71.0, trend: [],
    accessGroup: "procurement", lastEval: "1h ago",
    status: "draft",
  },
];

const RUBRIC_BASELINE = [
  { label: "Clause extraction precision", baseline: 0.94, candidate: 0.91, dir: "down" },
  { label: "Tone compliance",             baseline: 0.97, candidate: 0.95, dir: "down" },
  { label: "Playbook adherence",          baseline: 0.88, candidate: 0.93, dir: "up"   },
  { label: "Risk flag recall",            baseline: 0.81, candidate: 0.89, dir: "up"   },
  { label: "First-pass acceptance",       baseline: 0.74, candidate: 0.82, dir: "up"   },
  { label: "Edit distance reduction",     baseline: 0.62, candidate: 0.71, dir: "up"   },
];

const APPROVAL_TIMELINE = [
  { who: "ari.chen",      role: "Skill owner",     action: "submitted candidate v2.4.0-rc.2", when: "1h ago",   node: "moss" },
  { who: "eval-runner",   role: "Automation",      action: "completed eval run · 248 cases · 6 regressions flagged", when: "58m ago", node: "brass" },
  { who: "kalia.b",       role: "Peer reviewer",   action: "left 3 comments on rubric breakdown", when: "44m ago", node: "slate" },
  { who: "sasha.gw",      role: "Security",       action: "approval — security review", when: "30m ago", node: "moss" },
  { who: "compliance",    role: "Compliance",     action: "awaiting approval — clause-extraction regression review", when: "now", node: "brass" },
];

const COMMENTS = [
  { who: "kalia.b",  when: "39m ago", text: "The clause-extraction regression looks contained to non-standard NDAs. Worth narrowing the new rule to NDA templates only?" },
  { who: "sasha.gw", when: "30m ago", text: "Security review approved. Audit log additions cover the new tool-call paths." },
];

const AUDIT = [
  { when: "12m ago", who: "ari.chen",    action: "Promoted skill", target: "Engineering RFC Reviewer → production", node: "moss" },
  { when: "44m ago", who: "compliance",  action: "Held approval",  target: "Contract Clause Reviewer · v2.4.0-rc.2", node: "brass" },
  { when: "1h ago",  who: "sso/okta",    action: "Group sync",     target: "+3 members → legal-readers",            node: "slate" },
  { when: "3h ago",  who: "jdv",         action: "Rolled back",    target: "Incident Triage → v2.9.4",              node: "blood" },
  { when: "6h ago",  who: "renata.m",    action: "Created skill",  target: "RFP Response Drafter",                  node: "slate" },
];

window.SAVANT = { ORG, REPOS, APPROVALS, RECENT_CHANGES, REGRESSIONS, SKILLS, RUBRIC_BASELINE, APPROVAL_TIMELINE, COMMENTS, AUDIT };
