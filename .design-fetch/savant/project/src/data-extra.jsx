// data-extra.jsx — additional fixtures for repositories / evaluations / releases /
// policies / audit / connectors / settings. Loaded after data.jsx and merged into
// window.SAVANT.

const REPO_DETAILS = {
  "wh-skills": {
    description: "Primary org-wide skill repository. All cross-team skills live here.",
    visibility: "private",
    syncMode: "webhook",
    webhookHealth: "ok",
    defaultBranch: "main",
    protectedBranches: ["main"],
    tierPolicy: "Tier 2 default",
    members: ["ari.chen", "kalia.b", "min.park", "renata.m", "sasha.gw"],
    skillsByTier: { 1: 8, 2: 14, 3: 6 },
    recentCommits: [
      { commit: "8a31cf2", who: "min.park",  when: "4m ago",  msg: "earnings: tighten KPI extraction rubric" },
      { commit: "44dd1ab", who: "renata.m",  when: "6h ago",  msg: "email-tone: add 12 new fail cases" },
      { commit: "01a8cba", who: "renata.m",  when: "9h ago",  msg: "rfp-drafter: v0.9.0 release candidate" },
      { commit: "f02ee14", who: "min.park",  when: "1d ago",  msg: "earnings: rebaseline rubric weights" },
      { commit: "c918aef", who: "kalia.b",   when: "1d ago",  msg: "pr-summarizer: dependency note pass" },
    ],
  },
};

const EVAL_RUNS = [
  { id: "er_482", skill: "Contract Clause Reviewer", ref: "v2.4.0-rc.2", dataset: "contract-corpus-v9", cases: 248, passed: 242, failed: 6, started: "58m ago", duration: "24s", delta: +0.6, status: "complete-with-regressions" },
  { id: "er_481", skill: "Incident Triage",          ref: "v3.1.0-rc.4", dataset: "sev-2-corpus-v3",   cases: 132, passed: 124, failed: 8, started: "1h ago",  duration: "41s", delta: +0.4, status: "running" },
  { id: "er_480", skill: "Quarterly Earnings Summary", ref: "v0.5.3-rc.1", dataset: "earnings-q3-v1",   cases:  84, passed:  79, failed: 5, started: "1h ago",  duration: "18s", delta: +0.2, status: "complete" },
  { id: "er_479", skill: "PR Summarizer",            ref: "v1.8.3-rc.1", dataset: "pr-corpus-v6",      cases: 320, passed: 314, failed: 6, started: "2h ago",  duration: "47s", delta: +0.3, status: "complete" },
  { id: "er_478", skill: "SOC 2 Evidence Drafter",   ref: "v1.2.0",      dataset: "soc-2-corpus-v2",   cases:  96, passed:  92, failed: 4, started: "4h ago",  duration: "31s", delta: +0.1, status: "complete" },
  { id: "er_477", skill: "Engineering RFC Reviewer", ref: "v2.0.0",      dataset: "rfc-corpus-v4",     cases: 156, passed: 154, failed: 2, started: "6h ago",  duration: "22s", delta: +0.5, status: "complete" },
  { id: "er_476", skill: "Customer Email Tone Pass", ref: "v1.0.4",      dataset: "email-tone-v2",     cases: 280, passed: 268, failed:12, started: "9h ago",  duration: "34s", delta: -0.2, status: "complete" },
  { id: "er_475", skill: "Vendor Onboarding Memo",   ref: "v0.4.1",      dataset: "vendor-corpus-v1",  cases:  64, passed:  55, failed: 9, started: "1d ago",  duration: "16s", delta: -0.4, status: "complete" },
  { id: "er_474", skill: "RFP Response Drafter",     ref: "v0.9.0",      dataset: "rfp-corpus-v1",     cases:  72, passed:  62, failed:10, started: "1d ago",  duration: "29s", delta: null, status: "complete-baseline" },
  { id: "er_473", skill: "Contract Clause Reviewer", ref: "v2.3.7",      dataset: "contract-corpus-v9", cases: 248, passed: 246, failed: 2, started: "6d ago",  duration: "23s", delta: +0.4, status: "complete" },
];

