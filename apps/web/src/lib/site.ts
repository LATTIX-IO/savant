export const platformPillars = [
  {
    title: "Governed skill registry",
    description:
      "Centralize Tier 1, Tier 2, and Tier 3 skills with version history, metadata, ownership, and controlled downstream distribution.",
  },
  {
    title: "Measured improvement loops",
    description:
      "Treat skill changes like software releases with baseline comparisons, rubric scoring, regression detection, and evidence-backed promotion.",
  },
  {
    title: "Enterprise-grade access control",
    description:
      "Prepare the product for SSO, IdP-backed group sync, RBAC, auditability, and environment-aware release permissions.",
  },
] as const;

export const currentBootstrapScope = [
  "pnpm + Turborepo workspace wiring at the repo root",
  "A fully bootstrapped Next.js App Router frontend in apps/web",
  "Spec-aligned placeholder folders for future packages, data assets, skills, and infrastructure",
  "CI that runs lint, typecheck, and build on pushes and pull requests",
] as const;

export const deferredWork = [
  "apps/api stays intentionally empty until the Rust vs Python runtime decision is made",
  "apps/worker stays intentionally empty for the same reason",
  "No database schema, auth integration, RBAC logic, or eval runner code is included yet",
] as const;

export const mvpTracks = [
  "Admin console and skill catalog foundations in the web app",
  "Skill registry, version history, and release workflow modeling",
  "SSO and RBAC once the backend/runtime assessment is complete",
  "A/B evaluation pipelines, scorecards, and regression gating",
  "Signed bundles and managed distribution for downstream tooling",
] as const;

export const productSurfaces = [
  {
    name: "Admin console",
    points: ["Org settings", "connector setup", "policy editing", "audit visibility"],
  },
  {
    name: "Skill catalog",
    points: ["browse by tier", "version status", "owner metadata", "access-aware discovery"],
  },
  {
    name: "Eval dashboard",
    points: ["candidate vs baseline", "rubric scores", "regressions", "review notes"],
  },
  {
    name: "Release dashboard",
    points: ["draft to staging to production", "approvals", "rollout status", "rollback controls"],
  },
] as const;
