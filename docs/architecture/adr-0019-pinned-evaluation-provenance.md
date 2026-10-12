# ADR-0019 — Immutable Git provenance for asynchronous evaluations

**Status:** MVP increment; proposed, independent of the PER-1059 broker stack.

## Problem

Previously `queueEvalGeneration` recorded the skill and repository, but the worker read the current repository default branch at execution time. A commit pushed between admission and worker execution could silently change the inputs, skewing scorecards and approval evidence.

## Decision

At queue admission, require an indexed skill row bound to the **same organization, repository, skill ID and source path**. Resolve its most recently indexed `source_commit_sha` and persist the full immutable Git SHA on `eval_generation_runs.commit_sha` **before enqueueing**. Reject absent, branch-like, abbreviated and malformed revision values; a full SHA-1 (40 lowercase hexadecimal) or SHA-256 (64 lowercase hexadecimal) is allowed. The worker must use the persisted revision with the existing revision-aware repository reader, never resolve the mutable default branch.

Legacy queued runs without a pinned commit are denied instead of being silently retargeted. The indexed commit is the evaluated source; it may differ from the *current* default branch by the time the worker processes the job, by design. If a repository revision is deleted or made inaccessible, the evaluation fails closed and must be re-queued following a fresh repository sync.

## Security and tests

- Unit: accept valid full immutable SHA-1/SHA-256; deny branch, tag, abbreviated SHA, whitespace, uppercase, traversal-like input, unexpected data types.
- Regression: enqueue lookup filters on tenant + repository + skill + source path, persists commit on initial insert; worker always passes persisted SHA to revision-aware repository read. This avoids cross-tenant or cross-repository provenance reuse.
- CI acceptance: Node tests, TypeScript, lint, production build and dependency audit must succeed on the **exact PR head**. Existing isolated Postgres integration workflow should pass. A live integration exercise that advances default branch between queueing and worker execution remains a release gate; this increment alone is not proof of end-to-end harness execution.

No database migration is required: `eval_generation_runs.commit_sha` already exists. No credentials are logged or copied into job payloads. Existing queued legacy jobs may fail until requeued after sync; operations should explicitly review this impact during rollout.

## Out of scope

BYO customer-harness execution, scoring calibration, candidate/baseline paired A/B, concurrency/cost reservations and production worker supervisor remain separate MVP gates.