const RELEASES = [
  {
    id: "rel_71",
    skill: "Contract Clause Reviewer",
    candidateRef: "v2.4.0-rc.2",
    candidateCommit: "8a31cf2",
    fromEnv: "draft",
    toEnv: "staging",
    requested: "ari.chen",
    when: "1h ago",
    approvalsDone: 2,
    approvalsRequired: 3,
    approvalsBlocked: "compliance",
    readinessPct: 0.78,
    readiness: [
      { label: "Eval suite passing",      ok: false, meta: "6 regressions" },
      { label: "Owner approval",          ok: true,  meta: "ari.chen · 1h ago" },
      { label: "Security review",         ok: true,  meta: "sasha.gw · 30m" },
      { label: "Compliance review",       ok: null,  meta: "awaiting compliance" },
      { label: "Bundle signed & built",   ok: true,  meta: "44a0…1cf2" },
    ],
    targets: ["vscode-sync", "codex-agent", "github-actions"],
  },
  {
    id: "rel_70",
    skill: "Quarterly Earnings Summary",
    candidateRef: "v0.5.3-rc.1",
    candidateCommit: "f02ee14",
    fromEnv: "draft",
    toEnv: "staging",
    requested: "min.park",
    when: "4m ago",
    approvalsDone: 1,
    approvalsRequired: 2,
    approvalsBlocked: "reviewer",
    readinessPct: 0.6,
    readiness: [
      { label: "Eval suite passing",      ok: true,  meta: "94% pass" },
      { label: "Owner approval",          ok: true,  meta: "min.park · 4m" },
      { label: "Reviewer approval",       ok: null,  meta: "awaiting reviewer" },
      { label: "Bundle signed & built",   ok: true,  meta: "94d2…ee14" },
    ],
    targets: ["vscode-sync"],
  },
  {
    id: "rel_69",
    skill: "PR Summarizer",
    candidateRef: "v1.8.3-rc.1",
    candidateCommit: "c918aef",
    fromEnv: "staging",
    toEnv: "production",
    requested: "kalia.b",
    when: "31m ago",
    approvalsDone: 2,
    approvalsRequired: 2,
    approvalsBlocked: null,
    readinessPct: 1.0,
    readiness: [
      { label: "Eval suite passing",      ok: true,  meta: "98% pass" },
      { label: "Owner approval",          ok: true,  meta: "kalia.b · 31m" },
      { label: "Staging burn-in (24h)",   ok: true,  meta: "complete" },
      { label: "Bundle signed & built",   ok: true,  meta: "c918…aef" },
    ],
    targets: ["vscode-sync", "codex-agent", "cursor-agent", "github-actions"],
  },
];

const RELEASE_HISTORY = [
  { ref: "v2.3.7",  skill: "Contract Clause Reviewer", env: "production", who: "ari.chen",  when: "6d ago",  outcome: "released" },
  { ref: "v3.0.1",  skill: "Incident Triage",         env: "production", who: "jdv",        when: "8d ago",  outcome: "released" },
  { ref: "v2.9.4",  skill: "Incident Triage",         env: "production", who: "jdv",        when: "9d ago",  outcome: "rolled-back" },
  { ref: "v1.8.2",  skill: "PR Summarizer",           env: "production", who: "kalia.b",    when: "11d ago", outcome: "released" },
  { ref: "v2.3.6",  skill: "Contract Clause Reviewer", env: "production", who: "ari.chen",  when: "11d ago", outcome: "released" },
  { ref: "v2.0.0",  skill: "Engineering RFC Reviewer", env: "production", who: "ari.chen",  when: "14d ago", outcome: "released" },
  { ref: "v1.2.0",  skill: "SOC 2 Evidence Drafter",  env: "staging",    who: "sasha.gw",   when: "18d ago", outcome: "released" },
  { ref: "v1.0.4",  skill: "Customer Email Tone Pass", env: "production", who: "renata.m",  when: "21d ago", outcome: "released" },
];

