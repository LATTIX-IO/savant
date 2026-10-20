# UX-P4 — Git-backed skill Workbench

Status: **draft consolidated implementation PR #73**. The old P1/P2/P3 branches are incorporated into the current PR's ancestry and closed as superseded, not separately merged. UX-P0 reference remains PR #66. The current source integration preserves the merged backend and is **not** an activated production UX.

## Scope
Adapt the selected UX prototype's editor / source inspector into an operational, responsive skill workbench at the existing authenticated `/o/[workspaceSlug]/skills/[id]` route.

The new page reads tenant-scoped `fetchSkillDetail` and `fetchSkillSource`, presents the *one* indexed `SKILL.md` currently supported by the API, and offers side-by-side source/draft review. A managed Git connection can submit a **pending-approval change proposal**, not a commit, merge, or published skill. Changes are never marked as committed merely because the proposal API returns 201.

The server checks membership and mutation origin. Every read passes `workspaceSlug`; proposal submission passes `workspaceSlug` explicitly through the existing Git client. Before creating a proposal, reload the source and compare skill, repo, path, branch, commit and content. Concurrent changes cause refusal, not silent overwrite. This check is advisory/optimistic: repository review/merge gates must provide final concurrency enforcement.

Legacy direct-commit source editing is **read-only** in v2 because its server API lacks a revision precondition. This is a deliberately narrower security model than the classic Builder; do not call it a functional direct-commit editor. An explicit subsequent increment must add conditional Git writes if support is desired.

## No simulated behavior
The static prototype's graph nodes, file tree, evaluator preview and tool/dependency links are not represented as real if the API cannot provide them. The UI shows a single SKILL.md with markdown preview and read-only source metadata; other files/workflow planning stay labeled unavailable or absent. Existing evaluation and improvement routes remain real deep links. The classic skill detail is retained when v2 is off.

## Authenticated release acceptance

Run the controlled, real-Auth0 Overview → Library → Workbench acceptance defined in `docs/product/ux-p1-p4-authenticated-acceptance.md`; it requires two permitted tenants, a denied tenant and a proposal-capable staging Git source. Node/TS/DB/CI and Vercel preview success cannot substitute for that evidence. Retain server-side flag-off rollback until approved. A separate source-ready branch merge must not be described as production rollout.

## Definition of done
- [ ] Pure unit tests: editability matrix, blank/oversize checks, concurrent source snapshot detection, provenance labels.
- [ ] Security/regression tests: source and proposal tenant scoping, no direct writes, stale response suppression, no unsafe HTML, no browser persisted authoritative state.
- [ ] Exact-head Node tests, ESLint, TypeScript, production build, secret scan, PostgreSQL tenant integrity all green.
- [ ] Authenticated Playwright cross-tenant isolation, same-origin mutation, 403/409/503 error states, keyboard editing and narrow viewport in both themes; review approval.
- [ ] Dependency vulnerability gate and upstream UX PRs reviewed/merged in order before rollout.

## Rollback
Disable `SAVANT_UI_V2_ENABLED` or remove the tenant slug and redeploy; classic skill detail remains. No schema changes.
