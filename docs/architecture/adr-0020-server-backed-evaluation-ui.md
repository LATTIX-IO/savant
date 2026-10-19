# ADR-0020 — Trustworthy evaluation entry point in the MVP UI

**Status:** MVP increment, pending exact-head CI and independent review.
**Dependency:** PR #62 / PER-1419 (pin each queued evaluation to immutable indexed Git SHA).
**Out of scope:** external customer-harness execution, custom Test Bench dataset playback, tool/MCP execution, provider BYO selection, and quantitative A/B release gates.

## Context

The evaluation detail view previously had `Run` and `Run draft` actions that called `simulateCustomEvaluationTest` entirely inside the browser, then rendered illustrative numerical scores and runtimes as if a benchmark had executed. Saved Test Bench inputs and decisions live in browser storage and are not a canonical server-backed evaluation configuration.

Meanwhile the system already exposes authenticated `GET /api/skills/[id]/automation` and `POST /api/skills/[id]/automation/generate`. Those routes use tenant resolution, role checks, same-origin mutation validation, durable PostgreSQL evaluation generation, configured NIM execution and Jev scoring. This actual evaluation is *chat-only*, and does **not** exercise customer-owned harness tools or Test Bench draft settings.

## Decision

1. Remove synthetic Test Bench execution actions and synthetic score rendering. Retain browser-local configuration editing only as an explicitly labeled draft feature. The inoperative evaluation-export action is also removed.
2. Add a separate **Server-backed evaluation** panel. Query existing tenant-authorized GET endpoint with same-origin credentials, no caching; initiate generation only on a user click with a same-origin POST.
3. Display the persisted run ID, status, immutable Git commit SHA, and provisional rubric score where present. Distinguish `queued/running/complete/needs_review/failed`. Poll only an active run, with cleanup for unmount and no cross-origin requests.
4. Strictly validate API shape and exact expected skill ID. Refuse mismatched skill identities, invalid statuses, non-immutable SHA values, malformed JSON and non-202 submission acknowledgments. Render sanitized generic errors rather than raw provider failure messages.
5. Disable triggering for historical/read-only evaluations, unauthorized roles, missing provider configuration, and already-active submissions. Explicitly distinguish chat-only NIM/Jev evaluation from external-harness/tool execution and custom Test Bench playback. **Do not treat generated scores as release-quality evidence without human verification.**

## TDD acceptance and negative cases

- Unit: GET/POST use relative encoded routes, same-origin credentials, no-store, exact 202 POST acceptance, valid persisted score/commit parsing.
- Security: reject cross-skill responses, unrecognized statuses, branch names, invalid/uppercase/unpinned commit SHAs, malformed payloads, repeated submissions, cross-origin URL construction and provider-error reflection.
- Regression: evaluation UI does not call `simulateCustomEvaluationTest`; custom draft/run controls do not create evidence; the real panel can only initiate through the existing same-origin authorized route. The persisted job already inherits DB tenant scoping.
- CI gate: Node unit tests, TypeScript, ESLint, Next.js production build, secrets scan, high/critical production dependency audit, and isolated PostgreSQL integration on **exact PR head**. Required independent review before merging.
- Live smoke gate: authorized tenant can create run and see its persisted ID and pinned commit through completion; unauthorized tenant cannot start or see it; absent NIM/Jev fails closed; failed/expired job shows an error without fictitious scores; no Test Bench settings silently ignored as execution inputs.

## Rollout and limitations

No schema or secrets migration; this is a distinct UI component and pure client validator. Deploy behind the existing app authorization boundary. If backend services are unavailable, show unavailable state, never synthetic fallback. Existing locally saved Test Bench definitions are unaffected but **not runnable** until a future dedicated executor is shipped.

The existing auto-evaluation depends on configured **platform-level** NIM/Jev credentials. BYO tenant inference connections, true per-case Test Bench runner, external harness delegation, statistical baseline-versus-candidate comparison, signed attestations and publishable QA release gates require separate increments.
