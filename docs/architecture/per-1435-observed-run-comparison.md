# PER-1435 — Pinned observed Test Bench QA comparison

**Status:** Draft PR, not release-approved.

## Product contract

Savant is a QA workbench for externally managed AI skills and workflows. This increment adds a first *descriptive* baseline/candidate comparison between two distinct, fully observed chat-only Test Bench runs from **different immutable Git revisions**. It is not a new harness, inference router, proof of MCP/tool execution, statistical experiment, or automated release gate.

A tenant member can see up to 24 recently complete comparable run headers for a skill, choose baseline and candidate, and request a server-calculated score comparison: overall points, pass-rate percentage points, mean latency milliseconds, estimated model-cost difference, and matched per-case quality/verdict/latency changes. No prompts, SKILL.md content, raw provider responses or secrets are returned by this comparison API.

## Prerequisites and admission

- Both run IDs are UUIDs owned by the same authenticated workspace and skill; the caller supplies **only** those two IDs.
- **Different 40/64-char pinned Git SHAs** are mandatory. Identical source commits are not evidence of candidate changes.
- Both runs must be `complete`, with exactly 1–4 observed samples and valid scorecards, never canceled/partial/failed/synthetic.
- At run completion the worker writes a versioned SHA-256 fingerprint of the current Jev scoring algorithm version and canonical rubric alongside the scorecard. Historical scorecards without the fingerprint are *not comparable* until re-evaluated, avoiding silent reinterpretation of older results.
- The server decrypts the admission-time case snapshots under AAD (org, run, definition revision, commit), strictly validates cases, and requires **identical exact inputs** (IDs, kind, prompts, context, expected behavior, ordering) across the pair.
- Executor and judge model IDs must match exactly; per-case samples and their provider model IDs must match the run. The server recomputes scorecard dimensions from observed samples to detect forged/malformed totals.
- Only the same case set and scoring contract may be compared. All mismatches fail closed (generic not-comparable response). Nonexistent/foreign/incomplete run pairs have indistinguishable tenant-scoped not-found responses.

## Security and persistence

`GET /api/skills/[id]/test-bench/compare` returns bounded **metadata only**. `POST` uses Origin protection, active workspace membership, Git view RBAC and a strict request body with two UUIDs, then performs a read-only paired comparison. No new provider calls, job enqueues, audit events, automatic promotion, case mutations or quality claims. Existing AES-256-GCM cases/results and immutable run receipts stay authoritative. An indexed completed-run history query is added through migration 0026 (idempotent).

## TDD and release gates

1. Pure units: correct-score/latency deltas and negative same-commit, cross-tenant/skill, altered case, changed model/judge, scoring-contract drift, partial/canceled, forged metrics and missing evidence.
2. Client/route regression: exact same-origin payload, tenant slug, no data leak, no provider selection, no injected case/outcome, no statistical claims or auto-promotion in UI.
3. Isolated PostgreSQL: create two full provider-mocked, worker-observed run receipts for the same cases pinned at separate Git commits; persist encrypted evidence; compare via tenant-scoped selector; reject case/input drift, foreign run IDs, canceled and legacy/unfingerprinted scorecards; verify no audit/write side effects.
4. GitHub exact-head Node/lint/type/Next/secrets, migration reapply, full tenancy and cancellation regression, **blocking high/critical production dependency audit** inherited from PR #70, and Vercel READY preview.
5. Independent security/code review and live Auth0 + managed encryption key + NIM/Jev smoke required before publication. External customer-harness evaluation (PER-1059) and statistically powered paired experiments (PER-1073/PER-1075) remain separate.

**Reporting rule:** For 1–4 cases, do not calculate p-values or infer statistical significance. All UI/API outcomes explicitly identify themselves as descriptive-only and cannot authorize an automated release.