const POLICIES = [
  {
    id: "pol-t1-access",
    name: "Tier 1 — Read access requires SSO group",
    type: "access",
    scope: "All Tier 1 skills",
    state: "active",
    affects: 38,
    appliedBy: "platform-admins",
    updated: "4d ago",
    rules: [
      { rule: "Membership", value: "Must be a member of an Okta-synced group with explicit grant" },
      { rule: "Re-auth", value: "Required every 12h for sensitive Tier 1 skills" },
      { rule: "Exception", value: "Break-glass via two-person approval" },
    ],
  },
  {
    id: "pol-prod-approvals",
    name: "Production releases require 2 approvers",
    type: "approval",
    scope: "All production environments",
    state: "active",
    affects: 147,
    appliedBy: "platform-admins",
    updated: "12d ago",
    rules: [
      { rule: "Owner approval",     value: "Required" },
      { rule: "Reviewer approval",  value: "Required from a non-owner team member" },
      { rule: "Compliance",         value: "Required for Tier 1 only" },
    ],
  },
  {
    id: "pol-t1-distribution",
    name: "Tier 1 cannot distribute to local agents",
    type: "distribution",
    scope: "Tier 1, vscode-sync · codex-agent · cursor-agent",
    state: "active",
    affects: 38,
    appliedBy: "compliance",
    updated: "22d ago",
    rules: [
      { rule: "Allowed channels",  value: "Native integrations only (server-side execution)" },
      { rule: "Blocked",           value: "Local sync agents, signed-bundle export" },
    ],
  },
  {
    id: "pol-promotion-burnin",
    name: "Staging burn-in of 24h before production",
    type: "environment",
    scope: "Tier 1 & Tier 2",
    state: "active",
    affects: 96,
    appliedBy: "platform-admins",
    updated: "31d ago",
    rules: [
      { rule: "Minimum burn-in", value: "24h in staging with zero p0 events" },
      { rule: "Override",        value: "Two platform-admin approvals" },
    ],
  },
  {
    id: "pol-rollback-window",
    name: "Auto-pin on regression > 5%",
    type: "approval",
    scope: "All production releases",
    state: "draft",
    affects: 0,
    appliedBy: "platform-admins",
    updated: "1d ago",
    rules: [
      { rule: "Detection",  value: "Post-release scorecard < baseline − 5 points" },
      { rule: "Action",     value: "Auto-pin prior version, open incident, notify owner" },
    ],
  },
  {
    id: "pol-external-eval",
    name: "External eval datasets require legal review",
    type: "access",
    scope: "Eval datasets sourced outside the org",
    state: "active",
    affects: 4,
    appliedBy: "compliance",
    updated: "47d ago",
    rules: [
      { rule: "Legal review", value: "Required for any dataset containing customer data" },
      { rule: "Retention",    value: "90 days max for production runs" },
    ],
  },
];

const AUDIT_FULL = [
  { when: "Now",     time: "14:02",  who: "compliance",   action: "Held approval",  target: "Contract Clause Reviewer · v2.4.0-rc.2", category: "approval",   node: "brass" },
  { when: "12m ago", time: "13:50",  who: "ari.chen",     action: "Promoted skill", target: "Engineering RFC Reviewer → production",  category: "release",    node: "moss"  },
  { when: "30m ago", time: "13:32",  who: "sasha.gw",     action: "Approved",       target: "Contract Clause Reviewer · v2.4.0-rc.2", category: "approval",   node: "moss"  },
  { when: "44m ago", time: "13:18",  who: "kalia.b",      action: "Commented",      target: "Contract Clause Reviewer · v2.4.0-rc.2", category: "review",     node: "slate" },
  { when: "58m ago", time: "13:04",  who: "eval-runner",  action: "Completed eval", target: "Contract Clause Reviewer · 248 cases",   category: "evaluation", node: "slate" },
  { when: "1h ago",  time: "13:01",  who: "ari.chen",     action: "Submitted",      target: "Contract Clause Reviewer · v2.4.0-rc.2", category: "version",    node: "slate" },
  { when: "1h ago",  time: "12:55",  who: "sso/okta",     action: "Group sync",     target: "+3 members → legal-readers",              category: "access",     node: "slate" },
  { when: "2h ago",  time: "12:01",  who: "renata.m",     action: "Created skill",  target: "RFP Response Drafter",                    category: "version",    node: "slate" },
  { when: "3h ago",  time: "11:02",  who: "jdv",          action: "Rolled back",    target: "Incident Triage → v2.9.4",                category: "release",    node: "blood" },
  { when: "5h ago",  time: "09:00",  who: "platform",     action: "Policy updated", target: "Auto-pin on regression > 5%",             category: "policy",     node: "brass" },
  { when: "6h ago",  time: "08:11",  who: "renata.m",     action: "Edited rubric",  target: "Customer Email Tone Pass",                category: "version",    node: "slate" },
  { when: "9h ago",  time: "05:30",  who: "system",       action: "Auto-revoked",   target: "kbennett@wh.com — left engineering-leads",category: "access",     node: "blood" },
  { when: "1d ago",  time: "—",      who: "github-app",   action: "Repository sync",target: "wh/skills · 14 new commits",              category: "repo",       node: "slate" },
  { when: "1d ago",  time: "—",      who: "min.park",     action: "Approved",       target: "Quarterly Earnings Summary · v0.5.2",     category: "approval",   node: "moss"  },
  { when: "2d ago",  time: "—",      who: "compliance",   action: "Policy created", target: "Staging burn-in of 24h before production", category: "policy",    node: "moss"  },
];

