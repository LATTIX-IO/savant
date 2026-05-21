---
applyTo: "**/*{test,spec}*.{py,ts,tsx,js,jsx,go,java,kt,rs,cs}"
---

# Lattix Test Instructions

Apply these rules when creating or editing tests.

Principles:
- Test behavior, not internals.
- Prefer clear, deterministic tests over clever tests.
- Each behavior change needs tests.
- Cover success, failure, boundary, authorization, and regression cases.
- Do not skip, delete, mute, or weaken tests just to make CI pass.

Unit tests:
- Keep unit tests fast and isolated.
- Use real domain objects where practical.
- Mock only true boundaries: network, DB, filesystem, queues, clock, randomness, vendor SDKs.
- Name tests by expected behavior.

Integration/contract/E2E:
- Add integration or contract tests for APIs, DB, queues, auth, migrations, external boundaries, and serialization formats.
- Prefer realistic doubles, emulators, or testcontainers over brittle mocks.
- Verify backward compatibility for API/event/schema changes.

Data:
- Do not use real secrets, tokens, keys, PII, customer data, or production identifiers.
- Use factories/builders for readable setup.
- Keep fixtures minimal and intentional.

Assertions:
- Assert meaningful outcomes, not incidental implementation details.
- Include negative assertions for security/privacy where relevant.
- Verify logs/metrics only when they are part of required behavior.

Coverage:
- Aim for >=80% changed-line coverage.
- Do not chase coverage with weak assertions.