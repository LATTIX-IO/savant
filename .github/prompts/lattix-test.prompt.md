---
name: lattix-test
description: Add or improve behavior-focused tests for changed code
argument-hint: "<file, module, or behavior>"
agent: agent
---

Add or improve tests for the selected Lattix code.

Rules:
- Test behavior, not internals.
- Unit tests must be fast and isolated.
- Add integration/contract/E2E tests for IO, APIs, DB, queues, auth, migrations, and external boundaries.
- Prefer realistic doubles, emulators, or testcontainers over brittle mocks.
- Use property-based tests for parsers, validators, state machines, and core algorithms when useful.
- Cover success, failure, edge, and authorization paths.
- Do not weaken assertions or skip failing tests.

Return:
Test plan; files changed; test code; commands to run; coverage or confidence notes.