const CONNECTORS = [
  { id: "vsc",    name: "VS Code Sync Agent",   category: "local",   kind: "Managed agent",   status: "healthy",  lastSync: "5m ago",  version: "1.4.2",  skills: 132, users: 218, scope: "Tier 2 & 3 production" },
  { id: "cdx",    name: "Codex Sync Agent",     category: "local",   kind: "Managed agent",   status: "healthy",  lastSync: "8m ago",  version: "0.9.1",  skills: 132, users: 184, scope: "Tier 2 & 3 production" },
  { id: "cur",    name: "Cursor Sync Agent",    category: "local",   kind: "Managed agent",   status: "healthy",  lastSync: "12m ago", version: "0.6.0",  skills: 124, users: 96,  scope: "Tier 2 & 3 production" },
  { id: "cli",    name: "savant-cli",           category: "local",   kind: "CLI",             status: "degraded", lastSync: "1h ago",  version: "0.3.4",  skills: 132, users: 41,  scope: "Tier 2 & 3 production" },
  { id: "gha",    name: "GitHub Actions",       category: "native",  kind: "Native — push",   status: "healthy",  lastSync: "4m ago",  version: "—",      skills:  18, users: "—", scope: "Tier 1 & 2 production" },
  { id: "azp",    name: "Azure Pipelines",      category: "native",  kind: "Native — push",   status: "healthy",  lastSync: "11m ago", version: "—",      skills:   8, users: "—", scope: "Tier 1 & 2 production" },
  { id: "slk",    name: "Slack",                category: "notify",  kind: "Native — notify", status: "healthy",  lastSync: "real-time", version: "—",   skills:  "—", users: 412, scope: "Release events" },
  { id: "lnr",    name: "Linear",               category: "notify",  kind: "Native — notify", status: "healthy",  lastSync: "real-time", version: "—",   skills:  "—", users: "—",  scope: "Incident & rollback events" },
  { id: "jra",    name: "Jira",                 category: "notify",  kind: "Native — notify", status: "warning",  lastSync: "stale 3h",  version: "—",   skills:  "—", users: "—",  scope: "Approval requests" },
  { id: "bun",    name: "Signed Bundle Export", category: "bundle",  kind: "Bundle export",   status: "healthy",  lastSync: "on demand", version: "—",   skills:  18, users: "—",  scope: "Air-gapped customer envs" },
];

const POSSIBLE_CONNECTORS = [
  "JetBrains IDEs", "Neovim", "Continue", "Zed", "GitLab CI", "Bitbucket Pipelines",
  "Microsoft Teams", "PagerDuty", "Datadog", "Notion",
];

const MEMBERS = [
  { name: "Priya Aronson",  email: "priya@wh.com",     role: "Platform admin",  groups: ["platform-admins", "all-employees"], status: "active",  last: "now" },
  { name: "Ari Chen",       email: "ari.chen@wh.com",  role: "Skill owner",     groups: ["eng-leads", "legal-owners"],         status: "active",  last: "1h ago" },
  { name: "Kalia Bonner",   email: "kalia.b@wh.com",   role: "Skill owner",     groups: ["eng-leads"],                          status: "active",  last: "3h ago" },
  { name: "Min Park",       email: "min.park@wh.com",  role: "Skill owner",     groups: ["finance-bp"],                         status: "active",  last: "1d ago" },
  { name: "Sasha Gw",       email: "sasha.gw@wh.com",  role: "Reviewer",        groups: ["security-readers"],                   status: "active",  last: "2d ago" },
  { name: "Renata M.",      email: "renata.m@wh.com",  role: "Skill owner",     groups: ["se-team", "cs-team"],                 status: "active",  last: "12m ago" },
  { name: "Jdv (J. Devine)",email: "jdv@wh.com",       role: "Skill owner",     groups: ["sre-oncall"],                         status: "active",  last: "30m ago" },
  { name: "Karl Bennett",   email: "karl.b@wh.com",    role: "—",                groups: [],                                     status: "off-boarded", last: "9h ago" },
];

Object.assign(window.SAVANT, {
  REPO_DETAILS, EVAL_RUNS, RELEASES, RELEASE_HISTORY,
  POLICIES, AUDIT_FULL, CONNECTORS, POSSIBLE_CONNECTORS, MEMBERS,
});
