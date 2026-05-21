---
name: lattix-ci-fix
description: Diagnose and fix CI failures without bypassing quality gates
argument-hint: "<CI log, failing command, branch, or error>"
agent: agent
---

Diagnose and fix the CI failure.

Process:
1. Summarize the failing job, command, and error.
2. Identify the likely root cause.
3. Reproduce locally when possible.
4. Fix the smallest safe diff.
5. Add or update tests only if behavior was under-tested.
6. Preserve lint, format, type, security, and test gates.
7. Provide verification commands.

Rules:
- Do not skip, mute, weaken, or delete tests to make CI pass.
- Do not bypass linters, type checks, security checks, or coverage gates.
- Do not change CI config unless the config is the root cause.
- Do not hallucinate paths, package scripts, flags, or test results.
- If uncertain, state what to inspect next.

Return:
## Failure Summary
## Root Cause
## Fix
## Files Changed
## Tests
## Verification Commands
## Risk